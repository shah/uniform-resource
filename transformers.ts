import { Cache, lruCache } from "./cache";
import * as c from "./content";
import * as f from "./follow-urls";
import * as ur from "./uniform-resource";

export interface TransformedResource extends ur.UniformResource {
    readonly transformedFromUR: ur.UniformResource;
    readonly pipePosition: number;
    readonly remarks?: string;
}

export function isTransformedResource(o: any): o is TransformedResource {
    return o && "transformedFromUR" in o && "pipePosition" in o;
}

export function nextTransformationPipePosition(o: any): number {
    return "pipePosition" in o ? o.pipePosition + 1 : 0;
}

export function allTransformationRemarks(tr: TransformedResource): string[] {
    const result: string[] = [];
    let active: ur.UniformResource = tr;
    while (isTransformedResource(active)) {
        result.unshift(active.remarks || "(no remarks)");
        active = active.transformedFromUR;
    }
    return result;
}

export interface UniformResourceTransformer {
    transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource>;
}

export class RemoveLabelLineBreaksAndTrimSpaces implements UniformResourceTransformer {
    static readonly singleton = new RemoveLabelLineBreaksAndTrimSpaces();

    async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource | TransformedResource> {
        if (!resource.label) {
            return resource;
        }

        const cleanLabel = resource.label.replace(/\r\n|\n|\r/gm, " ").trim()
        if (cleanLabel != resource.label) {
            return {
                ...resource,
                pipePosition: nextTransformationPipePosition(resource),
                transformedFromUR: resource,
                label: cleanLabel,
                remarks: "Removed line breaks and trimmed spaces in label"
            }
        }
        return resource;
    }
}

export class RemoveTrackingCodesFromUrl implements UniformResourceTransformer {
    static readonly singleton = new RemoveTrackingCodesFromUrl();

    async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource | TransformedResource> {
        const cleanedURI = resource.uri.replace(/(?<=&|\?)utm_.*?(&|$)/igm, "");
        if (cleanedURI != resource.uri) {
            const transformed: TransformedResource = {
                ...resource,
                pipePosition: nextTransformationPipePosition(resource),
                transformedFromUR: resource,
                remarks: "Removed utm_* tracking parameters from URL",
            }
            return transformed;
        } else {
            return resource;
        }
    }
}

export interface FollowedResource extends TransformedResource {
    readonly isFollowedResource: true;
    readonly terminalResult: f.VisitResult;
    readonly followResults: f.VisitResult[];
}

export function isFollowedResource(o: any): o is FollowedResource {
    return o && "isFollowedResource" in o;
}

export class FollowRedirectsGranular implements UniformResourceTransformer {
    static readonly singleton = new FollowRedirectsGranular();

    constructor(readonly cache: Cache<f.VisitResult[]> = lruCache()) {
    }

    async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource | ur.InvalidResource | FollowedResource> {
        let result: ur.UniformResource | ur.InvalidResource | FollowedResource = resource;
        let visitResults = this.cache[resource.uri];
        if (!visitResults) {
            visitResults = await f.follow(resource.uri);
            this.cache[resource.uri] = visitResults;
        }
        if (visitResults.length > 0) {
            const last = visitResults[visitResults.length - 1];
            if (f.isTerminalResult(last)) {
                result = {
                    ...resource,
                    pipePosition: nextTransformationPipePosition(resource),
                    transformedFromUR: resource,
                    remarks: "Followed, with " + visitResults.length + " results",
                    isFollowedResource: true,
                    followResults: visitResults,
                    uri: last.url,
                    terminalResult: last
                };
            } else if (f.isVisitError(last)) {
                result = {
                    isInvalidResource: true,
                    ...resource,
                    error: last.error,
                    remarks: last.error.message
                }
            }
        }
        return result;
    }
}

export class EnrichGovernedContent implements UniformResourceTransformer {
    static readonly singleton = new EnrichGovernedContent();

    async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource | (ur.UniformResource & c.GovernedContent)> {
        let result: ur.UniformResource | (ur.UniformResource & c.GovernedContent) = resource;
        if (isFollowedResource(resource) && f.isTerminalTextContentResult(resource.terminalResult)) {
            const textResult = resource.terminalResult;
            result = {
                ...resource,
                contentType: textResult.contentType,
                mimeType: textResult.mimeType
            };
        }
        return result;
    }
}

export interface CuratableContentResource extends ur.UniformResource {
    readonly curatableContent: c.CuratableContent;
}

export function isCuratableContentResource(o: any): o is CuratableContentResource {
    return o && ("curatableContent" in o);
}

export class EnrichCuratableContent implements UniformResourceTransformer {
    static readonly standard = new EnrichCuratableContent(c.contentTransformationPipe(
        c.EnrichCuratableContent.singleton,
        c.StandardizeCurationTitle.singleton));
    static readonly readable = new EnrichCuratableContent(c.contentTransformationPipe(
        c.EnrichCuratableContent.singleton,
        c.StandardizeCurationTitle.singleton,
        c.EnrichMercuryReadableContent.singleton,
        c.EnrichMozillaReadabilityContent.singleton));

    constructor(readonly contentTr: c.ContentTransformer) {
    }

    async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource | CuratableContentResource> {
        let result: ur.UniformResource | CuratableContentResource = resource;
        if (isFollowedResource(resource) && f.isTerminalTextContentResult(resource.terminalResult)) {
            const textResult = resource.terminalResult;
            const content = await this.contentTr.transform({
                uri: resource.uri,
                htmlSource: textResult.contentText
            }, {
                contentType: textResult.contentType,
                mimeType: textResult.mimeType
            });
            result = {
                ...resource,
                curatableContent: content as c.CuratableContent,
            };
        }
        return result;
    }
}

export function transformationPipe(...chain: UniformResourceTransformer[]): UniformResourceTransformer {
    if (chain.length == 0) {
        return new class implements UniformResourceTransformer {
            async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource> {
                return resource;
            }
        }()
    }
    if (chain.length == 1) {
        return new class implements UniformResourceTransformer {
            async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource> {
                return await chain[0].transform(ctx, resource);
            }
        }()
    }
    return new class implements UniformResourceTransformer {
        async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource> {
            let result = await chain[0].transform(ctx, resource);
            for (let i = 1; i < chain.length; i++) {
                result = await chain[i].transform(ctx, result);
            }
            return result;
        }
    }()
}

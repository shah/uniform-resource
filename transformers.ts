import * as c from "./content";
import * as f from "./follow-urls";
import * as ur from "./uniform-resource";

export class RemoveLabelLineBreaksAndTrimSpaces implements ur.UniformResourceTransformer {
    static readonly singleton = new RemoveLabelLineBreaksAndTrimSpaces();

    async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource | ur.TransformedResource> {
        if (!resource.label) {
            return resource;
        }

        const cleanLabel = resource.label.replace(/\r\n|\n|\r/gm, " ").trim()
        if (cleanLabel != resource.label) {
            return {
                isTransformedResource: true,
                ...resource,
                pipePosition: ur.nextTransformationPipePosition(resource),
                transformedFromUR: resource,
                label: cleanLabel,
                remarks: "Removed line breaks and trimmed spaces in label"
            }
        }
        return resource;
    }
}

export class RemoveTrackingCodesFromUrl implements ur.UniformResourceTransformer {
    static readonly singleton = new RemoveTrackingCodesFromUrl();

    async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource | ur.TransformedResource> {
        const cleanedURI = resource.uri.replace(/(?<=&|\?)utm_.*?(&|$)/igm, "");
        if (cleanedURI != resource.uri) {
            const transformed: ur.TransformedResource = {
                isTransformedResource: true,
                ...resource,
                pipePosition: ur.nextTransformationPipePosition(resource),
                transformedFromUR: resource,
                remarks: "Removed utm_* tracking parameters from URL",
            }
            return transformed;
        } else {
            return resource;
        }
    }
}

export interface FollowedResource extends ur.TransformedResource {
    readonly isFollowedResource: true;
    readonly terminalResult: f.VisitResult;
    readonly followResults: f.VisitResult[];
}

export function isFollowedResource(o: any): o is FollowedResource {
    return o && "isFollowedResource" in o;
}

export class FollowRedirectsGranular implements ur.UniformResourceTransformer {
    static readonly singleton = new FollowRedirectsGranular();

    async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource | ur.InvalidResource | FollowedResource> {
        let result: ur.UniformResource | ur.InvalidResource | FollowedResource = resource;
        const visitResults = await f.follow(resource.uri);
        if (visitResults.length > 0) {
            const last = visitResults[visitResults.length - 1];
            if (f.isTerminalResult(last)) {
                result = {
                    isTransformedResource: true,
                    ...resource,
                    pipePosition: ur.nextTransformationPipePosition(resource),
                    transformedFromUR: resource,
                    remarks: "Followed, with " + visitResults.length + " results",
                    isFollowedResource: true,
                    followResults: visitResults,
                    uri: last.url,
                    content: f.isTerminalTextContentResult(last) ? new c.TypicalQueryableHtmlContent(last.content) : undefined,
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

export function transformationPipe(...chain: ur.UniformResourceTransformer[]): ur.UniformResourceTransformer {
    if (chain.length == 0) {
        return new class implements ur.UniformResourceTransformer {
            async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource> {
                return resource;
            }
        }()
    }
    if (chain.length == 1) {
        return new class implements ur.UniformResourceTransformer {
            async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource | ur.TransformedResource> {
                return await chain[0].transform(ctx, resource);
            }
        }()
    }
    return new class implements ur.UniformResourceTransformer {
        async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource | ur.TransformedResource> {
            let result = await chain[0].transform(ctx, resource);
            for (let i = 1; i < chain.length; i++) {
                result = await chain[i].transform(ctx, result);
            }
            return result;
        }
    }()
}

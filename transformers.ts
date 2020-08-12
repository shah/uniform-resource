import { Cache, lruCache } from "./cache";
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
                    isTransformedResource: true,
                    ...resource,
                    pipePosition: ur.nextTransformationPipePosition(resource),
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

export class EnrichGovernedContent implements ur.UniformResourceTransformer {
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

export interface QueryableHtmlContentResource extends FollowedResource, c.GovernedContent {
    readonly isQueryableHtmlContentResource: true;
    readonly content: c.QueryableHtmlContent;
}

export function isQueryableHtmlContentResource(o: any): o is QueryableHtmlContentResource {
    return o && "isQueryableHtmlContentResource" in o;
}

export class EnrichQueryableHtmlContent implements ur.UniformResourceTransformer {
    static readonly singleton = new EnrichQueryableHtmlContent();

    async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource | QueryableHtmlContentResource> {
        let result: ur.UniformResource | QueryableHtmlContentResource = resource;
        if (isFollowedResource(resource) && f.isTerminalTextContentResult(resource.terminalResult)) {
            const textResult = resource.terminalResult;
            result = {
                isQueryableHtmlContentResource: true,
                ...resource,
                content: new c.TypicalQueryableHtmlContent(textResult.contentText),
                contentType: textResult.contentType,
                mimeType: textResult.mimeType
            };
        }
        return result;
    }
}

export interface ReadableContentAsyncSupplier {
    (): Promise<{ [key: string]: any }>;
}

export interface ReadableContentSupplier {
    (): { [key: string]: any };
}

export interface ReadableContentResource extends FollowedResource, c.GovernedContent {
    readonly isReadableContentResource: true;
    readonly mercuryReadable: ReadableContentAsyncSupplier;
    readonly mozillaReadable: ReadableContentSupplier;
}

export function isReadableContentResource(o: any): o is ReadableContentResource {
    return o && "isReadableContentResource" in o;
}

export class EnrichReadableContent implements ur.UniformResourceTransformer {
    static readonly singleton = new EnrichReadableContent();

    async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource | ReadableContentResource | (ReadableContentResource & QueryableHtmlContentResource)> {
        let result: ur.UniformResource | ReadableContentResource | (ReadableContentResource & QueryableHtmlContentResource) = resource;
        if (isQueryableHtmlContentResource(resource)) {
            return {
                isReadableContentResource: true,
                ...resource,
                mercuryReadable: async (): Promise<{ [key: string]: any }> => {
                    const Mercury = require('@postlight/mercury-parser');
                    return await Mercury.parse(resource.uri, { html: resource.content.htmlSource });
                },
                mozillaReadable: (): { [key: string]: any } => {
                    const { Readability } = require('@mozilla/readability');
                    const { JSDOM } = require('jsdom');
                    const jd = new JSDOM(resource.content.htmlSource, { url: resource.uri })
                    const reader = new Readability(jd.window.document);
                    return reader.parse();
                }
            }
        }
        if (isFollowedResource(resource) && f.isTerminalTextContentResult(resource.terminalResult)) {
            const textResult = resource.terminalResult;
            return {
                isReadableContentResource: true,
                ...resource,
                mercuryReadable: async (): Promise<{ [key: string]: any }> => {
                    const Mercury = require('@postlight/mercury-parser');
                    return await Mercury.parse(resource.uri, { html: textResult.contentText });
                },
                mozillaReadable: (): { [key: string]: any } => {
                    const { Readability } = require('@mozilla/readability');
                    const { JSDOM } = require('jsdom');
                    const jd = new JSDOM(textResult.contentText, { url: resource.uri })
                    const reader = new Readability(jd.window.document);
                    return reader.parse();
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

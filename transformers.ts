import { follow, VisitResult } from "./follow-urls";
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
                remarks: "Removed line breaks and trimmed spaces"
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
                remarks: "Removed utm_* tracking parameters",
            }
            return transformed;
        } else {
            return resource;
        }
    }
}

export interface FollowedResource extends ur.TransformedResource {
    readonly isFollowedResource: true;
    readonly followResults: VisitResult[];
}

export class FollowRedirectsGranular implements ur.UniformResourceTransformer {
    static readonly singleton = new FollowRedirectsGranular();

    async transform(ctx: ur.UniformResourceContext, resource: ur.UniformResource): Promise<ur.UniformResource | FollowedResource> {
        let result: ur.UniformResource | FollowedResource = resource;
        const visitResults = await follow(resource.uri);
        if (visitResults.length > 1) {
            const last = visitResults[visitResults.length - 1];
            result = {
                isTransformedResource: true,
                ...resource,
                pipePosition: ur.nextTransformationPipePosition(resource),
                transformedFromUR: resource,
                remarks: "Followed, with " + visitResults.length + " results",
                isFollowedResource: true,
                followResults: visitResults,
                uri: last.url
            };
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

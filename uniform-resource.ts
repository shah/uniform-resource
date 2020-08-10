import cheerio from "cheerio";
import { follow, VisitResult } from "./follow-urls"

export type UniformResourceIdentifier = string;
export type UniformResourceLabel = string;
export type UniformResourceName = string;
export type DigitalObjectIdentifier = string;

export interface UniformResourcesSupplier {
    readonly isUniformResourceSupplier: true;
    readonly resources?: UniformResource[];
    forEachResource?(urc: UniformResourceConsumer): Promise<void>;
}

export interface UniformResourceProvenance {
    readonly isUniformResourceProvenance: true;
    readonly originURN: UniformResourceName;
}

export interface UniformResource {
    readonly isUniformResource: true;
    readonly provenance: UniformResourceProvenance;
    readonly uri: UniformResourceIdentifier;
    readonly doi?: DigitalObjectIdentifier;
    readonly label?: UniformResourceLabel;
}

export interface TransformedResource extends UniformResource {
    readonly isTransformedResource: true;
    readonly chainIndex: number;
    readonly original: UniformResource;
    readonly remarks?: string;
}

export function isTransformedResource(o: any): o is TransformedResource {
    return o && "isTransformedResource" in o;
}

export function transformationChainIndex(o: any): number {
    return isTransformedResource(o) ? o.chainIndex + 1 : 0;
}

export function allTransformationRemarks(tr: TransformedResource): string[] {
    const result: string[] = [];
    let active: UniformResource = tr;
    while (isTransformedResource(active)) {
        result.unshift(active.remarks || "(no remarks)");
        active = active.original;
    }
    return result;
}

export interface UniformResourceFilterReporter {
    (resource: UniformResource): void;
}

export interface UniformResourceFilter {
    retainOriginal?(resource: UniformResource): boolean;
    retainTransformed?(resource: UniformResource | TransformedResource): boolean;
}

export interface UniformResourceTransformer {
    transform(resource: UniformResource): Promise<UniformResource | TransformedResource>;
}

export interface UniformResourceFindOptions {
    readonly originURI?: UniformResourceIdentifier
}

export interface UniformResourceStore {
    find(options: UniformResourceFindOptions): UniformResource;
}

export interface UniformResourceLocation {
    readonly isUniformResourceLocation: true;
    readonly url: URL;
}

export interface UniformResourceConsumer {
    (resource: UniformResource): void;
}

export class BrowserTraversibleFilter implements UniformResourceFilter {
    static singleton = new BrowserTraversibleFilter();

    constructor(readonly reporter?: UniformResourceFilterReporter) {
    }

    retainOriginal(resource: UniformResource): boolean {
        if (resource.uri.startsWith("mailto:")) {
            if (this.reporter) {
                this.reporter(resource);
            }
            return false;
        }
        return true;
    }
}

export class RemoveLabelLineBreaksAndTrimSpaces implements UniformResourceTransformer {
    static singleton = new RemoveLabelLineBreaksAndTrimSpaces();

    async transform(resource: UniformResource): Promise<UniformResource | TransformedResource> {
        if (!resource.label) {
            return resource;
        }

        const cleanLabel = resource.label.replace(/\r\n|\n|\r/gm, " ").trim()
        if (cleanLabel != resource.label) {
            return {
                isTransformedResource: true,
                ...resource,
                chainIndex: transformationChainIndex(resource),
                original: resource,
                label: resource.label
                    ? resource.label.replace(/\r\n|\n|\r/gm, " ").trim()
                    : undefined,
                remarks: "Removed line breaks and trimmed spaces"
            }
        }
        return resource;
    }
}

export interface FollowedResource extends TransformedResource {
    readonly isFollowedResource: true;
    readonly followResults: VisitResult[];
}

export class FollowLinksAndRemoveTracking implements UniformResourceTransformer {
    static singleton = new FollowLinksAndRemoveTracking();

    removeTracking(resource: UniformResource): UniformResource {
        const cleanedURI = resource.uri.replace(/(?<=&|\?)utm_.*?(&|$)/igm, "");
        if (cleanedURI != resource.uri) {
            const transformed: TransformedResource = {
                isTransformedResource: true,
                ...resource,
                chainIndex: transformationChainIndex(resource),
                original: resource,
                remarks: "Removed utm_* tracking parameters",
            }
            return transformed;
        } else {
            return resource;
        }
    }

    async transform(resource: UniformResource): Promise<UniformResource | FollowedResource> {
        let result: UniformResource | FollowedResource = resource;
        const visitResults = await follow(resource.uri);
        if (visitResults.length > 1) {
            const last = visitResults[visitResults.length - 1];
            result = {
                isTransformedResource: true,
                ...resource,
                chainIndex: transformationChainIndex(resource),
                original: resource,
                remarks: "Followed, with " + visitResults.length + " results",
                isFollowedResource: true,
                followResults: visitResults,
                uri: last.url
            };
        }
        return this.removeTracking(result);
    }
}

export function chainedFilter(...chain: UniformResourceFilter[]): UniformResourceFilter {
    return new class implements UniformResourceFilter {
        retainOriginal(resource: UniformResource): boolean {
            for (const c of chain) {
                if (c.retainOriginal) {
                    if (!c.retainOriginal(resource)) {
                        return false;
                    }
                }
            }
            return true;
        }

        retainTransformed(resource: TransformedResource): boolean {
            for (const c of chain) {
                if (c.retainTransformed) {
                    if (!c.retainTransformed(resource)) {
                        return false;
                    }
                }
            }
            return true;
        }
    }()
}

export function chainedTransformer(...chain: UniformResourceTransformer[]): UniformResourceTransformer {
    if (chain.length == 0) {
        return new class implements UniformResourceTransformer {
            async transform(resource: UniformResource): Promise<UniformResource> {
                return resource;
            }
        }()
    }
    if (chain.length == 1) {
        return new class implements UniformResourceTransformer {
            async transform(resource: UniformResource): Promise<UniformResource | TransformedResource> {
                return await chain[0].transform(resource);
            }
        }()
    }
    return new class implements UniformResourceTransformer {
        async transform(resource: UniformResource): Promise<UniformResource | TransformedResource> {
            let result = await chain[0].transform(resource);
            for (let i = 1; i < chain.length; i++) {
                result = await chain[i].transform(result);
            }
            return result;
        }
    }()
}

export interface EmailMessageOptions {
    readonly originURN: UniformResourceName;
    readonly htmlSource: string;
    readonly filter?: UniformResourceFilter;
    readonly transformer?: UniformResourceTransformer;
}

export class EmailMessageResourcesSupplier implements UniformResourceProvenance, UniformResourcesSupplier {
    readonly isUniformResourceSupplier = true;
    readonly isUniformResourceProvenance = true;
    readonly content: CheerioStatic;
    readonly originURN: UniformResourceName;
    readonly filter?: UniformResourceFilter;
    readonly transformer?: UniformResourceTransformer;

    constructor({ originURN, htmlSource, filter, transformer }: EmailMessageOptions) {
        this.originURN = originURN;
        this.content = cheerio.load(htmlSource, {
            normalizeWhitespace: true,
            decodeEntities: true,
        });
        this.filter = filter;
        this.transformer = transformer;
    }

    async forEachResource(consume: UniformResourceConsumer): Promise<void> {
        const resources: UniformResource[] = [];
        this.content("a").each((index, anchor): void => {
            const originURI = anchor.attribs["href"];
            if (originURI) {
                const originLabel = this.content(anchor).text();
                let original: UniformResource = {
                    isUniformResource: true,
                    provenance: this,
                    uri: originURI,
                    label: originLabel
                };
                if (this.filter && this.filter.retainOriginal) {
                    if (this.filter.retainOriginal(original)) {
                        resources.push(original);
                    }
                }
            }
        });
        for (const original of resources) {
            if (this.transformer) {
                let transformed = await this.transformer.transform(original);
                if (this.filter && this.filter.retainTransformed) {
                    if (!this.filter.retainTransformed(transformed)) {
                        return;
                    }
                }
                consume(transformed);
            } else {
                consume(original);
            }
        }
    }
}

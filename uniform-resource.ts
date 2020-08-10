import * as c from "./content";

export type UniformResourceIdentifier = string;
export type UniformResourceLabel = string;
export type UniformResourceName = string;
export type DigitalObjectIdentifier = string;

export interface UniformResourceContext {
    readonly isUniformResourceContext: true;
}

export interface UniformResourcesSupplier {
    readonly isUniformResourceSupplier: true;
    resourceFromAnchor(
        ctx: UniformResourceContext,
        anchor: c.HtmlAnchor): Promise<UniformResource | undefined>
    forEachResource?(
        ctx: UniformResourceContext,
        urc: UniformResourceConsumer): Promise<void>;
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
    readonly content?: c.QueryableContent;
}

export interface TransformedResource extends UniformResource {
    readonly isTransformedResource: true;
    readonly transformedFromUR: UniformResource;
    readonly pipePosition: number;
    readonly remarks?: string;
}

export function isTransformedResource(o: any): o is TransformedResource {
    return o && "isTransformedResource" in o;
}

export function transformationPipePosition(o: any): number {
    return isTransformedResource(o) ? o.pipePosition + 1 : 0;
}

export function allTransformationRemarks(tr: TransformedResource): string[] {
    const result: string[] = [];
    let active: UniformResource = tr;
    while (isTransformedResource(active)) {
        result.unshift(active.remarks || "(no remarks)");
        active = active.transformedFromUR;
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
    transform(ctx: UniformResourceContext, resource: UniformResource): Promise<UniformResource | TransformedResource>;
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

export interface CommonSupplierOptions {
    readonly originURN: UniformResourceName;
    readonly filter?: UniformResourceFilter;
    readonly transformer?: UniformResourceTransformer;
}

export interface EmailMessageOptions extends CommonSupplierOptions {
    readonly htmlSource: string;
}

export class TypicalResourcesSupplier implements UniformResourceProvenance, UniformResourcesSupplier {
    readonly isUniformResourceSupplier = true;
    readonly isUniformResourceProvenance = true;
    readonly originURN: UniformResourceName;
    readonly filter?: UniformResourceFilter;
    readonly transformer?: UniformResourceTransformer;

    constructor({ originURN, filter, transformer }: CommonSupplierOptions) {
        this.originURN = originURN;
        this.filter = filter;
        this.transformer = transformer;
    }

    async resourceFromAnchor(ctx: UniformResourceContext, anchor: c.HtmlAnchor): Promise<UniformResource | undefined> {
        let original: UniformResource = {
            isUniformResource: true,
            provenance: this,
            uri: anchor.href,
            label: anchor.label
        };
        if (this.filter && this.filter.retainOriginal) {
            if (!this.filter.retainOriginal(original)) {
                return undefined;
            }
        }
        if (this.transformer) {
            const transformed = await this.transformer.transform(ctx, original);
            if (this.filter && this.filter.retainTransformed) {
                if (!this.filter.retainTransformed(transformed)) {
                    return undefined;
                }
            }
            return transformed;
        } else {
            return original;
        }
    }
}

export class HtmlContentResourcesSupplier extends TypicalResourcesSupplier {
    readonly content: c.QueryableHtmlContent;

    constructor({ originURN, htmlSource, filter, transformer }: EmailMessageOptions) {
        super({ originURN, filter, transformer });
        this.content = new c.TypicalQueryableHtmlContent(htmlSource);
    }

    async forEachResource(ctx: UniformResourceContext, consume: UniformResourceConsumer): Promise<void> {
        const anchors = this.content.anchors();
        for (const anchor of anchors) {
            const ur = await this.resourceFromAnchor(ctx, anchor);
            if (ur) consume(ur);
        }
    }
}

export class EmailMessageResourcesSupplier extends HtmlContentResourcesSupplier {
}
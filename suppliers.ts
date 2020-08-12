import * as c from "./content";
import * as fl from "./filters";
import * as tr from "./transformers";
import * as ur from "./uniform-resource";

export interface TypicalSupplierOptions {
    readonly originURN: ur.UniformResourceName;
    readonly filter?: fl.UniformResourceFilter;
    readonly unifResourceTr?: tr.UniformResourceTransformer;
}

export class TypicalResourcesSupplier implements ur.UniformResourceProvenance, ur.UniformResourcesSupplier {
    readonly isUniformResourceSupplier = true;
    readonly isUniformResourceProvenance = true;
    readonly originURN: ur.UniformResourceName;
    readonly filter?: fl.UniformResourceFilter;
    readonly unifResourceTr?: tr.UniformResourceTransformer;

    constructor({ originURN, filter, unifResourceTr: transformer }: TypicalSupplierOptions) {
        this.originURN = originURN;
        this.filter = filter;
        this.unifResourceTr = transformer;
    }

    async resourceFromAnchor(ctx: ur.UniformResourceContext, anchor: c.HtmlAnchor): Promise<ur.UniformResource | undefined> {
        let original: ur.UniformResource = {
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
        if (this.unifResourceTr) {
            const transformed = await this.unifResourceTr.transform(ctx, original);
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

export interface HtmlContentSupplierOptions extends TypicalSupplierOptions {
}

export class HtmlContentResourcesSupplier extends TypicalResourcesSupplier {
    constructor(readonly htmlContent: c.QueryableHtmlContent, readonly options: HtmlContentSupplierOptions) {
        super(options);
    }

    async forEachResource(ctx: ur.UniformResourceContext, consume: ur.UniformResourceConsumer): Promise<void> {
        const anchors = this.htmlContent.anchors();
        for (const anchor of anchors) {
            const ur = await this.resourceFromAnchor(ctx, anchor);
            if (ur) consume(ur);
        }
    }
}

export class EmailMessageResourcesSupplier extends HtmlContentResourcesSupplier {
}
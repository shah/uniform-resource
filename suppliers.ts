import * as c from "./content";
import * as ur from "./uniform-resource";

export interface TypicalSupplierOptions {
    readonly originURN: ur.UniformResourceName;
    readonly filter?: ur.UniformResourceFilter;
    readonly transformer?: ur.UniformResourceTransformer;
}

export class TypicalResourcesSupplier implements ur.UniformResourceProvenance, ur.UniformResourcesSupplier {
    readonly isUniformResourceSupplier = true;
    readonly isUniformResourceProvenance = true;
    readonly originURN: ur.UniformResourceName;
    readonly filter?: ur.UniformResourceFilter;
    readonly transformer?: ur.UniformResourceTransformer;

    constructor({ originURN, filter, transformer }: TypicalSupplierOptions) {
        this.originURN = originURN;
        this.filter = filter;
        this.transformer = transformer;
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

export interface HtmlContentSupplierOptions extends TypicalSupplierOptions {
    readonly htmlSource: string;
}

export class HtmlContentResourcesSupplier extends TypicalResourcesSupplier {
    readonly content: c.QueryableHtmlContent;

    constructor({ originURN, htmlSource, filter, transformer }: HtmlContentSupplierOptions) {
        super({ originURN, filter, transformer });
        this.content = new c.TypicalQueryableHtmlContent(htmlSource);
    }

    async forEachResource(ctx: ur.UniformResourceContext, consume: ur.UniformResourceConsumer): Promise<void> {
        const anchors = this.content.anchors();
        for (const anchor of anchors) {
            const ur = await this.resourceFromAnchor(ctx, anchor);
            if (ur) consume(ur);
        }
    }
}

export class EmailMessageResourcesSupplier extends HtmlContentResourcesSupplier {
}
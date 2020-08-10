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


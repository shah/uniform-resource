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

export interface UniformResourceConsumer {
    (resource: UniformResource): void;
}

export interface UniformResourceProvenance {
    readonly isUniformResourceProvenance: true;
    readonly originURN: UniformResourceName;
}

// NOTE: for all UniformResource and related interfaces be careful using functions
// (unless the functions are properties) because the spread operator is used for copying
// of resource contents often (especially in transfomers).

export interface UniformResource {
    readonly isUniformResource: true;
    readonly provenance: UniformResourceProvenance;
    readonly uri: UniformResourceIdentifier;
    readonly doi?: DigitalObjectIdentifier;
    readonly label?: UniformResourceLabel;
}

export interface InvalidResource extends UniformResource {
    readonly isInvalidResource: true;
    readonly error: Error;
    readonly remarks?: string;
}

export function isInvalidResource(o: any): o is InvalidResource {
    return o && "isInvalidResource" in o;
}


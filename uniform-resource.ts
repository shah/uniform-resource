import cheerio from "cheerio";
import mime from "whatwg-mimetype";
import * as tru from "@shah/traverse-urls";

/*******************************
 * Uniform resource governance *
 *******************************/

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
        anchor: HtmlAnchor): Promise<UniformResource | undefined>
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
// of resource instances often (especially in resource transfomers).

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

/**********************
 * Content governance *
 **********************/

export type ContentBody = string;
export type ContentTitle = string;
export type ContentAbstract = string;

// NOTE: for all GovernedContent and related interfaces be careful using functions
// (unless the functions are properties) because the spread operator is used for copying
// of contents often (especially in content transfomers).

export interface GovernedContent {
    readonly contentType: string;
    readonly mimeType: mime;
}

export function isGovernedContent(o: any): o is GovernedContent {
    return o && ("contentType" in o) && ("mimeType" in o);
}

export interface GovernedContentContext {
    readonly uri: string;
    readonly htmlSource: string;
}

export interface HtmlAnchor {
    readonly href: string;
    readonly label?: string;
}

export interface AnchorFilter {
    (retain: HtmlAnchor): boolean;
}

export interface CuratableContent extends GovernedContent {
    readonly title: ContentTitle;
    readonly socialGraph: SocialGraph;
}

export function isCuratableContent(o: any): o is CuratableContent {
    return o && "title" in o && "socialGraph" in o;
}

export interface QueryableHtmlContent extends GovernedContent {
    readonly htmlSource: string;
    readonly document: CheerioStatic;
    readonly anchors: (retain?: AnchorFilter) => HtmlAnchor[];
}

export function isQueryableHtmlContent(o: any): o is QueryableHtmlContent {
    return o && "htmlSource" in o && "document" in o;
}

export interface OpenGraph {
    type?: string;
    title?: ContentTitle;
    description?: ContentAbstract;
    imageURL?: string;
}

export interface TwitterCard {
    title?: ContentTitle;
    description?: ContentAbstract;
    imageURL?: string;
    site?: string;
    creator?: string;
}

export interface SocialGraph {
    readonly openGraph?: Readonly<OpenGraph>;
    readonly twitter?: Readonly<TwitterCard>;
}

export interface TransformedContent extends GovernedContent {
    readonly transformedFromContent: GovernedContent;
    readonly pipePosition: number;
    readonly remarks?: string;
}

export function isTransformedContent(o: any): o is TransformedContent {
    return o && "transformedFromContent" in o;
}

/************************
 * Content transformers *
 ************************/

export interface ContentTransformer {
    transform(ctx: GovernedContentContext, content: GovernedContent): Promise<GovernedContent>;
}

export class EnrichQueryableHtmlContent implements ContentTransformer {
    static readonly singleton = new EnrichQueryableHtmlContent();

    async transform(ctx: GovernedContentContext, content: GovernedContent): Promise<GovernedContent | QueryableHtmlContent> {
        if (isQueryableHtmlContent(content)) {
            // it's already queryable so don't touch it
            return content;
        }

        // enrich the existing content with cheerio static document
        const document = cheerio.load(ctx.htmlSource, {
            normalizeWhitespace: true,
            decodeEntities: true,
        })
        return {
            ...content,
            htmlSource: ctx.htmlSource,
            document: document,
            anchors: (retain?: AnchorFilter): HtmlAnchor[] => {
                const result: HtmlAnchor[] = []
                document("a").each((index, anchorTag): void => {
                    const href = anchorTag.attribs["href"];
                    if (href) {
                        const anchor: HtmlAnchor = {
                            href: href,
                            label: document(anchorTag).text()
                        }
                        if (retain) {
                            if (retain(anchor)) result.push(anchor);
                        } else {
                            result.push(anchor);
                        }
                    }
                });
                return result;
            }
        };
    }
}

export class BuildCuratableContent implements ContentTransformer {
    static readonly singleton = new BuildCuratableContent();

    parseSocialGraph(ctx: GovernedContentContext, document: CheerioStatic): SocialGraph {
        let og: OpenGraph = {};
        let tc: TwitterCard = {};
        const metaTransformers: {
            [key: string]: (v: string) => void;
        } = {
            'og:type': (v: string) => { og.type = v },
            'og:title': (v: string) => { og.title = v },
            'og:description': (v: string) => { og.description = v },
            'og:image': (v: string) => { og.imageURL = v },
            'twitter:title': (v: string) => { tc.title = v },
            'twitter:image': (v: string) => { tc.imageURL = v },
            'twitter:description': (v: string) => { tc.description = v },
            'twitter:site': (v: string) => { tc.site = v },
            'twitter:creator': (v: string) => { tc.creator = v },
        };
        const meta = document('meta') as any;
        const keys = Object.keys(meta);
        for (const outerKey in metaTransformers) {
            keys.forEach(function (innerKey) {
                if (meta[innerKey].attribs
                    && meta[innerKey].attribs.property
                    && meta[innerKey].attribs.property === outerKey) {
                    metaTransformers[outerKey](meta[innerKey].attribs.content);
                }
            })
        }
        const result: { [key: string]: any } = {};
        if (Object.keys(og).length > 0) result.openGraph = og;
        if (Object.keys(tc).length > 0) result.twitter = tc;
        return result as SocialGraph;
    }

    title(ctx: GovernedContentContext, document: CheerioStatic, sg?: SocialGraph): string {
        // If an og:title is available, use it otherwise use twitter:title otherwise use page title
        const socialGraph = sg ? sg : this.parseSocialGraph(ctx, document);
        let result = document('head > title').text();
        if (socialGraph.twitter?.title)
            result = socialGraph.twitter.title;
        if (socialGraph.openGraph?.title)
            result = socialGraph.openGraph.title;
        return result;
    }

    async transform(ctx: GovernedContentContext, content: GovernedContent): Promise<GovernedContent | CuratableContent> {
        let result: GovernedContent | QueryableHtmlContent = content;
        if (!isQueryableHtmlContent(result)) {
            // first make it queryable
            result = await EnrichQueryableHtmlContent.singleton.transform(ctx, result);
        }

        if (isQueryableHtmlContent(result)) {
            const socialGraph = this.parseSocialGraph(ctx, result.document)
            return {
                ...result,
                title: this.title(ctx, result.document, socialGraph),
                socialGraph: socialGraph
            };
        } else {
            console.error("[EnrichCuratableContent.transform()] This should never happen!")
            return content;
        }
    }
}

export class StandardizeCurationTitle implements ContentTransformer {
    // RegEx matches " | Healthcare IT News" from a title like "xyz title | Healthcare IT News"
    static readonly sourceNameAfterPipeRegEx = / \| .*$/;
    static readonly singleton = new StandardizeCurationTitle();

    async transform(ctx: GovernedContentContext, content: GovernedContent): Promise<GovernedContent | CuratableContent | TransformedContent> {
        if (isCuratableContent(content)) {
            const suggested = content.title;
            const standardized = suggested.replace(StandardizeCurationTitle.sourceNameAfterPipeRegEx, "");
            if (suggested != standardized) {
                return {
                    ...content,
                    title: standardized,
                    transformedFromContent: content,
                    pipePosition: nextTransformationPipePosition(content),
                    remarks: `Standardized title (was "${suggested}")`
                }
            }
        }
        return content;
    }
}

export interface ReadableContentAsyncSupplier {
    (): Promise<{ [key: string]: any }>;
}

export interface MercuryReadableContent extends GovernedContent {
    readonly mercuryReadable: ReadableContentAsyncSupplier;
}

export function isMercuryReadableContent(o: any): o is MercuryReadableContent {
    return o && "mercuryReadable" in o;
}

export class EnrichMercuryReadableContent implements ContentTransformer {
    static readonly singleton = new EnrichMercuryReadableContent();

    async transform(ctx: GovernedContentContext, content: GovernedContent): Promise<MercuryReadableContent> {
        return {
            ...content,
            mercuryReadable: async (): Promise<{ [key: string]: any }> => {
                const Mercury = require('@postlight/mercury-parser');
                return await Mercury.parse(ctx.uri, { html: ctx.htmlSource });
            },
        }
    }
}

export interface ReadableContentSupplier {
    (): { [key: string]: any };
}

export interface MozillaReadabilityContent extends GovernedContent {
    readonly mozillaReadability: ReadableContentSupplier;
}

export function isMozillaReadabilityContent(o: any): o is MozillaReadabilityContent {
    return o && "mozillaReadability" in o;
}

export class EnrichMozillaReadabilityContent implements ContentTransformer {
    static readonly singleton = new EnrichMozillaReadabilityContent();

    async transform(ctx: GovernedContentContext, content: GovernedContent): Promise<MozillaReadabilityContent> {
        return {
            ...content,
            mozillaReadability: (): { [key: string]: any } => {
                const { Readability } = require('@mozilla/readability');
                const { JSDOM } = require('jsdom');
                const jd = new JSDOM(ctx.htmlSource, { url: ctx.uri })
                const reader = new Readability(jd.window.document);
                return reader.parse();
            }
        }
    }
}

export function contentTransformationPipe(...chain: ContentTransformer[]): ContentTransformer {
    if (chain.length == 0) {
        return new class implements ContentTransformer {
            async transform(ctx: GovernedContentContext, content: GovernedContent): Promise<GovernedContent> {
                return content;
            }
        }()
    }
    if (chain.length == 1) {
        return new class implements ContentTransformer {
            async transform(ctx: GovernedContentContext, content: GovernedContent): Promise<GovernedContent> {
                return await chain[0].transform(ctx, content);
            }
        }()
    }
    return new class implements ContentTransformer {
        async transform(ctx: GovernedContentContext, content: GovernedContent): Promise<GovernedContent> {
            let result = await chain[0].transform(ctx, content);
            for (let i = 1; i < chain.length; i++) {
                result = await chain[i].transform(ctx, result);
            }
            return result;
        }
    }()
}

/************************************
 * Uniform resource transformations *
 ************************************/

export interface TransformedResource extends UniformResource {
    readonly transformedFromUR: UniformResource;
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
    let active: UniformResource = tr;
    while (isTransformedResource(active)) {
        result.unshift(active.remarks || "(no remarks)");
        active = active.transformedFromUR;
    }
    return result;
}

export interface UniformResourceTransformer {
    transform(ctx: UniformResourceContext, resource: UniformResource): Promise<UniformResource>;
}

export class RemoveLabelLineBreaksAndTrimSpaces implements UniformResourceTransformer {
    static readonly singleton = new RemoveLabelLineBreaksAndTrimSpaces();

    async transform(ctx: UniformResourceContext, resource: UniformResource): Promise<UniformResource | TransformedResource> {
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

    async transform(ctx: UniformResourceContext, resource: UniformResource): Promise<UniformResource | TransformedResource> {
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
    readonly terminalResult: tru.VisitResult;
    readonly followResults: tru.VisitResult[];
}

export function isFollowedResource(o: any): o is FollowedResource {
    return o && "isFollowedResource" in o;
}

export class FollowRedirectsGranular implements UniformResourceTransformer {
    static readonly singleton = new FollowRedirectsGranular();

    constructor(readonly cache: Cache<tru.VisitResult[]> = lruCache()) {
    }

    async transform(ctx: UniformResourceContext, resource: UniformResource): Promise<UniformResource | InvalidResource | FollowedResource> {
        let result: UniformResource | InvalidResource | FollowedResource = resource;
        let visitResults = this.cache[resource.uri];
        if (!visitResults) {
            visitResults = await tru.traverse(resource.uri);
            this.cache[resource.uri] = visitResults;
        }
        if (visitResults.length > 0) {
            const last = visitResults[visitResults.length - 1];
            if (tru.isTerminalResult(last)) {
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
            } else if (tru.isVisitError(last)) {
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

    async transform(ctx: UniformResourceContext, resource: UniformResource): Promise<UniformResource | (UniformResource & GovernedContent)> {
        let result: UniformResource | (UniformResource & GovernedContent) = resource;
        if (isFollowedResource(resource) && tru.isTerminalTextContentResult(resource.terminalResult)) {
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

export interface CuratableContentResource extends UniformResource {
    readonly curatableContent: CuratableContent;
}

export function isCuratableContentResource(o: any): o is CuratableContentResource {
    return o && ("curatableContent" in o);
}

export class EnrichCuratableContent implements UniformResourceTransformer {
    static readonly standard = new EnrichCuratableContent(contentTransformationPipe(
        BuildCuratableContent.singleton,
        StandardizeCurationTitle.singleton));
    static readonly readable = new EnrichCuratableContent(contentTransformationPipe(
        BuildCuratableContent.singleton,
        StandardizeCurationTitle.singleton,
        EnrichMercuryReadableContent.singleton,
        EnrichMozillaReadabilityContent.singleton));

    constructor(readonly contentTr: ContentTransformer) {
    }

    async transform(ctx: UniformResourceContext, resource: UniformResource): Promise<UniformResource | CuratableContentResource> {
        let result: UniformResource | CuratableContentResource = resource;
        if (isFollowedResource(resource) && tru.isTerminalTextContentResult(resource.terminalResult)) {
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
                curatableContent: content as CuratableContent,
            };
        }
        return result;
    }
}

export function transformationPipe(...chain: UniformResourceTransformer[]): UniformResourceTransformer {
    if (chain.length == 0) {
        return new class implements UniformResourceTransformer {
            async transform(ctx: UniformResourceContext, resource: UniformResource): Promise<UniformResource> {
                return resource;
            }
        }()
    }
    if (chain.length == 1) {
        return new class implements UniformResourceTransformer {
            async transform(ctx: UniformResourceContext, resource: UniformResource): Promise<UniformResource> {
                return await chain[0].transform(ctx, resource);
            }
        }()
    }
    return new class implements UniformResourceTransformer {
        async transform(ctx: UniformResourceContext, resource: UniformResource): Promise<UniformResource> {
            let result = await chain[0].transform(ctx, resource);
            for (let i = 1; i < chain.length; i++) {
                result = await chain[i].transform(ctx, result);
            }
            return result;
        }
    }()
}

/****************************
 * Uniform resource filters *
 ****************************/

export interface UniformResourceFilter {
    retainOriginal?(resource: UniformResource): boolean;
    retainTransformed?(resource: UniformResource | TransformedResource): boolean;
}

export interface UniformResourceFilterReporter {
    (resource: UniformResource): void;
}

export function filterPipe(...chain: UniformResourceFilter[]): UniformResourceFilter {
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

export class FilteredResourcesCounter {
    readonly reporters: {
        [key: string]: {
            removedCount: number;
            reporter: UniformResourceFilterReporter
        }
    } = {};

    count(key: string): number {
        return this.reporters[key].removedCount;
    }

    reporter(key: string): UniformResourceFilterReporter {
        const reporter = (resource: UniformResource): void => {
            this.reporters[key].removedCount++;
        }
        this.reporters[key] = {
            removedCount: 0,
            reporter: reporter
        }
        return reporter;
    }
}

export class BlankLabelFilter implements UniformResourceFilter {
    static readonly singleton = new BlankLabelFilter();

    constructor(readonly reporter?: UniformResourceFilterReporter) {
    }

    retainOriginal(resource: UniformResource): boolean {
        if (typeof resource.label === "undefined" || resource.label.length == 0) {
            if (this.reporter) {
                this.reporter(resource);
            }
            return false;
        }
        return true;
    }
}

export class BrowserTraversibleFilter implements UniformResourceFilter {
    static readonly singleton = new BrowserTraversibleFilter();

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

/******************************
 * Uniform resource suppliers *
 ******************************/

export interface TypicalSupplierOptions {
    readonly originURN: UniformResourceName;
    readonly filter?: UniformResourceFilter;
    readonly unifResourceTr?: UniformResourceTransformer;
}

export class TypicalResourcesSupplier implements UniformResourceProvenance, UniformResourcesSupplier {
    readonly isUniformResourceSupplier = true;
    readonly isUniformResourceProvenance = true;
    readonly originURN: UniformResourceName;
    readonly filter?: UniformResourceFilter;
    readonly unifResourceTr?: UniformResourceTransformer;

    constructor({ originURN, filter, unifResourceTr: transformer }: TypicalSupplierOptions) {
        this.originURN = originURN;
        this.filter = filter;
        this.unifResourceTr = transformer;
    }

    async resourceFromAnchor(ctx: UniformResourceContext, anchor: HtmlAnchor): Promise<UniformResource | undefined> {
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
    constructor(readonly htmlContent: QueryableHtmlContent, readonly options: HtmlContentSupplierOptions) {
        super(options);
    }

    async forEachResource(ctx: UniformResourceContext, consume: UniformResourceConsumer): Promise<void> {
        const anchors = this.htmlContent.anchors();
        for (const anchor of anchors) {
            const ur = await this.resourceFromAnchor(ctx, anchor);
            if (ur) consume(ur);
        }
    }
}

export class EmailMessageResourcesSupplier extends HtmlContentResourcesSupplier {
}

/*************
 * Utilities *
 *************/

export interface Cache<T> {
    [key: string]: T;
}

/**
 * Create a simple LRU cache which looks and acts like a normal object but
 * is backed by a Proxy object that stores expensive to construct objects.
 * @param maxEntries evict cached items after this many entries
 */
export function lruCache<T>(maxEntries: number = 50): Cache<T> {
    const result: Cache<T> = {};
    const handler = {
        // Set objects store the cache keys in insertion order.
        cache: new Set<string>(),
        get: function (obj: Cache<T>, key: string): T | undefined {
            const entry = obj[key];
            if (entry) {
                // move the most recent key to the end so it's last to be evicted
                this.cache.delete(key);
                this.cache.add(key);
            }
            return entry;
        },
        set: function (obj: Cache<T>, key: string, value: T): boolean {
            obj[key] = value;
            if (this.cache.size >= maxEntries) {
                // least-recently used cache eviction strategy, the oldest
                // item is the first one in the list
                const keyToDelete = this.cache.keys().next().value;
                delete obj[key];
                this.cache.delete(keyToDelete);
            }
            return true;
        }
    };
    return new Proxy(result, handler);
}


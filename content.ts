import cheerio from "cheerio";
import mime from "whatwg-mimetype";

export type ContentBody = string;
export type ContentTitle = string;
export type ContentAbstract = string;

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

export function nextTransformationPipePosition(o: any): number {
    return "pipePosition" in o ? o.pipePosition + 1 : 0;
}

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

export class EnrichCuratableContent implements ContentTransformer {
    static readonly singleton = new EnrichCuratableContent();

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

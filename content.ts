import cheerio from "cheerio";
import mime from "whatwg-mimetype";

export type ContentTitle = string;
export type ContentAbstract = string;

export interface GovernedContent {
    readonly contentType: string;
    readonly mimeType: mime;
}

export function isGovernedContent(o: any): o is GovernedContent {
    return o && ("contentType" in o) && ("mimeType" in o);
}

export interface QueryableContent {
    readonly isQueryableContent: true;
    readonly title?: ContentTitle;
    readonly socialGraph?: SocialGraph;
}

export interface AnchorFilter {
    (retain: HtmlAnchor): boolean;
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

export interface QueryableHtmlContent extends QueryableContent {
    readonly isQueryableHtmlContent: true;
    readonly title: ContentTitle;
    readonly socialGraph: SocialGraph;
    anchors(retain?: AnchorFilter): HtmlAnchor[];
}

export function isQueryableHtmlContent(o: any): o is QueryableHtmlContent {
    return o && "isQueryableHtmlContent" in o;
}

export interface HtmlAnchor {
    readonly href: string;
    readonly label?: string;
}

export interface ContentTitleTransformer {
    (suggested: ContentTitle, htmlContent: CheerioStatic): ContentTitle;
}

export const sourceNameAfterPipeRegEx = / \| .*$/;  // Matches " | Healthcare IT News" from a title like "xyz title | Healthcare IT News"
export const sourceNameAfterHyphenRegEx = / \- .*$/ // Matches " - Healthcare IT News" from a title like "xyz title - Healthcare IT News"
export const firstSentenceRegExp = /`^(.*?)[.?!]`/; // Matches the first sentence of any text

export function typicalTitleCleanser(suggested: ContentTitle, htmlContent: CheerioStatic): ContentTitle {
    // for now we'll just strip the vertical bar and after
    return suggested.replace(sourceNameAfterPipeRegEx, "");

    // TODO: when queryable HTML content is created, the UniformResource should be passed in with
    // the site title (e.g. "Healthcare IT News") so that the hyphen version can be replaced too.
    // For now, replacing hyphen is too dangerous because hyphens can be part of legitimate titles.
}

export class TypicalQueryableHtmlContent implements QueryableHtmlContent {
    readonly isQueryableContent = true;
    readonly isQueryableHtmlContent = true;
    readonly htmlContent: CheerioStatic;
    readonly title: ContentTitle;
    readonly socialGraph: SocialGraph;

    constructor(readonly htmlSource: string, transformTitle: ContentTitleTransformer = typicalTitleCleanser) {
        this.htmlContent = cheerio.load(htmlSource, {
            normalizeWhitespace: true,
            decodeEntities: true,
        });
        this.socialGraph = this.parseSocialGraph();

        // If an og:title is available, use it otherwise use twitter:title otherwise use page title
        // and then transform it per the given rule.
        let title = this.htmlContent('head > title').text();
        if (this.socialGraph.twitter?.title)
            title = this.socialGraph.twitter.title;
        if (this.socialGraph.openGraph?.title)
            title = this.socialGraph.openGraph.title;
        this.title = transformTitle(title, this.htmlContent);
    }

    protected parseSocialGraph(): SocialGraph {
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
        const meta = this.htmlContent('meta') as any;
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

    anchors(retain?: AnchorFilter): HtmlAnchor[] {
        const result: HtmlAnchor[] = []
        this.htmlContent("a").each((index, anchorTag): void => {
            const href = anchorTag.attribs["href"];
            if (href) {
                const anchor: HtmlAnchor = {
                    href: href,
                    label: this.htmlContent(anchorTag).text()
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
}

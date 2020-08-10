import cheerio from "cheerio";

export interface QueryableContent {
    readonly isQueryableContent: true;
}

export interface AnchorFilter {
    (retain: HtmlAnchor): boolean;
}

export interface QueryableHtmlContent extends QueryableContent {
    readonly isQueryableHtmlContent: true;
    anchors(retain?: AnchorFilter): HtmlAnchor[];
}

export function isQueryableHtmlContent(o: any): o is QueryableHtmlContent {
    return o && "isQueryableHtmlContent" in o;
}

export interface HtmlAnchor {
    readonly href: string;
    readonly label?: string;
}

export class TypicalQueryableHtmlContent implements QueryableHtmlContent {
    readonly isQueryableContent = true;
    readonly isQueryableHtmlContent = true;
    readonly htmlContent: CheerioStatic;

    constructor(readonly htmlSource: string) {
        this.htmlContent = cheerio.load(htmlSource, {
            normalizeWhitespace: true,
            decodeEntities: true,
        });
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

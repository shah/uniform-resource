import * as nf from "node-fetch";
import UserAgent from 'user-agents';
import mime from "whatwg-mimetype";

const metaRefreshPattern = '(CONTENT|content)=["\']0;[ ]*(URL|url)=(.*?)(["\']\s*>)';
const urlTrackingCodesPattern = /(?<=&|\?)utm_.*?(&|$)/igm;

export interface VisitResult {
    readonly url: string;
}

export interface VisitError extends VisitResult {
    readonly error: Error;
}

export function isVisitError(o: VisitResult): o is VisitError {
    return "error" in o;
}

export interface VisitSuccess extends VisitResult {
    readonly httpStatus: number;
    readonly httpHeaders: nf.Headers;
}

export interface RedirectResult extends VisitSuccess {
    readonly redirectUrl: string;
}

export function isRedirectResult(o: VisitResult): o is RedirectResult {
    return "redirectUrl" in o;
}

export interface HttpRedirectResult extends RedirectResult {
    readonly httpRedirect: boolean;
}

export function isHttpRedirectResult(o: VisitResult): o is HttpRedirectResult {
    return "httpRedirect" in o;
}

export interface ContentRedirectResult extends VisitSuccess {
    readonly metaRefreshRedirect: boolean;
    readonly contentText?: string;
    readonly contentType: string;
    readonly mimeType: mime;
}

export function isContentRedirectResult(o: VisitResult): o is ContentRedirectResult {
    return "metaRefreshRedirect" in o;
}

export interface TerminalResult extends VisitSuccess {
    readonly terminalResult: boolean;
    readonly contentType: string;
    readonly mimeType: mime;
}

export function isTerminalResult(o: VisitResult): o is TerminalResult {
    return "terminalResult" in o;
}

export interface TerminalTextContentResult extends TerminalResult {
    readonly terminalTextContentResult: boolean;
    readonly contentText: string;
}

export function isTerminalTextContentResult(o: VisitResult): o is TerminalTextContentResult {
    return "terminalTextContentResult" in o;
}

export type ConstrainedVisitResult = VisitError | HttpRedirectResult | ContentRedirectResult | TerminalResult | TerminalTextContentResult;

export interface FollowOptions {
    readonly userAgent: UserAgent;
    readonly maxRedirectDepth: number;
    readonly fetchTimeOut: number;
    readonly saveContentRedirectText: boolean;
    prepareUrlForFetch?(originalURL: string, position: number): string;
    extractMetaRefreshUrl(html: string): string | null;
    isRedirect(status: number): boolean;
}

async function visit(originalURL: string, position: number, options: FollowOptions): Promise<ConstrainedVisitResult> {
    const url = options.prepareUrlForFetch ? options.prepareUrlForFetch(originalURL, position) : originalURL;
    const response = await nf.default(url, {
        redirect: 'manual',
        follow: 0,
        timeout: options.fetchTimeOut,
        headers: {
            'User-Agent': options.userAgent.toString(),
        }
    })

    if (options.isRedirect(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
            return {
                url: url,
                error: new Error(`${url} responded with status ${response.status} but no location header`)
            }
        }
        return { url: url, httpRedirect: true, httpStatus: response.status, redirectUrl: location, httpHeaders: response.headers };
    }
    const contentType = response.headers.get("Content-Type")!
    const mimeType = new mime(contentType);
    if (response.status == 200) {
        if (mimeType.type == "text") {
            const text = await response.text();
            const redirectUrl = options.extractMetaRefreshUrl(text);
            return redirectUrl ?
                { url: url, metaRefreshRedirect: true, httpStatus: response.status, redirectUrl: redirectUrl, contentText: options.saveContentRedirectText ? text : undefined, httpHeaders: response.headers, contentType: contentType, mimeType: mimeType } :
                { url: url, httpStatus: response.status, terminalResult: true, terminalTextContentResult: true, contentText: text, httpHeaders: response.headers, contentType: contentType, mimeType: mimeType }
        }
    }
    return { url: url, httpStatus: response.status, httpHeaders: response.headers, terminalResult: true, contentType: contentType, mimeType: mimeType }
}

export class TypicalFollowOptions implements FollowOptions {
    static readonly singleton = new TypicalFollowOptions({});
    readonly userAgent: UserAgent;
    readonly maxRedirectDepth: number;
    readonly fetchTimeOut: number;
    readonly saveContentRedirectText: boolean;

    constructor({ userAgent, maxRedirectDepth, fetchTimeOut, saveContentRedirectText: cacheContentRedirectText }: Partial<FollowOptions>) {
        this.userAgent = userAgent || new UserAgent();
        this.maxRedirectDepth = typeof maxRedirectDepth === "undefined" ? 10 : maxRedirectDepth;
        this.fetchTimeOut = typeof fetchTimeOut === "undefined" ? 2500 : fetchTimeOut;
        this.saveContentRedirectText = typeof cacheContentRedirectText === "undefined" ? false : cacheContentRedirectText;
    }

    prepareUrlForFetch(url: string): string {
        return url.replace(urlTrackingCodesPattern, "")
    }

    extractMetaRefreshUrl(html: string): string | null {
        let match = html.match(metaRefreshPattern);
        return match && match.length == 5 ? match[3] : null;
    }

    isRedirect(status: number): boolean {
        return status === 301
            || status === 302
            || status === 303
            || status === 307
            || status === 308;
    }
};

export async function follow(originalURL: string, options = TypicalFollowOptions.singleton): Promise<VisitResult[]> {
    const visits: VisitResult[] = [];
    let url: string | undefined | null = originalURL;
    let position = 1;
    let continueVisiting = true;
    while (continueVisiting) {
        if (position > options.maxRedirectDepth) {
            throw `Exceeded max redirect depth of ${options.maxRedirectDepth}`
        }
        try {
            const visitResult: ConstrainedVisitResult = await visit(url!, position, options);
            position++;
            visits.push(visitResult);
            if (isRedirectResult(visitResult)) {
                continueVisiting = true;
                url = visitResult.redirectUrl;
            } else {
                continueVisiting = false;
            }
        } catch (err) {
            continueVisiting = false;
            visits.push({ url: url!, error: err } as VisitError);
        }
    }
    return visits;
}

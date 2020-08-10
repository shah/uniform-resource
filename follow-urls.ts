import * as nf from "node-fetch";
import UserAgent from 'user-agents';
import mime from "whatwg-mimetype";

// Built from https://github.com/jksolbakken/linkfollower/blob/master/linkfollower.js
const metaRefreshPattern = '(CONTENT|content)=["\']0;[ ]*(URL|url)=(.*?)(["\']\s*>)';

export interface VisitResult {
    readonly url: string;
}

export interface VisitError extends VisitResult {
    readonly error: Error;
}

export interface VisitSuccess extends VisitResult {
    readonly httpStatus: number;
    readonly httpHeaders: nf.Headers;
}

export interface RedirectResult extends VisitSuccess {
    readonly redirectUrl: string;
}

export function isRedirectResult(o: any): o is RedirectResult {
    return o && "redirectUrl" in o;
}

export interface HttpRedirectResult extends RedirectResult {
    readonly httpRedirect: boolean;
}

export function isHttpRedirectResult(o: any): o is HttpRedirectResult {
    return o && "httpRedirect" in o;
}

export interface ContentRedirectResult extends VisitSuccess {
    readonly metaRefreshRedirect: boolean;
    readonly content: string;
    readonly contentType: string;
    readonly mimeType: mime;
}

export function isContentRedirectResult(o: any): o is ContentRedirectResult {
    return o && "metaRefreshRedirect" in o;
}

export interface TerminalResult extends VisitSuccess {
    readonly terminalResult: boolean;
    readonly contentType: string;
    readonly mimeType: mime;
}

export function isTerminalResult(o: any): o is TerminalResult {
    return o && "terminalResult" in o;
}

export interface TerminalContentResult extends TerminalResult {
    readonly terminalContentResult: boolean;
    readonly content: string;
}

export function isTerminalContentResult(o: any): o is TerminalContentResult {
    return o && "terminalContentResult" in o;
}

export type ConstrainedVisitResult = VisitError | HttpRedirectResult | ContentRedirectResult | TerminalResult | TerminalContentResult;

async function visit(originalURL: string, userAgent: UserAgent): Promise<ConstrainedVisitResult> {
    const url = prefixWithHttp(originalURL)
    const response = await nf.default(url, {
        redirect: 'manual',
        follow: 0,
        headers: {
            'User-Agent': userAgent.toString(),
        }
    })

    if (isRedirect(response.status)) {
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
            const redirectUrl = extractMetaRefreshUrl(text);
            return redirectUrl ?
                { url: url, metaRefreshRedirect: true, httpStatus: response.status, redirectUrl: redirectUrl, content: text, httpHeaders: response.headers, contentType: contentType, mimeType: mimeType } :
                { url: url, httpStatus: response.status, terminalResult: true, terminalContentResult: true, content: text, httpHeaders: response.headers, contentType: contentType, mimeType: mimeType }
        }
    }
    return { url: url, httpStatus: response.status, httpHeaders: response.headers, terminalResult: true, contentType: contentType, mimeType: mimeType }
}

export async function follow(originalURL: string, userAgent = new UserAgent(), maxDepth: number = 10): Promise<VisitResult[]> {
    const visits: VisitResult[] = [];
    let url: string | undefined | null = originalURL;
    let count = 1;
    let keepGoing = true;
    while (keepGoing) {
        if (count > maxDepth) {
            throw `Exceeded max redirect depth of ${maxDepth}`
        }
        try {
            const visitResult: ConstrainedVisitResult = await visit(url!, userAgent);
            count++;
            visits.push(visitResult);
            if (isRedirectResult(visitResult)) {
                keepGoing = true;
                url = visitResult.redirectUrl;
            } else {
                keepGoing = false;
            }
        } catch (err) {
            keepGoing = false;
            visits.push({ url: url!, error: err } as VisitError);
        }
    }
    return visits;
}

function isRedirect(status: number): boolean {
    return status === 301
        || status === 302
        || status === 303
        || status === 307
        || status === 308;
}

function extractMetaRefreshUrl(html: string) {
    let match = html.match(metaRefreshPattern);
    return match && match.length == 5 ? match[3] : null;
}

function prefixWithHttp(url: string): string {
    let pattern = new RegExp('^http');
    if (!pattern.test(url)) {
        return 'http://' + url;
    }
    return url;
}


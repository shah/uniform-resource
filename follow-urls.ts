import * as nf from "node-fetch";

// Built from https://github.com/jksolbakken/linkfollower/blob/master/linkfollower.js

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.246'
const metaRefreshPattern = '(CONTENT|content)=["\']0;[ ]*(URL|url)=(.*?)(["\']\s*>)';

export interface VisitResult {
    readonly urlVisited: string;
}

export interface VisitError extends VisitResult {
    readonly error: Error;
}

export interface VisitSuccess extends VisitResult {
    readonly httpStatus: number;
    readonly responseHeaders: nf.Headers;
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
}

export function isContentRedirectResult(o: any): o is ContentRedirectResult {
    return o && "metaRefreshRedirect" in o;
}

export interface TerminalResult extends VisitSuccess {
    readonly terminalResult: boolean;
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

async function visit(originalURL: string): Promise<ConstrainedVisitResult> {
    const url = prefixWithHttp(originalURL)
    const response = await nf.default(url, {
        redirect: 'manual',
        follow: 0,
        headers: {
            'User-Agent': userAgent,
            'Accept': 'text/html'
        }
    })

    if (isRedirect(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
            return {
                urlVisited: url,
                error: new Error(`${url} responded with status ${response.status} but no location header`)
            }
        }
        return { urlVisited: url, httpRedirect: true, httpStatus: response.status, redirectUrl: location, responseHeaders: response.headers };
    } else if (response.status == 200) {
        const text = await response.text();
        const redirectUrl = extractMetaRefreshUrl(text);
        return redirectUrl ?
            { urlVisited: url, metaRefreshRedirect: true, httpStatus: response.status, redirectUrl: redirectUrl, content: text, responseHeaders: response.headers } :
            { urlVisited: url, httpStatus: response.status, terminalResult: true, terminalContentResult: true, content: text, responseHeaders: response.headers }
    } else {
        return { urlVisited: url, httpStatus: response.status, responseHeaders: response.headers, terminalResult: true }
    }
}

export async function follow(originalURL: string, maxDepth: number = 10): Promise<VisitResult[]> {
    const visits: VisitResult[] = [];
    let url: string | undefined | null = originalURL;
    let count = 1;
    let keepGoing = true;
    while (keepGoing) {
        if (count > maxDepth) {
            throw `Exceeded max redirect depth of ${maxDepth}`
        }
        try {
            const visitResult: ConstrainedVisitResult = await visit(url!);
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
            visits.push({ urlVisited: url!, error: err } as VisitError);
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


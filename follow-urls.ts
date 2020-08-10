import fetch from "node-fetch";

// Built from https://github.com/jksolbakken/linkfollower/blob/master/linkfollower.js

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.246'
const metaRefreshPattern = '(CONTENT|content)=["\']0;[ ]*(URL|url)=(.*?)(["\']\s*>)';

const MAX_REDIRECT_DEPTH = 10;

export interface VisitResult {
    readonly url: string;
    readonly redirect: boolean;
    readonly redirectUrl?: string | null;
    readonly status: string | number;
}

async function visit(originalURL: string): Promise<VisitResult> {
    const url = prefixWithHttp(originalURL)
    const response = await fetch(url, {
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
            throw `${url} responded with status ${response.status} but no location header`;
        }
        return { url: url, redirect: true, status: response.status, redirectUrl: response.headers.get('location') }
    } else if (response.status == 200) {
        const text = await response.text()
        const redirectUrl = extractMetaRefreshUrl(text)
        return redirectUrl ?
            { url: url, redirect: true, status: '200 + META REFRESH', redirectUrl: redirectUrl } :
            { url: url, redirect: false, status: response.status }
    } else {
        return { url: url, redirect: false, status: response.status }
    }
}

export async function follow(originalURL: string): Promise<VisitResult[]> {
    const visits: VisitResult[] = [];
    let url: string | undefined | null = originalURL;
    let count = 1;
    let keepGoing = true;
    while (keepGoing) {
        if (count > MAX_REDIRECT_DEPTH) {
            throw `Exceeded max redirect depth of ${MAX_REDIRECT_DEPTH}`
        }
        try {
            const response: VisitResult = await visit(url!)
            count++;
            visits.push(response);
            keepGoing = response.redirect;
            url = response.redirectUrl;
        } catch (err) {
            keepGoing = false;
            visits.push({ url: url!, redirect: false, status: `Error: ${err}` });
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


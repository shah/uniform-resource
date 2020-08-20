import * as tru from "@shah/traverse-urls";
import { Cache, lruCache } from "@shah/ts-cache";
import * as p from "@shah/ts-pipe";
import { Expect, Test, TestFixture, Timeout } from "alsatian";
import * as ur from "./uniform-resource";

@TestFixture("Uniform Resource Test Suite")
export class TestSuite {
    readonly resourceTrPipe: ur.UniformResourceTransformer;

    constructor() {
        this.resourceTrPipe = p.pipe(
            new ur.FollowRedirectsGranular(),
            ur.EnrichGovernedContent.singleton,
            ur.EnrichCuratableContent.readable);
    }

    @Timeout(10000)
    @Test("Test a single, valid, redirected (traversed/followed) resource")
    async testSingleValidFollowedResource(): Promise<void> {
        const resource = await ur.acquireResource({ uri: "https://t.co/ELrZmo81wI", transformer: this.resourceTrPipe });
        Expect(resource).toBeDefined();
        Expect(ur.isRedirectedResource(resource)).toBe(true);
        if (ur.isRedirectedResource(resource)) {
            Expect(resource.followResults.length).toBe(5);
            Expect(tru.isTerminalTextContentResult(resource.terminalResult)).toBe(true);
            Expect(resource.uri).toBe("https://www.foxnews.com/lifestyle/photo-of-donald-trump-look-alike-in-spain-goes-viral");
        }
    }

    @Timeout(10000)
    @Test("Test a single, valid, governed content")
    async testSingleValidGovernedContent(): Promise<void> {
        const resource = await ur.acquireResource({ uri: "https://t.co/ELrZmo81wI", transformer: this.resourceTrPipe });
        Expect(resource).toBeDefined();
        Expect(ur.isGovernedContent(resource)).toBe(true);
        if (ur.isGovernedContent(resource)) {
            Expect(resource.contentType).toBe("text/html; charset=utf-8");
            Expect(resource.mimeType.essence).toBe("text/html");
        }
    }

    @Timeout(10000)
    @Test("Test a single, valid, UniformResourceContent")
    async testSingleValidResourceContent(): Promise<void> {
        const resource = await ur.acquireResource({ uri: "https://t.co/ELrZmo81wI", transformer: this.resourceTrPipe });
        Expect(resource).toBeDefined();
        Expect(ur.isCuratableContentResource(resource)).toBe(true);
        if (ur.isCuratableContentResource(resource)) {
            Expect(resource.curatableContent.title).toBe("Photo of Donald Trump 'look-alike' in Spain goes viral");
            Expect(resource.curatableContent.socialGraph).toBeDefined();
            if (resource.curatableContent.socialGraph) {
                const sg = resource.curatableContent.socialGraph;
                Expect(sg.openGraph).toBeDefined();
                Expect(sg.openGraph?.type).toBe("article");
                Expect(sg.openGraph?.title).toBe(resource.curatableContent.title);
            }
        }
    }

    @Timeout(10000)
    @Test("Test a single, valid, readable content resource")
    async testSingleValidReadableContent(): Promise<void> {
        const resource = await ur.acquireResource({ uri: "https://t.co/ELrZmo81wI", transformer: this.resourceTrPipe });
        Expect(resource).toBeDefined();
        Expect(ur.isCuratableContentResource(resource)).toBe(true);
        if (ur.isCuratableContentResource(resource)) {
            const content = resource.curatableContent;
            if (ur.isMercuryReadableContent(content)) {
                Expect(await content.mercuryReadable()).toBeDefined();
            }
            if (ur.isMozillaReadabilityContent(content)) {
                Expect(content.mozillaReadability()).toBeDefined();
            }
        }
    }

    @Timeout(10000)
    @Test("Test a single, invalid (HTTP status 404) resource")
    async testSingleInvalidUniformResource(): Promise<void> {
        const resource = await ur.acquireResource({ uri: "https://t.co/fDxPF", transformer: this.resourceTrPipe });
        Expect(resource).toBeDefined();
        Expect(ur.isFollowedResource(resource)).toBe(true);
        if (ur.isFollowedResource(resource)) {
            Expect(tru.isTerminalTextContentResult(resource.terminalResult)).toBe(false);
            Expect(tru.isTerminalResult(resource.terminalResult)).toBe(true);
            if (tru.isTerminalResult(resource.terminalResult)) {
                Expect(resource.terminalResult.httpStatus).toBe(404);
            }
        }
    }

    @Timeout(10000)
    @Test("Test a single, badly formed URL")
    async testSingleInvalidURL(): Promise<void> {
        const resource = await ur.acquireResource({ uri: "https://t", transformer: this.resourceTrPipe });
        Expect(resource).toBeDefined();
        Expect(ur.isInvalidResource(resource)).toBe(true);
        if (ur.isInvalidResource(resource)) {
            Expect(resource.error).toBeDefined();
        }
    }

    @Timeout(10000)
    @Test("Download a single PDF")
    async testDownloadPDF(): Promise<void> {
        const followAndDownload = p.pipe(
            ur.FollowRedirectsGranular.singleton,
            ur.DownloadContent.singleton);
        const resource = await ur.acquireResource({ uri: "http://ceur-ws.org/Vol-1401/paper-05.pdf", transformer: followAndDownload });
        Expect(resource).toBeDefined();
        Expect(ur.isDownloadFileResult(resource)).toBe(true);
        if (ur.isDownloadFileResult(resource)) {
            Expect(resource.downloadedFileType.mime).toBe('application/pdf');
        }
    }

    @Timeout(10000)
    @Test("Download a single image")
    async testDownloadImage(): Promise<void> {
        const followAndDownload = p.pipe(
            ur.FollowRedirectsGranular.singleton,
            ur.DownloadContent.singleton);
        const resource = await ur.acquireResource({ uri: "https://upload.wikimedia.org/wikipedia/en/5/54/USS_Enterprise_%28NCC-1701-A%29.jpg", transformer: followAndDownload });
        Expect(resource).toBeDefined();
        Expect(ur.isDownloadFileResult(resource)).toBe(true);
        if (ur.isDownloadFileResult(resource)) {
            Expect(resource.downloadedFileType.mime).toBe('image/jpeg');
        }
    }

    @Timeout(10000)
    @Test("Follow multiple, download PDFs only")
    async testDownloadOnlyPDFs(): Promise<void> {
        const followAndDownloadOnlyPDFs = p.pipe(
            ur.FollowRedirectsGranular.singleton,
            ur.DownloadHttpContentTypes.pdfsOnly);
        let resource = await ur.acquireResource({ uri: "https://upload.wikimedia.org/wikipedia/en/5/54/USS_Enterprise_%28NCC-1701-A%29.jpg", transformer: followAndDownloadOnlyPDFs });
        Expect(resource).toBeDefined();
        Expect(ur.isDownloadFileResult(resource)).toBe(false);
        resource = await ur.acquireResource({ uri: "http://ceur-ws.org/Vol-1401/paper-05.pdf", transformer: followAndDownloadOnlyPDFs });
        Expect(resource).toBeDefined();
        Expect(ur.isDownloadFileResult(resource)).toBe(true);
        if (ur.isDownloadFileResult(resource)) {
            Expect(resource.downloadedFileType.mime).toBe('application/pdf');
        }
    }
}

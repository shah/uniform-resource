import * as qc from "@shah/queryable-content";
import * as tru from "@shah/traverse-urls";
import * as p from "@shah/ts-pipe";
import { Expect, Test, TestFixture, Timeout, TestCase } from "alsatian";
import { Article, Organization } from "schema-dts";
import * as ur from "./uniform-resource";

@TestFixture("Uniform Resource Test Suite")
export class TestSuite {
    readonly resourceTrPipeStd: ur.UniformResourceTransformer;
    readonly resourceTrPipeReadable: ur.UniformResourceTransformer;

    constructor() {
        this.resourceTrPipeStd = p.pipe(
            new ur.FollowRedirectsGranular(),
            ur.EnrichGovernedContent.singleton,
            ur.EnrichCuratableContent.singleton);

        this.resourceTrPipeReadable = p.pipe(
            new ur.FollowRedirectsGranular(),
            ur.EnrichGovernedContent.singleton,
            ur.EnrichCuratableContent.singleton,
            ur.EnrichMercuryReadableContent.singleton,
            ur.EnrichMozillaReadabilityContent.singleton);
    }

    @Timeout(10000)
    @Test("Test a single, valid, redirected (traversed/followed) resource")
    async testSingleValidFollowedResource(): Promise<void> {
        const resource = await ur.acquireResource({ uri: "https://t.co/ELrZmo81wI", transformer: this.resourceTrPipeStd });
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
        const resource = await ur.acquireResource({ uri: "https://t.co/ELrZmo81wI", transformer: this.resourceTrPipeStd });
        Expect(resource).toBeDefined();
        Expect(ur.isCuratableContentResource(resource)).toBe(true);
        if (ur.isCuratableContentResource(resource)) {
            const cc = resource.curatableContent;
            if (qc.isGovernedContent(cc)) {
                Expect(cc.contentType).toBe("text/html; charset=utf-8");
                Expect(cc.mimeType.essence).toBe("text/html");
            }
        }
    }

    @Timeout(10000)
    @TestCase("https://nystudio107.com/blog/annotated-json-ld-structured-data-examples", 4, { 0: "Article", 1: "Organization" })
    @TestCase("https://medicaleventsguide.com/manhattan-primary-care-midtown-manhattan", 6, { 0: "Organization" })
    @Test("Test a ld+json schemas")
    async testLdJsonSchemas(testURI: string, schemasCount: number, schemaTypes?: { index: number; sType: string }): Promise<void> {
        const tr = p.pipe(new ur.FollowRedirectsGranular(), ur.EnrichCuratableContent.singleton);
        const resource = await ur.acquireResource({ uri: testURI, transformer: this.resourceTrPipeStd });
        Expect(resource).toBeDefined();
        Expect(ur.isCuratableContentResource(resource)).toBe(true);
        if (ur.isCuratableContentResource(resource)) {
            const cc = resource.curatableContent;
            Expect(qc.isQueryableHtmlContent(cc)).toBe(true);
            if (qc.isQueryableHtmlContent(cc)) {
                const schemas = cc.untypedSchemas(true);
                Expect(schemas).toBeDefined();
                Expect(schemas?.length).toBe(schemasCount);
                if (schemas && schemaTypes) {
                    Object.entries(schemaTypes).forEach((entry) => {
                        const index = parseInt(entry[0]);
                        if (schemas[index]["@type"] != entry[1]) {
                            console.error(`${testURI} schema ${index} @type is not "${entry[1]}"`);
                        }
                    })
                }
            }
        }
    }

    @Timeout(10000)
    @Test("Test a single, valid, UniformResourceContent with OpenGraph")
    async testSingleValidResourceOpenGraph(): Promise<void> {
        const resource = await ur.acquireResource({ uri: "https://t.co/ELrZmo81wI", transformer: this.resourceTrPipeStd });
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
    @Test("Test a single, valid, UniformResourceContent for Twitter title")
    async testSingleValidResourceTwitter(): Promise<void> {
        const resource = await ur.acquireResource({ uri: "https://www.impactbnd.com/blog/best-seo-news-sites", transformer: this.resourceTrPipeStd });
        Expect(resource).toBeDefined();
        Expect(ur.isCuratableContentResource(resource)).toBe(true);
        if (ur.isCuratableContentResource(resource)) {
            Expect(resource.curatableContent.socialGraph).toBeDefined();
            if (resource.curatableContent.socialGraph) {
                const sg = resource.curatableContent.socialGraph;
                Expect(sg.twitter).toBeDefined();
                Expect(sg.twitter?.title).toBe(resource.curatableContent.title);
            }
        }
    }

    @Timeout(10000)
    @Test("Test a single, valid, UniformResourceContent for simple HTML page meta data")
    async testSimplePageMetaData(): Promise<void> {
        const resource = await ur.acquireResource({ uri: "https://www.foxnews.com/lifestyle/photo-of-donald-trump-look-alike-in-spain-goes-viral", transformer: this.resourceTrPipeStd });
        Expect(resource).toBeDefined();
        Expect(ur.isCuratableContentResource(resource)).toBe(true);
        if (ur.isCuratableContentResource(resource)) {
            Expect(qc.isQueryableHtmlContent(resource.curatableContent)).toBe(true);
            if (qc.isQueryableHtmlContent(resource.curatableContent)) {
                Expect(resource.curatableContent.meta()).toBeDefined();
            }
        }
    }

    @Timeout(10000)
    @Test("Test a single, valid, readable content resource")
    async testSingleValidReadableContent(): Promise<void> {
        const resource = await ur.acquireResource({ uri: "https://t.co/ELrZmo81wI", transformer: this.resourceTrPipeStd });
        Expect(resource).toBeDefined();
        Expect(ur.isMercuryReadableContent(resource));
        if (ur.isMercuryReadableContent(resource)) {
            Expect(await resource.mercuryReadable()).toBeDefined();
        }
        Expect(ur.isMozillaReadabilityContent(resource));
        if (ur.isMozillaReadabilityContent(resource)) {
            Expect(resource.mozillaReadability()).toBeDefined();
        }
    }

    @Timeout(10000)
    @Test("Test a single, invalid (HTTP status 404) resource")
    async testSingleInvalidUniformResource(): Promise<void> {
        const resource = await ur.acquireResource({ uri: "https://t.co/fDxPF", transformer: this.resourceTrPipeStd });
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
        const resource = await ur.acquireResource({ uri: "https://t", transformer: this.resourceTrPipeStd });
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
    @Test("Download curatable content Fav Icon")
    async testFavIcon(): Promise<void> {
        const trPipe = p.pipe(
            new ur.FollowRedirectsGranular(),
            ur.EnrichGovernedContent.singleton,
            ur.EnrichCuratableContent.singleton,
            ur.FavIconResource.followAndDownload);

        const resource = await ur.acquireResource({ uri: "https://t.co/ELrZmo81wI", transformer: trPipe });
        Expect(resource).toBeDefined();
        Expect(ur.isCuratableContentResource(resource)).toBe(true);
        Expect(ur.isFavIconSupplier(resource)).toBe(true);
        if (ur.isFavIconSupplier(resource)) {
            const favIconResource = resource.favIconResource;
            Expect(favIconResource).toBeDefined();
            Expect(ur.isDownloadFileResult(favIconResource)).toBe(true);
            if (ur.isDownloadFileResult(favIconResource)) {
                Expect(favIconResource.downloadedFileType.mime).toBe('image/x-icon');
            }
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

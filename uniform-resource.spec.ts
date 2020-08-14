import * as tru from "@shah/traverse-urls";
import { Cache, lruCache } from "@shah/ts-cache";
import { Expect, Test, TestCase, TestFixture, Timeout } from "alsatian";
import * as fs from "fs";
import mime from "whatwg-mimetype";
import * as ur from "./uniform-resource";

@TestFixture("Uniform Resource Test Suite")
export class TestSuite {
    readonly redirectVisitsCache: Cache<tru.VisitResult[]>;
    readonly typicalSupplier: ur.TypicalResourcesSupplier;
    readonly ctx: ur.UniformResourceContext;

    constructor() {
        this.redirectVisitsCache = lruCache();
        this.typicalSupplier = new ur.TypicalResourcesSupplier({
            originURN: `test`,
            unifResourceTr: ur.transformationPipe(
                new ur.FollowRedirectsGranular(this.redirectVisitsCache),
                ur.EnrichGovernedContent.singleton,
                ur.EnrichCuratableContent.readable),
        });
        this.ctx = {
            isUniformResourceContext: true
        }
    }

    @TestCase("provenance-email-base64.spec.txt")
    @Test("Base 64 Encoded E-mail Body")
    @Timeout(30000)
    //@IgnoreTest("Temporary, this takes time to run")
    async testBase64EncodedEmail(base64EncodedHtmlFileName: string): Promise<void> {
        const base64Content = fs.readFileSync(base64EncodedHtmlFileName);
        Expect(base64Content).toBeDefined();

        const testURN = `test:${base64EncodedHtmlFileName}`;
        const frc = new ur.FilteredResourcesCounter();
        const contentTr = ur.contentTransformationPipe(ur.EnrichQueryableHtmlContent.singleton);
        const htmlContent = await contentTr.transform({
            uri: testURN,
            htmlSource: Buffer.from(base64Content.toString(), 'base64').toString()
        }, {
            contentType: "text/html",
            mimeType: new mime("text/html")
        }) as ur.QueryableHtmlContent;
        const emrs = new ur.EmailMessageResourcesSupplier(htmlContent, {
            originURN: testURN,
            filter: ur.filterPipe(
                new ur.BlankLabelFilter(frc.reporter("Blank label")),
                new ur.BrowserTraversibleFilter(frc.reporter("Not traversible"))),
            unifResourceTr: ur.transformationPipe(
                ur.RemoveLabelLineBreaksAndTrimSpaces.singleton,
                ur.FollowRedirectsGranular.singleton,
                ur.RemoveTrackingCodesFromUrl.singleton)
        });

        const retained: ur.UniformResource[] = [];
        const ctx: ur.UniformResourceContext = {
            isUniformResourceContext: true
        }
        await emrs.forEachResource(ctx, (resource: ur.UniformResource): void => {
            retained.push(resource);
            if (ur.isTransformedResource(resource)) {
                console.log(`[${resource.label}] ${ur.allTransformationRemarks(resource).join(" | ")} (${resource.pipePosition})`, resource.uri);
            } else {
                console.log(`[${resource.label}] no transformations`, resource.uri);
            }
        });
        Expect(frc.count("Blank label")).toBe(9);
        Expect(frc.count("Not traversible")).toBe(3);
        Expect(retained.length).toBe(12);
    }

    @Timeout(10000)
    @Test("Test a single, valid, redirected (traversed/followed) resource")
    async testSingleValidFollowedResource(): Promise<void> {
        const resource = await this.typicalSupplier.resourceFromAnchor(this.ctx, { href: "https://t.co/ELrZmo81wI" });
        Expect(resource).toBeDefined();
        Expect(ur.isFollowedResource(resource)).toBe(true);
        if (ur.isFollowedResource(resource)) {
            Expect(resource.followResults.length).toBe(5);
            Expect(tru.isTerminalTextContentResult(resource.terminalResult)).toBe(true);
            Expect(resource.uri).toBe("https://www.foxnews.com/lifestyle/photo-of-donald-trump-look-alike-in-spain-goes-viral");
        }
    }

    @Timeout(10000)
    @Test("Test a single, valid, governed content")
    async testSingleValidGovernedContent(): Promise<void> {
        const resource = await this.typicalSupplier.resourceFromAnchor(this.ctx, { href: "https://t.co/ELrZmo81wI" });
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
        const resource = await this.typicalSupplier.resourceFromAnchor(this.ctx, { href: "https://t.co/ELrZmo81wI" });
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
        const resource = await this.typicalSupplier.resourceFromAnchor(this.ctx, { href: "https://t.co/ELrZmo81wI" });
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
        const resource = await this.typicalSupplier.resourceFromAnchor(this.ctx, { href: "https://t.co/fDxPF" });
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
        const resource = await this.typicalSupplier.resourceFromAnchor(this.ctx, { href: "https://t" });
        Expect(resource).toBeDefined();
        Expect(ur.isInvalidResource(resource)).toBe(true);
        if (ur.isInvalidResource(resource)) {
            Expect(resource.error).toBeDefined();
        }
    }
}

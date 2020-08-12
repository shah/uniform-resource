import { Expect, Test, TestCase, TestFixture, Timeout } from "alsatian";
import * as fs from "fs";
import mime from "whatwg-mimetype";
import { Cache, lruCache } from "./cache";
import * as c from "./content";
import * as filters from "./filters";
import * as follow from "./follow-urls";
import * as s from "./suppliers";
import * as tr from "./transformers";
import * as ur from "./uniform-resource";

@TestFixture("Uniform Resource Test Suite")
export class TestSuite {
    readonly redirectVisitsCache: Cache<follow.VisitResult[]>;
    readonly typicalSupplier: s.TypicalResourcesSupplier;
    readonly ctx: ur.UniformResourceContext;

    constructor() {
        this.redirectVisitsCache = lruCache();
        this.typicalSupplier = new s.TypicalResourcesSupplier({
            originURN: `test`,
            unifResourceTr: tr.transformationPipe(
                new tr.FollowRedirectsGranular(this.redirectVisitsCache),
                tr.EnrichGovernedContent.singleton,
                tr.EnrichCuratableContent.readable),
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
        const frc = new filters.FilteredResourcesCounter();
        const contentTr = c.contentTransformationPipe(c.EnrichQueryableHtmlContent.singleton);
        const htmlContent = await contentTr.transform({
            uri: testURN,
            htmlSource: Buffer.from(base64Content.toString(), 'base64').toString()
        }, {
            contentType: "text/html",
            mimeType: new mime("text/html")
        }) as c.QueryableHtmlContent;
        const emrs = new s.EmailMessageResourcesSupplier(htmlContent, {
            originURN: testURN,
            filter: filters.filterPipe(
                new filters.BlankLabelFilter(frc.reporter("Blank label")),
                new filters.BrowserTraversibleFilter(frc.reporter("Not traversible"))),
            unifResourceTr: tr.transformationPipe(
                tr.RemoveLabelLineBreaksAndTrimSpaces.singleton,
                tr.FollowRedirectsGranular.singleton,
                tr.RemoveTrackingCodesFromUrl.singleton)
        });

        const retained: ur.UniformResource[] = [];
        const ctx: ur.UniformResourceContext = {
            isUniformResourceContext: true
        }
        await emrs.forEachResource(ctx, (resource: ur.UniformResource): void => {
            retained.push(resource);
            if (tr.isTransformedResource(resource)) {
                // console.log(`[${resource.label}] ${tr.allTransformationRemarks(resource).join(" | ")} (${resource.pipePosition})`, resource.uri);
            } else {
                // console.log(`[${resource.label}] no transformations`, resource.uri);
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
        Expect(tr.isFollowedResource(resource)).toBe(true);
        if (tr.isFollowedResource(resource)) {
            Expect(resource.followResults.length).toBe(5);
            Expect(follow.isTerminalTextContentResult(resource.terminalResult)).toBe(true);
            Expect(resource.uri).toBe("https://www.foxnews.com/lifestyle/photo-of-donald-trump-look-alike-in-spain-goes-viral");
        }
    }

    @Timeout(10000)
    @Test("Test a single, valid, governed content")
    async testSingleValidGovernedContent(): Promise<void> {
        const resource = await this.typicalSupplier.resourceFromAnchor(this.ctx, { href: "https://t.co/ELrZmo81wI" });
        Expect(resource).toBeDefined();
        Expect(c.isGovernedContent(resource)).toBe(true);
        if (c.isGovernedContent(resource)) {
            Expect(resource.contentType).toBe("text/html; charset=utf-8");
            Expect(resource.mimeType.essence).toBe("text/html");
        }
    }

    @Timeout(10000)
    @Test("Test a single, valid, UniformResourceContent")
    async testSingleValidResourceContent(): Promise<void> {
        const resource = await this.typicalSupplier.resourceFromAnchor(this.ctx, { href: "https://t.co/ELrZmo81wI" });
        Expect(resource).toBeDefined();
        Expect(tr.isCuratableContentResource(resource)).toBe(true);
        if (tr.isCuratableContentResource(resource)) {
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
        Expect(tr.isCuratableContentResource(resource)).toBe(true);
        if (tr.isCuratableContentResource(resource)) {
            const content = resource.curatableContent;
            if (c.isMercuryReadableContent(content)) {
                Expect(await content.mercuryReadable()).toBeDefined();
            }
            if (c.isMozillaReadabilityContent(content)) {
                Expect(content.mozillaReadability()).toBeDefined();
            }
        }
    }

    @Timeout(10000)
    @Test("Test a single, invalid (HTTP status 404) resource")
    async testSingleInvalidUniformResource(): Promise<void> {
        const resource = await this.typicalSupplier.resourceFromAnchor(this.ctx, { href: "https://t.co/fDxPF" });
        Expect(resource).toBeDefined();
        Expect(tr.isFollowedResource(resource)).toBe(true);
        if (tr.isFollowedResource(resource)) {
            Expect(follow.isTerminalTextContentResult(resource.terminalResult)).toBe(false);
            Expect(follow.isTerminalResult(resource.terminalResult)).toBe(true);
            if (follow.isTerminalResult(resource.terminalResult)) {
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

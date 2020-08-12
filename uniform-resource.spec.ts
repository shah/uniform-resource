import { Expect, Test, TestCase, TestFixture, Timeout } from "alsatian";
import * as fs from "fs";
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
            transformer: tr.transformationPipe(
                new tr.FollowRedirectsGranular(this.redirectVisitsCache),
                tr.EnrichQueryableHtmlContent.singleton,
                tr.EnrichReadableContent.singleton),
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

        const frc = new filters.FilteredResourcesCounter();
        const emrs = new s.EmailMessageResourcesSupplier({
            originURN: `test:${base64EncodedHtmlFileName}`,
            htmlSource: Buffer.from(base64Content.toString(), 'base64').toString(),
            filter: filters.filterPipe(
                new filters.BlankLabelFilter(frc.reporter("Blank label")),
                new filters.BrowserTraversibleFilter(frc.reporter("Not traversible"))),
            transformer: tr.transformationPipe(
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
            if (ur.isTransformedResource(resource)) {
                //console.log(`[${resource.label}] ${ur.allTransformationRemarks(resource).join(" | ")} (${resource.pipePosition})`, resource.uri);
            } else {
                //console.log(`[${resource.label}] no transformations`, resource.uri);
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
        Expect(tr.isQueryableHtmlContentResource(resource)).toBe(true);
        if (tr.isQueryableHtmlContentResource(resource)) {
            Expect(resource.content.title).toBe("Photo of Donald Trump 'look-alike' in Spain goes viral");
            Expect(resource.content.socialGraph).toBeDefined();
            if (resource.content.socialGraph) {
                const sg = resource.content.socialGraph;
                Expect(sg.openGraph).toBeDefined();
                Expect(sg.openGraph?.type).toBe("article");
                Expect(sg.openGraph?.title).toBe(resource.content.title);
            }
        }
    }

    @Timeout(10000)
    @Test("Test a single, valid, ReadableContent")
    async testSingleValidReadableContent(): Promise<void> {
        const resource = await this.typicalSupplier.resourceFromAnchor(this.ctx, { href: "https://t.co/ELrZmo81wI" });
        Expect(resource).toBeDefined();
        Expect(tr.isReadableContentResource(resource)).toBe(true);
        if (tr.isReadableContentResource(resource)) {
            Expect(await resource.mercuryReadable()).toBeDefined();
            Expect(resource.mozillaReadable()).toBeDefined();
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

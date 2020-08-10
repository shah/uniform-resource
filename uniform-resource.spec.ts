import { Expect, Test, TestCase, TestFixture, Timeout } from "alsatian";
import * as fs from "fs";
import * as filters from "./filters";
import * as s from "./suppliers";
import * as tr from "./transformers";
import * as ur from "./uniform-resource";

@TestFixture("Uniform Resource Test Suite")
export class TestSuite {
    @TestCase("provenance-email-base64.spec.txt")
    @Test("Base 64 Encoded E-mail Body")
    @Timeout(30000)
    public async testBase64EncodedEmail(base64EncodedHtmlFileName: string): Promise<void> {
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
                // console.log(`[${resource.label}] ${ur.allTransformationRemarks(resource).join(" | ")} (${resource.pipePosition})`, resource.uri);
            } else {
                // console.log(`[${resource.label}] no transformations`, resource.uri);
            }
        });
        Expect(frc.count("Blank label")).toBe(9);
        Expect(frc.count("Not traversible")).toBe(3);
        Expect(retained.length).toBe(12);
    }
}

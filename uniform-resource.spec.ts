import { Expect, Test, TestCase, TestFixture, Timeout } from "alsatian";
import * as fs from "fs";
import * as ur from "./uniform-resource";

@TestFixture("Uniform Resource Test Suite")
export class TestSuite {
    @TestCase("provenance-email-base64.spec.txt")
    @Test("Base 64 Encoded E-mail Body")
    @Timeout(30000)
    public async testBase64EncodedEmail(base64EncodedHtmlFileName: string): Promise<void> {
        const base64Content = fs.readFileSync(base64EncodedHtmlFileName);
        Expect(base64Content).toBeDefined();

        const filtered: ur.UniformResource[] = [];
        const captureFilter = (resource: ur.UniformResource): void => {
            filtered.push(resource);
        }
        const emrs = new ur.EmailMessageResourcesSupplier({
            originURN: `test:${base64EncodedHtmlFileName}`,
            htmlSource: Buffer.from(base64Content.toString(), 'base64').toString(),
            filter: ur.chainedFilter(new ur.BrowserTraversibleFilter(captureFilter)),
            transformer: ur.chainedTransformer(
                ur.RemoveLabelLineBreaksAndTrimSpaces.singleton,
                ur.FollowLinksAndRemoveTracking.singleton)
        });

        const retained: ur.UniformResource[] = [];
        await emrs.forEachResource((resource: ur.UniformResource): void => {
            retained.push(resource);
            if (ur.isTransformedResource(resource)) {
                console.log(`[${resource.label}] ${ur.allTransformationRemarks(resource).join(" | ")} (${resource.chainIndex})`);
            } else {
                console.log(`[${resource.label}] no transformations`);
            }
        });
        Expect(filtered.length).toBe(3);
        Expect(retained.length).toBe(21);
    }
}

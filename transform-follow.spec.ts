import { Expect, Test, TestCase, TestFixture, Timeout } from "alsatian";
import * as f from "./transform-follow";

@TestFixture("URL follow/transform")
export class TestSuite {
    @TestCase("https://t.co/ELrZmo81wI", "https://www.foxnews.com/lifestyle/photo-of-donald-trump-look-alike-in-spain-goes-viral", 5)
    @Timeout(5000)
    @Test("Follow URL")
    public async testFollow(originalURL: string, finalURL: string, redirects: number): Promise<void> {
        const visitResults = await f.follow(originalURL);
        Expect(visitResults).toBeDefined();
        Expect(visitResults.length).toBe(redirects);
        Expect(visitResults[visitResults.length - 1].url).toBe(finalURL);
    }
}

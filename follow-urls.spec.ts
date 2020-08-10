import { Expect, Test, TestCase, TestFixture, Timeout } from "alsatian";
import * as f from "./follow-urls";

@TestFixture("URL follow/transform")
export class TestSuite {
    @TestCase("https://t.co/ELrZmo81wI", "https://www.foxnews.com/lifestyle/photo-of-donald-trump-look-alike-in-spain-goes-viral", 5)
    @TestCase("http://ui.constantcontact.com/sa/fwtf.jsp?llr=jwcorpsab&m=1119360584393&ea=periodicals%2Bhealthit-answersmedianetwork%40medigy.cc&a=1134632546554", "http://ui.constantcontact.com/sa/fwtf.jsp?llr=jwcorpsab&m=1119360584393&ea=periodicals%2Bhealthit-answersmedianetwork%40medigy.cc&a=1134632546554", 1)
    @Timeout(10000)
    @Test("Follow URL")
    public async testFollow(originalURL: string, finalURL: string, redirects: number): Promise<void> {
        const visitResults = await f.follow(originalURL);
        Expect(visitResults).toBeDefined();
        Expect(visitResults.length).toBe(redirects);
        Expect(visitResults[visitResults.length - 1].url).toBe(finalURL);
    }

    @Timeout(10000)
    @Test("Follow URL and test granular visit results")
    public async testVistResults(): Promise<void> {
        const visitResults = await f.follow("https://t.co/ELrZmo81wI");
        Expect(visitResults).toBeDefined();
        Expect(visitResults.length).toBe(5);

        Expect(f.isContentRedirectResult(visitResults[0])).toBe(true);
        Expect(f.isHttpRedirectResult(visitResults[1])).toBe(true);
        Expect(f.isHttpRedirectResult(visitResults[2])).toBe(true);
        Expect(f.isHttpRedirectResult(visitResults[3])).toBe(true);

        const finalResult = visitResults[4];
        Expect(f.isTerminalContentResult(finalResult)).toBe(true);
        if (f.isTerminalContentResult(finalResult)) {
            Expect(finalResult.url).toBe("https://www.foxnews.com/lifestyle/photo-of-donald-trump-look-alike-in-spain-goes-viral");
            Expect(finalResult.httpHeaders.get("Content-Type")).toBe("text/html; charset=utf-8");
            Expect(finalResult.content).toBeDefined();
        }
    }
}

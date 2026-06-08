import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pageUrl, totalPageCount } from "../src/loader";

const sample = readFileSync(join(__dirname, "data", "votes_sample.big.htm"), "utf8");
const cfg = { votesUrl: "https://www.kinopoisk.ru/user/1719755/votes" } as Parameters<typeof pageUrl>[0];

describe("pagination", () => {
	it("derives the page count from real votes HTML", () => {
		// Sample shows pager links up to page/28 and "1—50 из 1367".
		expect(totalPageCount(sample)).toBe(28);
	});

	it("defaults to 1 page when there is no pager", () => {
		expect(totalPageCount("<html><body>no pager here</body></html>")).toBe(1);
	});

	it("builds page URLs", () => {
		expect(pageUrl(cfg, 1)).toBe("https://www.kinopoisk.ru/user/1719755/votes");
		expect(pageUrl(cfg, 2)).toBe("https://www.kinopoisk.ru/user/1719755/votes/list/vs/vote/page/2/");
		expect(pageUrl(cfg, 28)).toBe("https://www.kinopoisk.ru/user/1719755/votes/list/vs/vote/page/28/");
	});
});

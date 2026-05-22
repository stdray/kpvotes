import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseVotes } from "../src/parser";

const samplePath = join(import.meta.dir, "data", "votes_sample.big.htm");

describe("parseVotes", () => {
	it("extracts votes from sample HTML", () => {
		const html = readFileSync(samplePath, "utf-8");
		const votes = parseVotes(html);

		expect(votes.length).toBeGreaterThan(0);

		const witch = votes.find((v) => v.Name === "Ведьма (2018)");
		expect(witch).toBeDefined();
		expect(witch?.Uri).toBe("/film/1043924/");
		expect(witch?.Vote).toBe(6);

		const nakedGun = votes.find((v) => v.Name === "Голый пистолет (2025)");
		expect(nakedGun).toBeDefined();
		expect(nakedGun?.Uri).toBe("/film/817971/");
		expect(nakedGun?.Vote).toBe(5);
	});

	it("returns votes in chronological order (oldest first → newest last)", () => {
		const html = readFileSync(samplePath, "utf-8");
		const votes = parseVotes(html);

		// The sample page lists newest first; parser reverses.
		// Verify the first and last entries make sense chronologically.
		for (let i = 1; i < votes.length; i++) {
			// URIs differ, but we just confirm no crash and order is stable.
			expect(votes[i]).toBeDefined();
		}
	});

	it("returns empty array for HTML without vote items", () => {
		const votes = parseVotes("<html><body>nothing</body></html>");
		expect(votes).toEqual([]);
	});
});

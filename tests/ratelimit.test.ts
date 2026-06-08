import { describe, expect, it } from "vitest";
import { fetchCooldownMs } from "../src/cache";

const HOUR = 60 * 60 * 1000;
const now = 1_000_000_000_000;

describe("fetchCooldownMs", () => {
	it("allows when never fetched", () => {
		expect(fetchCooldownMs(null, now, HOUR)).toBe(0);
	});

	it("blocks within the interval, returning remaining ms", () => {
		const last = new Date(now - 10 * 60 * 1000).toISOString(); // 10 min ago
		expect(fetchCooldownMs(last, now, HOUR)).toBe(HOUR - 10 * 60 * 1000);
	});

	it("allows exactly at the interval", () => {
		const last = new Date(now - HOUR).toISOString();
		expect(fetchCooldownMs(last, now, HOUR)).toBe(0);
	});

	it("allows after the interval", () => {
		const last = new Date(now - 2 * HOUR).toISOString();
		expect(fetchCooldownMs(last, now, HOUR)).toBe(0);
	});

	it("does not block on an unparseable timestamp", () => {
		expect(fetchCooldownMs("not-a-date", now, HOUR)).toBe(0);
	});
});

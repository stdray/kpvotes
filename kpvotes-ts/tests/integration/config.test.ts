/**
 * Integration test: PetBox config loading.
 *
 * Catches:
 *  - ESM/CJS import issues with @stdray/petbox-client
 *  - PetBox /v1/conf API connectivity
 *  - Config structure integrity
 *
 * Requires PETBOX_ENDPOINT and PETBOX_API_KEY in environment.
 */
import { describe, expect, it } from "vitest";
import { getConfig } from "../../src/config";

describe("PetBox config", () => {
	it("loads config with all required keys", async () => {
		const cfg = await getConfig();

		// Required fields
		expect(cfg.votesUrl).toBeTruthy();
		expect(() => new URL(cfg.votesUrl)).not.toThrow();
		expect(cfg.petbox.endpoint).toBeTruthy();
		expect(cfg.petbox.db).toBeTruthy();
		expect(cfg.userAgent).toBeTruthy();

		// Interval is a number >= 1
		expect(cfg.intervalMinutes).toBeGreaterThanOrEqual(1);

		// Twitter keys (must be present for the app to function)
		expect(cfg.twitter.appKey).toBeTruthy();
		expect(cfg.twitter.appSecret).toBeTruthy();
		expect(cfg.twitter.accessToken).toBeTruthy();
		expect(cfg.twitter.accessSecret).toBeTruthy();

		// Seq logging
		expect(cfg.seq.serverUrl).toBeTruthy();

		// proxyEnabled always present
		expect(typeof cfg.proxyEnabled).toBe("boolean");

		// If proxy enabled, must have server
		if (cfg.proxyEnabled) {
			expect(cfg.proxy).toBeDefined();
			expect(cfg.proxy?.server).toBeTruthy();
		}

		// Cached — second call returns same object
		const cfg2 = await getConfig();
		expect(cfg2).toBe(cfg);
	});
});

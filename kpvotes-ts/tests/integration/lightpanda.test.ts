import type { ChildProcess } from "node:child_process";
import { lightpanda } from "@lightpanda/browser";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Lightpanda ↔ Playwright CDP", () => {
	const CDP_PORT = 10000 + Math.floor(Math.random() * 30000);
	let proc: ChildProcess;

	beforeAll(async () => {
		proc = await lightpanda.serve({ host: "127.0.0.1", port: CDP_PORT });
		// Wait for CDP endpoint
		for (let i = 0; i < 30; i++) {
			try {
				const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
				if (res.ok) return;
			} catch {
				/* not ready */
			}
			await new Promise((r) => setTimeout(r, 1000));
		}
		throw new Error("Lightpanda CDP did not become ready within 30s");
	}, 40_000);

	afterAll(async () => {
		proc?.stdout?.destroy();
		proc?.stderr?.destroy();
		proc?.kill();
	});

	it("connects via Playwright CDP and loads example.com", async () => {
		const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);

		const page = await browser.newPage();
		await page.goto("https://example.com/", {
			waitUntil: "domcontentloaded",
		});

		const title = await page.title();
		expect(title).toBe("Example Domain");

		const body = await page.locator("body").innerText();
		expect(body).toContain("Example Domain");
		expect(body).toContain("documentation examples");

		await browser.close();
	}, 30_000);
});

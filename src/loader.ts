import { mkdirSync, writeFileSync } from "node:fs";
import { lightpanda } from "@lightpanda/browser";
import { type Browser, chromium } from "playwright-core";
import { log } from "./logger";
import type { Config } from "./types";

/** Extra settle time (ms) after domcontentloaded — Kinopoisk runs a long SSO
 *  redirect chain and JS render before the votes list appears. 40s was often not
 *  enough (landed on the sso.kinopoisk.ru stub), so allow up to 2 minutes. */
const RENDER_WAIT_MS = 120000;

/** Settle time for subsequent pages in the same session — SSO is already done,
 *  so the list renders much faster than the first hit. */
const PAGE_WAIT_MS = 8000;

/** Build the http://user:pass@host:port proxy URL for the Lightpanda CLI. */
function proxyUrl(cfg: Config): string | undefined {
	if (!cfg.proxy) return undefined;
	const auth = cfg.proxy.username ? `${cfg.proxy.username}:${cfg.proxy.password ?? ""}@` : "";
	return `http://${auth}${cfg.proxy.server}`;
}

function dumpPage(cfg: Config, html: string, tag: string): void {
	if (!cfg.dumpPages) return;
	const ts = new Date().toISOString().replace(/:/g, "-");
	const path = `${cfg.dataPath}/pages/${ts}-${tag}.html`;
	mkdirSync(`${cfg.dataPath}/pages`, { recursive: true });
	writeFileSync(path, html);
	log("debug", "Saved page dump", { path });
}

/**
 * Start Lightpanda, connect Playwright over CDP, run `fn` against a ready page,
 * and tear everything down. One session can fetch many pages (SSO runs once).
 */
async function withBrowser<T>(cfg: Config, fn: (browser: Browser) => Promise<T>): Promise<T> {
	const port = 10000 + Math.floor(Math.random() * 30000);
	const httpProxy = proxyUrl(cfg);
	log("info", "Starting Lightpanda", { port, proxy: httpProxy ? cfg.proxy?.server : null });

	const proc = await lightpanda.serve({ host: "127.0.0.1", port, ...(httpProxy ? { httpProxy } : {}) });
	try {
		const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		log("debug", "Connected to Lightpanda over CDP", { port });
		try {
			return await fn(browser);
		} finally {
			await browser.close();
		}
	} finally {
		proc.stdout.destroy();
		proc.stderr.destroy();
		proc.kill();
		log("debug", "Lightpanda stopped", { port });
	}
}

/** Navigate to `uri`, wait `waitMs` for render/redirects, return the HTML. */
async function fetchPage(cfg: Config, browser: Browser, uri: string, waitMs: number, tag: string): Promise<string> {
	const startedAt = Date.now();
	const context = await browser.newContext({ userAgent: cfg.userAgent });
	try {
		const page = await context.newPage();
		log("info", "Navigating", { uri, timeoutMs: 120000 });
		await page.goto(uri, { waitUntil: "domcontentloaded", timeout: 120000 });

		log("debug", "DOM loaded, waiting for render/redirects", { url: page.url(), waitMs });
		await new Promise((r) => setTimeout(r, waitMs));

		const finalUrl = page.url();
		const html = await page.content();
		if (!html) throw new Error("Empty HTML from Lightpanda");

		log("info", "Page loaded", {
			finalUrl,
			htmlSize: html.length,
			elapsedMs: Date.now() - startedAt,
			redirected: finalUrl !== uri,
		});
		dumpPage(cfg, html, tag);
		return html;
	} finally {
		await context.close();
	}
}

/** Load the votes page (page 1 only) — the normal 2-hour cycle path. */
export async function loadHtml(cfg: Config): Promise<string> {
	return withBrowser(cfg, (browser) => fetchPage(cfg, browser, cfg.votesUrl, RENDER_WAIT_MS, "page1"));
}

/**
 * Build the votes-list URL for page N. Kinopoisk paginates the votes history as
 *   {origin}/user/{id}/votes/list/vs/vote/page/{N}/
 * Page 1 is just the base votes URL.
 */
export function pageUrl(cfg: Config, n: number): string {
	if (n <= 1) return cfg.votesUrl;
	const base = cfg.votesUrl.replace(/\/+$/, "");
	return `${base}/list/vs/vote/page/${n}/`;
}

/** Result of a full-history crawl: every page's HTML, in page order. */
export interface CrawledPage {
	page: number;
	html: string;
}

/**
 * Bootstrap crawl: walk every pagination page of the votes history in ONE
 * Lightpanda session and return each page's HTML. `delayMs` spaces requests to
 * avoid Kinopoisk's SmartCaptcha. `maxPages` caps the crawl (0 = until empty).
 * The caller parses each page and de-dupes — this only fetches.
 */
export async function loadAllPages(
	cfg: Config,
	opts: { delayMs?: number; maxPages?: number } = {},
): Promise<CrawledPage[]> {
	const delayMs = opts.delayMs ?? 20000;
	const maxPages = opts.maxPages ?? 0;

	return withBrowser(cfg, async (browser) => {
		const pages: CrawledPage[] = [];
		// First page also resolves SSO for the whole session.
		const first = await fetchPage(cfg, browser, pageUrl(cfg, 1), RENDER_WAIT_MS, "page1");
		pages.push({ page: 1, html: first });

		const total = totalPageCount(first);
		log("info", "History crawl: discovered page count", { totalPages: total });

		const last = maxPages > 0 ? Math.min(total, maxPages) : total;
		for (let n = 2; n <= last; n++) {
			await new Promise((r) => setTimeout(r, delayMs));
			const html = await fetchPage(cfg, browser, pageUrl(cfg, n), PAGE_WAIT_MS, `page${n}`);
			pages.push({ page: n, html });
		}
		log("info", "History crawl complete", { pagesFetched: pages.length });
		return pages;
	});
}

/**
 * Derive the number of votes-history pages from page-1 HTML. Kinopoisk shows the
 * pager links (…/page/N/) and a "1—50 из 1367" total. We take the max of the
 * page-link numbers; fall back to ceil(total/50); default 1.
 */
export function totalPageCount(html: string): number {
	let max = 1;
	for (const m of html.matchAll(/votes\/list\/[a-z/]*page\/(\d+)/g)) {
		const n = Number(m[1]);
		if (n > max) max = n;
	}
	if (max === 1) {
		const totalMatch = html.match(/pagesFromTo[^>]*>[^<]*?из\s*([\d\s]+)/i);
		if (totalMatch?.[1]) {
			const total = Number(totalMatch[1].replace(/\s/g, ""));
			if (total > 0) max = Math.ceil(total / 50);
		}
	}
	return max;
}

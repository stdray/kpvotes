import { readFileSync } from "node:fs";
import { CacheStore, newVotes, voteKey } from "./cache";
import { getConfig } from "./config";
import { loadAllPages, loadHtml, totalPageCount } from "./loader";
import { closeLogger, initLogger, log } from "./logger";
import { detectBlock, parseVotes } from "./parser";
import type { Config, Vote } from "./types";

/**
 * One-off cache bootstrap — populates the PetBox votes store WITHOUT tweeting, so
 * the normal cycle has a baseline and doesn't tweet the back catalogue.
 *
 * Modes (pick via env):
 *   page (KPVOTES_BOOTSTRAP_MODE=page) — fetch the current votes page (page 1) via
 *     Lightpanda, parse it, and MERGE every vote into the store as `processed`
 *     (only unknown ones are added; nothing is overwritten, nothing is tweeted).
 *     Use this to refresh the cache with what's on the page right now.
 *   file (KPVOTES_SEED_FILE=path) — import a votes.json ([{Uri,Name,Vote}]);
 *     replaces the store (refuses if non-empty). No Kinopoisk request.
 *   crawl (default) — walk every history page via Lightpanda; replaces the store
 *     (refuses if non-empty). Subject to SSO/SmartCaptcha flakiness.
 *
 *   PETBOX_ENDPOINT=… PETBOX_API_KEY=… KPVOTES_BOOTSTRAP_MODE=page node dist/bootstrap.js
 *
 * Env knobs:
 *   KPVOTES_BOOTSTRAP_MODE      'page' | 'file' | 'crawl' (default: file if SEED_FILE, else crawl)
 *   KPVOTES_SEED_FILE           file-mode source JSON
 *   KPVOTES_BOOTSTRAP_DELAY_MS  delay between page fetches when crawling (default 20000)
 *   KPVOTES_BOOTSTRAP_MAX_PAGES cap pages for a dry run (default 0 = all)
 */
async function main(): Promise<void> {
	const cfg = await getConfig();
	initLogger(cfg);

	const seedFile = process.env.KPVOTES_SEED_FILE;
	const mode = process.env.KPVOTES_BOOTSTRAP_MODE ?? (seedFile ? "file" : "crawl");

	const cache = new CacheStore(cfg);
	await cache.ensureSchema();

	if (mode === "page") {
		await mergeCurrentPage(cfg, cache);
		await closeLogger();
		process.exit(0);
	}

	// file / crawl modes REPLACE the store, so they refuse on a non-empty cache.
	const existing = await cache.read();
	if (existing && existing.length > 0) {
		log("warn", "Cache is not empty — file/crawl bootstrap refuses to overwrite", { existing: existing.length });
		log("warn", "Use KPVOTES_BOOTSTRAP_MODE=page to MERGE, or clear the votes table to re-seed.");
		await closeLogger();
		process.exit(2);
	}

	const votes = mode === "file" && seedFile ? importFromFile(seedFile) : await crawl(cfg);
	if (votes.length === 0) {
		log("error", "No votes to seed — refusing to write empty cache");
		await closeLogger();
		process.exit(4);
	}

	await cache.write(votes); // seeds all as processed
	log("info", "Bootstrap complete — cache seeded", { votes: votes.length, mode });
	await closeLogger();
	process.exit(0);
}

/**
 * Fetch the current votes page (page 1), parse it, and add every vote that isn't
 * already known into the store as `processed` — no overwrite, no tweets.
 */
async function mergeCurrentPage(cfg: Config, cache: CacheStore): Promise<void> {
	const attempts = Number(process.env.KPVOTES_BOOTSTRAP_ATTEMPTS ?? 5);
	log("info", "Bootstrap(page): fetching current votes page", { votesUrl: cfg.votesUrl, attempts });

	// The Kinopoisk SSO redirect chain is flaky and sometimes lands on the
	// sso.kinopoisk.ru stub (zero votes). Retry with a fresh Lightpanda session
	// (each retry re-runs SSO) until we get a real page.
	let votes: Vote[] = [];
	for (let i = 1; i <= attempts; i++) {
		const html = await loadHtml(cfg);
		const block = detectBlock(html);
		votes = parseVotes(html);
		log("info", "Bootstrap(page): attempt", {
			attempt: i,
			htmlSize: html.length,
			votesFound: votes.length,
			blockReason: block,
		});
		if (votes.length > 0) break;
		if (i < attempts) log("warn", "Bootstrap(page): no votes (SSO/block) — retrying", { attempt: i });
	}

	if (votes.length === 0) {
		log("error", "Bootstrap(page): zero votes after all attempts — nothing merged", { attempts });
		process.exitCode = 3;
		return;
	}

	const known = await cache.knownKeys();
	const missing = newVotes(known, votes);
	if (missing.length === 0) {
		log("info", "Bootstrap(page): all page votes already known — nothing to add", { known: known.size });
		return;
	}

	await cache.insertProcessed(missing);
	log("info", "Bootstrap(page): merged page votes as processed", {
		pageVotes: votes.length,
		alreadyKnown: votes.length - missing.length,
		added: missing.length,
		totalKnown: known.size + missing.length,
	});
}

/** Read and validate a votes.json ([{Uri,Name,Vote}]); de-dupe by Uri+Vote. */
function importFromFile(path: string): Vote[] {
	log("info", "Bootstrap: importing from file", { path });
	const raw = readFileSync(path, "utf8");
	const parsed = JSON.parse(raw) as unknown;
	if (!Array.isArray(parsed)) throw new Error(`Seed file is not a JSON array: ${path}`);

	const out: Vote[] = [];
	const seen = new Set<string>();
	for (const r of parsed) {
		const o = r as Record<string, unknown>;
		const uri = String(o.Uri ?? "");
		const name = String(o.Name ?? "");
		const vote = Number(o.Vote);
		if (!uri || !name || Number.isNaN(vote)) {
			log("warn", "Skipping malformed seed row", { row: JSON.stringify(r).slice(0, 120) });
			continue;
		}
		const v: Vote = { Uri: uri, Name: name, Vote: vote };
		const k = voteKey(v);
		if (!seen.has(k)) {
			seen.add(k);
			out.push(v);
		}
	}
	log("info", "Bootstrap: parsed seed file", { rows: parsed.length, votes: out.length });
	return out;
}

/** Crawl every votes-history page via Lightpanda and collect unique votes. */
async function crawl(cfg: Config): Promise<Vote[]> {
	const delayMs = Number(process.env.KPVOTES_BOOTSTRAP_DELAY_MS ?? 20000);
	const maxPages = Number(process.env.KPVOTES_BOOTSTRAP_MAX_PAGES ?? 0);
	log("info", "Bootstrap: crawling history", { votesUrl: cfg.votesUrl, delayMs, maxPages });

	const pages = await loadAllPages(cfg, { delayMs, maxPages });

	const firstHtml = pages[0]?.html ?? "";
	const block = detectBlock(firstHtml);
	if (block) throw new Error(`Bootstrap blocked by Kinopoisk: ${block}`);

	const all: Vote[] = [];
	const seen = new Set<string>();
	let parsedPages = 0;
	for (const { page, html } of pages) {
		const votes = parseVotes(html);
		if (votes.length === 0) {
			log("warn", "Page parsed to zero votes", { page, htmlSize: html.length, blockReason: detectBlock(html) });
			continue;
		}
		parsedPages++;
		for (const v of votes) {
			const k = voteKey(v);
			if (!seen.has(k)) {
				seen.add(k);
				all.push(v);
			}
		}
	}
	log("info", "Bootstrap: crawl parsed", {
		pagesFetched: pages.length,
		pagesWithVotes: parsedPages,
		expectedPages: totalPageCount(firstHtml),
		uniqueVotes: all.length,
	});
	return all;
}

main().catch(async (err) => {
	try {
		log("error", "Bootstrap failed", { error: err instanceof Error ? err : new Error(String(err)) });
		await closeLogger();
	} catch {
		console.error("Bootstrap failed", err);
	}
	process.exit(1);
});

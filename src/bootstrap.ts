import { readFileSync } from "node:fs";
import { CacheStore, voteKey } from "./cache";
import { getConfig } from "./config";
import { loadAllPages, totalPageCount } from "./loader";
import { closeLogger, initLogger, log } from "./logger";
import { detectBlock, parseVotes } from "./parser";
import type { Vote } from "./types";

/**
 * One-off cache bootstrap — seeds the PetBox votes cache WITHOUT tweeting, so the
 * normal cycle has a complete baseline and doesn't tweet the whole back catalogue.
 * Run once before first production start.
 *
 * Two modes:
 *   - Import (preferred): KPVOTES_SEED_FILE=path to a votes.json ([{Uri,Name,Vote}]).
 *     Fast, reliable, no Kinopoisk requests. Use the existing 142-vote history.
 *   - Crawl: no seed file → walk every votes-history page via Lightpanda.
 *     Subject to Kinopoisk's SSO/SmartCaptcha flakiness.
 *
 *   PETBOX_ENDPOINT=… PETBOX_API_KEY=… KPVOTES_SEED_FILE=votes.json node dist/bootstrap.js
 *
 * Env knobs:
 *   KPVOTES_SEED_FILE           import from this JSON instead of crawling
 *   KPVOTES_BOOTSTRAP_DELAY_MS  delay between page fetches when crawling (default 20000)
 *   KPVOTES_BOOTSTRAP_MAX_PAGES cap pages for a dry run (default 0 = all)
 */
async function main(): Promise<void> {
	const cfg = await getConfig();
	initLogger(cfg);

	const seedFile = process.env.KPVOTES_SEED_FILE;

	const cache = new CacheStore(cfg);
	await cache.ensureSchema();

	const existing = await cache.read();
	if (existing && existing.length > 0) {
		log("warn", "Cache is not empty — bootstrap refuses to overwrite", { existing: existing.length });
		log("warn", "Clear the votes table first if you really want to re-bootstrap.");
		await closeLogger();
		process.exit(2);
	}

	const votes = seedFile ? importFromFile(seedFile) : await crawl(cfg);

	if (votes.length === 0) {
		log("error", "No votes to seed — refusing to write empty cache");
		await closeLogger();
		process.exit(4);
	}

	await cache.write(votes);
	log("info", "Bootstrap complete — cache seeded", { votes: votes.length, source: seedFile ? "file" : "crawl" });

	await closeLogger();
	process.exit(0);
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
async function crawl(cfg: import("./types").Config): Promise<Vote[]> {
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

import { CacheStore, voteKey } from "./cache";
import { getConfig } from "./config";
import { loadAllPages, totalPageCount } from "./loader";
import { closeLogger, initLogger, log } from "./logger";
import { detectBlock, parseVotes } from "./parser";
import type { Vote } from "./types";

/**
 * One-off history bootstrap. Crawls EVERY pagination page of the votes history,
 * collects the full set (~1300+ votes) and writes it into the PetBox cache —
 * WITHOUT tweeting. Run this once before first production start so the normal
 * cycle has a complete baseline and doesn't tweet the whole back catalogue.
 *
 *   PETBOX_ENDPOINT=… PETBOX_API_KEY=… node dist/bootstrap.js
 *
 * Env knobs:
 *   KPVOTES_BOOTSTRAP_DELAY_MS  delay between page fetches (default 20000)
 *   KPVOTES_BOOTSTRAP_MAX_PAGES cap pages for a dry run (default 0 = all)
 */
async function main(): Promise<void> {
	const cfg = await getConfig();
	initLogger(cfg);

	const delayMs = Number(process.env.KPVOTES_BOOTSTRAP_DELAY_MS ?? 20000);
	const maxPages = Number(process.env.KPVOTES_BOOTSTRAP_MAX_PAGES ?? 0);

	log("info", "Bootstrap starting", { votesUrl: cfg.votesUrl, delayMs, maxPages });

	const cache = new CacheStore(cfg);
	await cache.ensureSchema();

	const existing = await cache.read();
	if (existing && existing.length > 0) {
		log("warn", "Cache is not empty — bootstrap would overwrite it", { existing: existing.length });
		log("warn", "Refusing to overwrite. Clear the votes table first if you really want to re-bootstrap.");
		await closeLogger();
		process.exit(2);
	}

	const pages = await loadAllPages(cfg, { delayMs, maxPages });

	// First page must parse to votes — otherwise we were blocked, don't wipe.
	const firstHtml = pages[0]?.html ?? "";
	const block = detectBlock(firstHtml);
	if (block) {
		log("error", "Bootstrap blocked by Kinopoisk — aborting", { blockReason: block });
		await closeLogger();
		process.exit(3);
	}

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

	const expected = totalPageCount(firstHtml);
	log("info", "Bootstrap parsed", {
		pagesFetched: pages.length,
		pagesWithVotes: parsedPages,
		expectedPages: expected,
		uniqueVotes: all.length,
	});

	if (all.length === 0) {
		log("error", "No votes parsed — refusing to write empty cache");
		await closeLogger();
		process.exit(4);
	}

	await cache.write(all);
	log("info", "Bootstrap complete — cache seeded", { votes: all.length });

	await closeLogger();
	process.exit(0);
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

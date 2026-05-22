import { readCache, writeCache, diff } from "./cache";
import { getConfig } from "./config";
import { loadHtml } from "./loader";
import { initLogger, log } from "./logger";
import { detectBlock, parseVotes } from "./parser";
import { postTweet } from "./twitter";
import type { Config, Vote } from "./types";

async function main(): Promise<void> {
	const cfg = await getConfig();
	initLogger(cfg);

	log("Information", "KpVotes starting", {
		intervalMinutes: cfg.intervalMinutes,
		app: "kpvotes-ts",
	});

	await runCycle(cfg);

	setInterval(() => runCycle(cfg), cfg.intervalMinutes * 60 * 1000);
}

async function runCycle(cfg: Config): Promise<void> {
	const startedAt = Date.now();
	log("Information", "Cycle started");

	try {
		log("Information", "Loading page from Kinopoisk", { uri: `${cfg.kpUri}/${cfg.votesUri}` });
		const html = await loadHtml(cfg);

		log("Information", "Parsing votes", { htmlSize: html.length });
		const freshVotes = parseVotes(html);
		log("Information", "Parse complete", { votesFound: freshVotes.length });

		if (!freshVotes.length) {
			const block = detectBlock(html);
			log("Warning", block ? `Blocked: ${block}` : "No votes found", {
				htmlSize: html.length,
				blockReason: block,
			});
			return;
		}

		const cached = await readCache(cfg.cachePath);

		if (!cached) {
			log("Information", "No cache, creating initial cache", { voteCount: freshVotes.length });
			writeCache(cfg.cachePath, freshVotes);
			return;
		}

		const newVotes = diff(cached, freshVotes);
		log("Information", "Diff complete", {
			cached: cached.length,
			fresh: freshVotes.length,
			new: newVotes.length,
		});

		for (const vote of newVotes) {
			await postVote(cfg, vote);
			cached.push(vote);
			writeCache(cfg.cachePath, cached);
			await sleep(30000);
		}

		log("Information", "Cycle complete", { elapsedMs: Date.now() - startedAt });
	} catch (err) {
		log("Error", "Cycle failed: {error}", { error: String(err) });
	}
}

async function postVote(cfg: Config, vote: Vote): Promise<void> {
	const filled = "★".repeat(vote.Vote);
	const empty = "☆".repeat(10 - vote.Vote);
	const stars = filled + empty;
	const uri = `${cfg.kpUri}${vote.Uri}`;
	const text = `${vote.Name}.\r\nМоя оценка ${vote.Vote} из 10 ${stars} #kinopoisk\r\n${uri}`;

	log("Information", "Posting tweet", { name: vote.Name, vote: vote.Vote, uri: vote.Uri });
	await postTweet(cfg, text);
	log("Information", "Tweet posted", { uri: vote.Uri });
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

main();

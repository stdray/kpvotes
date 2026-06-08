import { CacheStore, fetchCooldownMs, LAST_FETCH_KEY, newVotes } from "./cache";
import { getConfig } from "./config";
import { type HealthStatus, pushHealth } from "./health";
import { loadHtml } from "./loader";
import { closeLogger, initLogger, log } from "./logger";
import { detectBlock, parseVotes } from "./parser";
import { runtimeInfo, tagVector } from "./runtime";
import { CreditsDepletedError, postTweet } from "./twitter";
import type { Config, Vote } from "./types";

/** Minimum gap between Kinopoisk fetches — too-frequent requests trip SmartCaptcha. */
const MIN_FETCH_INTERVAL_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
	const cfg = await getConfig();
	initLogger(cfg);

	const rt = runtimeInfo();
	// Full startup context: which build, on which machine, under which tag-vector.
	log("info", "KpVotes starting", {
		version: rt.version,
		sha: rt.sha,
		buildDate: rt.buildDate,
		host: rt.host,
		platform: rt.platform,
		arch: rt.arch,
		nodeVersion: rt.nodeVersion,
		pid: rt.pid,
		containerized: rt.containerized,
		tagVector: tagVector(),
		intervalMinutes: cfg.intervalMinutes,
		userAgent: cfg.userAgent,
		proxyEnabled: cfg.proxyEnabled,
		proxyServer: cfg.proxy?.server ?? null,
	});

	const cache = new CacheStore(cfg);
	await cache.ensureSchema();

	await runCycle(cfg, cache);

	const timer = setInterval(() => runCycle(cfg, cache), cfg.intervalMinutes * 60 * 1000);

	installShutdownHandlers(timer);
}

/** Stop the cycle timer and flush buffered logs before the process exits, so
 *  the Seq batch tail isn't dropped on container restart (SIGTERM). */
function installShutdownHandlers(timer: NodeJS.Timeout): void {
	let shuttingDown = false;
	const shutdown = async (signal: string): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		clearInterval(timer);
		log("info", "Shutting down", { signal });
		await closeLogger();
		process.exit(0);
	};
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));
}

async function runCycle(cfg: Config, cache: CacheStore): Promise<void> {
	const startedAt = Date.now();
	log("info", "Cycle started");

	// degraded = ran but couldn't read votes (SSO stub / block / no votes);
	// unhealthy = threw; healthy = completed a real pass.
	let status: HealthStatus = "healthy";
	const extra: Record<string, string> = {};

	try {
		// 1. Drain any leftover `pending` votes from a previous crashed cycle FIRST —
		//    they were already fetched, so process them without re-hitting Kinopoisk.
		let pending = await cache.getPending();
		if (pending.length > 0) {
			log("info", "Resuming pending votes from a previous run", { pending: pending.length });
		} else {
			// 2. No leftovers → fetch the page, subject to the rate-limit guard.
			//    Never hit Kinopoisk more than once per hour (SmartCaptcha); the last
			//    fetch instant is persisted in PetBox so the guard survives restarts.
			const last = await cache.getMeta(LAST_FETCH_KEY);
			const cooldownMs = fetchCooldownMs(last, Date.now(), MIN_FETCH_INTERVAL_MS);
			if (cooldownMs > 0) {
				log("info", "Skipping fetch — within 1h of last fetch", {
					lastFetchAt: last,
					nextEligibleInMs: cooldownMs,
				});
				extra.reason = "rate-limited";
				return; // status stays "healthy": skipping is normal, not a failure
			}
			// Stamp the attempt up front so a crash mid-fetch still counts against the budget.
			await cache.setMeta(LAST_FETCH_KEY, new Date().toISOString());

			log("info", "Loading page from Kinopoisk", { uri: cfg.votesUrl });
			const html = await loadHtml(cfg);

			log("info", "Parsing votes", { htmlSize: html.length });
			const freshVotes = parseVotes(html);
			log("info", "Parse complete", { votesFound: freshVotes.length });

			if (!freshVotes.length) {
				const block = detectBlock(html);
				log("warn", block ? `Blocked: ${block}` : "No votes found", {
					htmlSize: html.length,
					blockReason: block,
				});
				status = "degraded";
				extra.reason = block ?? "no-votes";
				return;
			}

			const known = await cache.knownKeys();
			const firstRun = known.size === 0;

			const fresh = newVotes(known, freshVotes);
			log("info", "Diff complete", { known: known.size, fresh: freshVotes.length, new: fresh.length });

			if (firstRun) {
				// First ever run: seed everything as processed so the back-catalogue
				// is NOT tweeted (this is what was missed in the stale-seed incident).
				log("info", "First run — seeding cache without tweeting", { voteCount: freshVotes.length });
				await cache.insertProcessed(freshVotes);
				return;
			}

			if (fresh.length === 0) {
				log("info", "No new votes");
				return;
			}

			// 3. Persist the new votes as `pending` BEFORE tweeting — so a crash mid-loop
			//    leaves them in the store (the PageVotesPath equivalent) and the next
			//    cycle resumes them above without re-fetching.
			await cache.insertPending(fresh);
			pending = fresh;
		}

		// 4. Process the pending queue: tweet, then mark processed (one at a time so a
		//    failure leaves the rest pending for the next cycle).
		for (const vote of pending) {
			log("info", "New vote", { name: vote.Name, vote: vote.Vote, uri: vote.Uri });
			try {
				await postVote(cfg, vote);
				await cache.markProcessed(vote);
				// Space out posts to stay within Twitter write limits.
				await sleep(30000);
			} catch (err) {
				if (err instanceof CreditsDepletedError) {
					// X has no write credits left — every further post would 402.
					// Stop immediately (don't burn the rest of the queue in a tight
					// 402 loop); the remaining votes stay `pending` and will post
					// once the balance is topped up.
					log("warn", "X API credits depleted — pausing posting until topped up", {
						remainingPending: pending.length - pending.indexOf(vote),
					});
					status = "degraded";
					extra.reason = "credits-depleted";
					break;
				}
				log("error", "Failed to post vote, stays pending for next cycle", {
					name: vote.Name,
					uri: vote.Uri,
					error: err instanceof Error ? err : new Error(String(err)),
				});
				status = "degraded";
				extra.reason = "tweet-failed";
				break; // stop on first failure; remaining stay pending
			}
		}

		log("info", "Cycle complete", { elapsedMs: Date.now() - startedAt });
	} catch (err) {
		status = "unhealthy";
		extra.reason = "cycle-error";
		log("error", "Cycle failed", {
			error: err instanceof Error ? err : new Error(String(err)),
		});
	} finally {
		// Heartbeat so PetBox knows the worker is alive and how the last run went.
		try {
			await pushHealth(cfg, status, { ...extra, elapsedMs: String(Date.now() - startedAt) });
		} catch (err) {
			log("warn", "Health push failed", { error: err instanceof Error ? err.message : String(err) });
		}
	}
}

async function postVote(cfg: Config, vote: Vote): Promise<void> {
	const filled = "★".repeat(vote.Vote);
	const empty = "☆".repeat(10 - vote.Vote);
	const stars = filled + empty;
	const uri = `${new URL(cfg.votesUrl).origin}${vote.Uri}`;
	const text = `${vote.Name}.\r\nМоя оценка ${vote.Vote} из 10 ${stars} #kinopoisk\r\n${uri}`;

	log("info", "Posting tweet", { name: vote.Name, vote: vote.Vote, uri: vote.Uri });
	await postTweet(cfg, text);
	log("info", "Tweet posted", { uri: vote.Uri });
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(async (err) => {
	// Logger may or may not be initialized (e.g. config load failed) — log via
	// winston if we can, always fall back to stderr, then flush and exit non-zero.
	try {
		log("error", "Fatal: startup failed", {
			error: err instanceof Error ? err : new Error(String(err)),
		});
		await closeLogger();
	} catch {
		console.error("Fatal: startup failed", err);
	}
	process.exit(1);
});

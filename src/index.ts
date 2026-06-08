import { CacheStore, diff, fetchCooldownMs, LAST_FETCH_KEY } from "./cache";
import { getConfig } from "./config";
import { type HealthStatus, pushHealth } from "./health";
import { loadHtml } from "./loader";
import { closeLogger, initLogger, log } from "./logger";
import { detectBlock, parseVotes } from "./parser";
import { runtimeInfo, tagVector } from "./runtime";
import { postTweet } from "./twitter";
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
		// Rate-limit guard: never hit Kinopoisk more than once per hour, even across
		// restarts/manual runs — too-frequent requests trigger SmartCaptcha. The last
		// fetch instant is persisted in PetBox so the guard survives a restart.
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

		const cached = await cache.read();

		if (!cached) {
			log("info", "No cache, creating initial cache", { voteCount: freshVotes.length });
			await cache.write(freshVotes);
			return;
		}

		const newVotes = diff(cached, freshVotes);
		log("info", "Diff complete", {
			cached: cached.length,
			fresh: freshVotes.length,
			new: newVotes.length,
		});

		for (const vote of newVotes) {
			log("info", "New vote", {
				name: vote.Name,
				vote: vote.Vote,
				uri: vote.Uri,
			});

			// Tweet first; only persist to cache once it's posted, so a failed
			// tweet is retried next cycle rather than silently swallowed.
			try {
				await postVote(cfg, vote);
				cached.push(vote);
				await cache.insert(vote);
				// Space out posts to stay within Twitter write limits.
				await sleep(30000);
			} catch (err) {
				log("error", "Failed to post vote, will retry next cycle", {
					name: vote.Name,
					uri: vote.Uri,
					error: err instanceof Error ? err : new Error(String(err)),
				});
				status = "degraded";
				extra.reason = "tweet-failed";
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

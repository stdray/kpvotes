import { PetBoxDataClient } from "@stdray-npm/petbox-client";
import type { Config, Vote } from "./types";

// Votes store, backed by a PetBox DataDb (replaces the local votes.json +
// page_votes.json files of the .NET version). A single table tracks both the
// processed history AND the freshly-fetched-but-not-yet-tweeted votes via a
// Status column:
//   processed — already tweeted (or seeded); never tweet again.
//   pending   — fetched from the page this run, not tweeted yet.
// This unifies the old CachePath (processed) and PageVotesPath (pending) so a
// crash mid-processing leaves `pending` rows that the next cycle finishes
// WITHOUT re-fetching Kinopoisk.
const SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS votes (Uri TEXT NOT NULL, Name TEXT NOT NULL, Vote INTEGER NOT NULL)";
// Add the processing status. Existing rows (the prior cache) become 'processed'.
const STATUS_SQL = "ALTER TABLE votes ADD COLUMN Status TEXT NOT NULL DEFAULT 'processed'";
// Small key/value table for worker state that must survive restarts (e.g. the
// last Kinopoisk fetch time for the ≤1/hour rate-limit guard).
const META_SQL = "CREATE TABLE IF NOT EXISTS meta (Key TEXT PRIMARY KEY, Value TEXT NOT NULL)";

/** Key in the meta table for the last Kinopoisk fetch instant (ISO string). */
export const LAST_FETCH_KEY = "last-fetch-at";

export type VoteStatus = "processed" | "pending";

/** Binds a PetBoxDataClient to this project's votes db so the rest of the code
 *  doesn't repeat project/db on every call. */
export class CacheStore {
	private readonly client: PetBoxDataClient;
	private readonly project: string;
	private readonly db: string;

	constructor(cfg: Config) {
		this.client = new PetBoxDataClient({ endpoint: cfg.petbox.endpoint, apiKey: cfg.petbox.apiKey });
		this.project = cfg.petbox.project;
		this.db = cfg.petbox.db;
	}

	/** Create the DataDb (if missing) and apply migrations. Idempotent. */
	async ensureSchema(): Promise<void> {
		try {
			await this.client.createDb(this.project, this.db, { description: "KpVotes votes store" });
		} catch {
			// Already exists — createDb is not idempotent server-side; applySchema below is.
		}
		await this.client.applySchema(this.project, this.db, "001-votes", SCHEMA_SQL);
		await this.client.applySchema(this.project, this.db, "002-meta", META_SQL);
		await this.client.applySchema(this.project, this.db, "003-votes-status", STATUS_SQL);
	}

	// ── meta (worker state) ──────────────────────────────────────────────────

	/** Read a meta value (worker state), or null if unset. */
	async getMeta(key: string): Promise<string | null> {
		const rows = await this.client.query<{ Value: string }>(
			this.project,
			this.db,
			"SELECT Value FROM meta WHERE Key = @k",
			[{ name: "@k", value: key }],
		);
		return rows[0]?.Value ?? null;
	}

	/** Upsert a meta value. */
	async setMeta(key: string, value: string): Promise<void> {
		await this.client.exec(
			this.project,
			this.db,
			"INSERT INTO meta (Key, Value) VALUES (@k, @v) ON CONFLICT(Key) DO UPDATE SET Value = @v",
			[
				{ name: "@k", value: key },
				{ name: "@v", value },
			],
		);
	}

	// ── votes ────────────────────────────────────────────────────────────────

	/** Total rows (processed + pending). 0 ⇒ first run. */
	async count(): Promise<number> {
		const rows = await this.client.query<{ n: number }>(this.project, this.db, "SELECT COUNT(*) AS n FROM votes");
		return Number(rows[0]?.n ?? 0);
	}

	/** Set of every known vote key (Uri|Vote), regardless of status. */
	async knownKeys(): Promise<Set<string>> {
		const rows = await this.client.query<{ Uri: string; Vote: number }>(
			this.project,
			this.db,
			"SELECT Uri, Vote FROM votes",
		);
		return new Set(rows.map((r) => `${r.Uri}|${Number(r.Vote)}`));
	}

	/** Pending votes (fetched, not yet tweeted) — the PageVotesPath equivalent. */
	async getPending(): Promise<Vote[]> {
		const rows = await this.client.query<Vote>(
			this.project,
			this.db,
			"SELECT Uri, Name, Vote FROM votes WHERE Status = 'pending' ORDER BY rowid",
		);
		return rows.map((r) => ({ Uri: String(r.Uri), Name: String(r.Name), Vote: Number(r.Vote) }));
	}

	/** All votes (any status) — used by bootstrap to detect a non-empty store. */
	async read(): Promise<Vote[] | null> {
		const rows = await this.client.query<Vote>(this.project, this.db, "SELECT Uri, Name, Vote FROM votes");
		if (rows.length === 0) return null;
		return rows.map((r) => ({ Uri: String(r.Uri), Name: String(r.Name), Vote: Number(r.Vote) }));
	}

	/** Insert one vote with an explicit status. */
	private async insert(v: Vote, status: VoteStatus): Promise<void> {
		await this.client.exec(
			this.project,
			this.db,
			"INSERT INTO votes (Uri, Name, Vote, Status) VALUES (@uri, @name, @vote, @status)",
			[
				{ name: "@uri", value: v.Uri },
				{ name: "@name", value: v.Name },
				{ name: "@vote", value: v.Vote },
				{ name: "@status", value: status },
			],
		);
	}

	/** Insert fresh votes as `pending` (to be tweeted). */
	async insertPending(votes: Vote[]): Promise<void> {
		for (const v of votes) await this.insert(v, "pending");
	}

	/** Seed votes as `processed` (known history, never tweeted). Used on the very
	 *  first run and by bootstrap so the back-catalogue is not tweeted. */
	async insertProcessed(votes: Vote[]): Promise<void> {
		for (const v of votes) await this.insert(v, "processed");
	}

	/** Mark a vote tweeted. */
	async markProcessed(v: Vote): Promise<void> {
		await this.client.exec(
			this.project,
			this.db,
			"UPDATE votes SET Status = 'processed' WHERE Uri = @uri AND Vote = @vote",
			[
				{ name: "@uri", value: v.Uri },
				{ name: "@vote", value: v.Vote },
			],
		);
	}

	/** Replace the entire store with `votes`, all marked processed (seed/reset). */
	async write(votes: Vote[]): Promise<void> {
		await this.client.exec(this.project, this.db, "DELETE FROM votes");
		await this.insertProcessed(votes);
	}
}

/** Key for dedup: Uri + Vote */
export function voteKey(v: Vote): string {
	return `${v.Uri}|${v.Vote}`;
}

/**
 * Rate-limit decision for the Kinopoisk fetch. Returns how long is still left
 * before another fetch is allowed (0 = allowed now). `lastIso` is the persisted
 * last-fetch instant (null = never fetched). Pure, so it's unit-testable.
 */
export function fetchCooldownMs(lastIso: string | null, nowMs: number, minIntervalMs: number): number {
	if (!lastIso) return 0;
	const last = Date.parse(lastIso);
	if (Number.isNaN(last)) return 0; // unparseable → don't block
	return Math.max(0, minIntervalMs - (nowMs - last));
}

/** Return votes from `fresh` whose key is not already known. */
export function newVotes(known: Set<string>, fresh: Vote[]): Vote[] {
	return fresh.filter((v) => !known.has(voteKey(v)));
}

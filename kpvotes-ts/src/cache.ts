import { PetBoxDataClient } from "@stdray-npm/petbox-client";
import type { Config, Vote } from "./types";

// Votes cache, backed by a PetBox DataDb (replaces the local votes.json file).
//   CREATE TABLE votes (Uri TEXT NOT NULL, Name TEXT NOT NULL, Vote INTEGER NOT NULL);

const SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS votes (Uri TEXT NOT NULL, Name TEXT NOT NULL, Vote INTEGER NOT NULL)";

/** Binds a PetBoxDataClient to this project's cache db so the rest of the code
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

	/** Create the DataDb (if missing) and apply the votes-table migration. Idempotent. */
	async ensureSchema(): Promise<void> {
		try {
			await this.client.createDb(this.project, this.db, { description: "KpVotes votes cache" });
		} catch {
			// Already exists — createDb is not idempotent server-side; applySchema below is.
		}
		await this.client.applySchema(this.project, this.db, "001-votes", SCHEMA_SQL);
	}

	async read(): Promise<Vote[] | null> {
		const rows = await this.client.query<Vote>(this.project, this.db, "SELECT Uri, Name, Vote FROM votes");
		if (rows.length === 0) return null; // empty table == "no cache yet" (initial run)
		return rows.map((r) => ({ Uri: String(r.Uri), Name: String(r.Name), Vote: Number(r.Vote) }));
	}

	/** Replace the entire cache with `votes`. */
	async write(votes: Vote[]): Promise<void> {
		await this.client.exec(this.project, this.db, "DELETE FROM votes");
		for (const v of votes) await this.insert(v);
	}

	/** Append a single vote — cheaper than rewriting the whole table per new vote. */
	async insert(v: Vote): Promise<void> {
		await this.client.exec(this.project, this.db, "INSERT INTO votes (Uri, Name, Vote) VALUES (@uri, @name, @vote)", [
			{ name: "@uri", value: v.Uri },
			{ name: "@name", value: v.Name },
			{ name: "@vote", value: v.Vote },
		]);
	}
}

/** Key for dedup: Uri + Vote */
export function voteKey(v: Vote): string {
	return `${v.Uri}|${v.Vote}`;
}

/** Return votes from `fresh` that are not in `cached` (by Uri+Vote) */
export function diff(cached: Vote[], fresh: Vote[]): Vote[] {
	const seen = new Set(cached.map(voteKey));
	return fresh.filter((v) => !seen.has(voteKey(v)));
}

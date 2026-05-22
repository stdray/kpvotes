import type { Vote } from "./types";

export async function readCache(path: string): Promise<Vote[] | null> {
	const file = Bun.file(path);
	if (!(await file.exists())) return null;
	return (await file.json()) as Vote[];
}

export function writeCache(path: string, votes: Vote[]): void {
	const dir = path.substring(0, path.lastIndexOf("/"));
	if (dir) {
		const _d = Bun.file(dir);
		// Ensure directory exists via mkdir -p equivalent
		Bun.spawnSync(["mkdir", "-p", dir]);
	}
	Bun.write(path, JSON.stringify(votes, null, 2));
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

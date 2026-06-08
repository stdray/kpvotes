import { runtimeInfo, tagVector } from "./runtime";
import type { Config } from "./types";

/**
 * Push a health/status report to PetBox (POST /api/health). KpVotes is a cron
 * worker with no HTTP server, so it can't be polled — it pushes its status after
 * each cycle instead. The status page shows the latest report per (Svc, Tags);
 * a missing/stale report flags the worker as down.
 *
 * Requires the API key to have the `health:write` scope.
 */
export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export async function pushHealth(
	cfg: Config,
	status: HealthStatus,
	extraTags: Record<string, string> = {},
): Promise<void> {
	const rt = runtimeInfo();
	const base = cfg.petbox.endpoint.replace(/\/+$/, "");
	const body = {
		Svc: rt.app,
		Name: "KpVotes worker",
		Tags: { ...tagVector(), ...extraTags },
		Version: rt.version,
		Sha: rt.sha,
		BuildDate: rt.buildDate,
		Status: status,
	};

	const resp = await fetch(`${base}/api/health`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-Api-Key": cfg.petbox.apiKey },
		body: JSON.stringify(body),
	});
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`health push failed (${resp.status}): ${text}`);
	}
}

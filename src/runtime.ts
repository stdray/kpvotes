import { hostname } from "node:os";

/**
 * Runtime identity of this process: build version (injected at docker build time
 * via env, see Dockerfile APP_VERSION/GIT_SHORT_SHA/GIT_COMMIT_DATE) plus the
 * machine it runs on. Used for the startup log, winston defaultMeta, and the
 * PetBox health push so every log/report says which build on which host produced it.
 */
export interface RuntimeInfo {
	app: string;
	version: string;
	sha: string;
	buildDate: string;
	host: string;
	platform: string;
	arch: string;
	nodeVersion: string;
	pid: number;
	/** True when running inside a container (KUBERNETES_SERVICE_HOST or /.dockerenv-style hint via env). */
	containerized: boolean;
}

let _info: RuntimeInfo | null = null;

export function runtimeInfo(): RuntimeInfo {
	if (_info) return _info;
	_info = {
		app: "kpvotes-ts",
		version: process.env.APP_VERSION ?? "dev",
		sha: process.env.GIT_SHORT_SHA ?? "unknown",
		buildDate: process.env.GIT_COMMIT_DATE ?? "unknown",
		host: process.env.HOSTNAME || hostname(),
		platform: process.platform,
		arch: process.arch,
		nodeVersion: process.versions.node,
		pid: process.pid,
		containerized: process.env.KPVOTES_CONTAINER === "true" || process.env.KUBERNETES_SERVICE_HOST !== undefined,
	};
	return _info;
}

/**
 * The tag-vector the app resolved its config under. Mirrors what config.ts sends
 * to PetBox (/v1/conf?project=kpvotes) plus the host, so logs/health can be
 * filtered the same way config is.
 */
export function tagVector(): Record<string, string> {
	const info = runtimeInfo();
	return { project: "kpvotes", host: info.host };
}

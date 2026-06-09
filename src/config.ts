import { PetBoxConfigClient } from "@stdray-npm/petbox-client";
import type { Config } from "./types";

let _config: Config | null = null;

function required(val: string | undefined, name: string): string {
	if (val === undefined) throw new Error(`Missing required config binding: ${name}`);
	return val;
}

export async function getConfig(): Promise<Config> {
	if (_config) return _config;

	const endpoint = process.env.PETBOX_ENDPOINT;
	const apiKey = process.env.PETBOX_API_KEY;
	if (!endpoint || !apiKey) {
		throw new Error("PETBOX_ENDPOINT and PETBOX_API_KEY are required");
	}

	const client = new PetBoxConfigClient({
		endpoint,
		apiKey,
		tags: { project: "kpvotes" },
		template: "flat",
	});

	const cfg = await client.fetch();

	const proxyEnabled = cfg.get("kpvotes.proxy-enabled") === "true";
	const proxyServer = cfg.get("kpvotes.proxy-server");
	const proxyUser = cfg.get("kpvotes.proxy-username");
	const proxyPass = cfg.get("kpvotes.proxy-password");

	const twitterProxyEnabled = cfg.get("kpvotes.twitter-proxy-enabled") === "true";
	const twitterProxyServer = cfg.get("kpvotes.twitter-proxy-server");
	const twitterProxyUser = cfg.get("kpvotes.twitter-proxy-username");
	const twitterProxyPass = cfg.get("kpvotes.twitter-proxy-password");

	const dumpPages = cfg.get("kpvotes.dump-pages") === "true";
	const dataPath = (process.env.KPVOTES_DATA_PATH ?? "data").replace(/\/+$/, "");

	const obj: Config = {
		votesUrl: required(cfg.get("kpvotes.votes-url"), "kpvotes.votes-url"),
		dataPath,
		petbox: {
			endpoint,
			apiKey,
			project: "kpvotes",
			db: process.env.PETBOX_DATA_DB ?? "kpvotes-cache",
		},
		dumpPages,
		intervalMinutes: cfg.getNumber("kpvotes.interval-minutes") ?? 120,
		userAgent: required(cfg.get("kpvotes.user-agent"), "kpvotes.user-agent"),
		proxyEnabled,
		twitterProxyEnabled,
		twitter: {
			appKey: required(cfg.get("kpvotes.twitter-app-key"), "kpvotes.twitter-app-key"),
			appSecret: required(cfg.get("kpvotes.twitter-app-secret"), "kpvotes.twitter-app-secret"),
			accessToken: required(cfg.get("kpvotes.twitter-access-token"), "kpvotes.twitter-access-token"),
			accessSecret: required(cfg.get("kpvotes.twitter-access-secret"), "kpvotes.twitter-access-secret"),
		},
		seq: {
			serverUrl: required(cfg.get("seq.server-url"), "seq.server-url"),
			apiKey: required(cfg.get("seq.api-key"), "seq.api-key"),
		},
	};

	if (proxyEnabled && proxyServer) {
		obj.proxy = { server: proxyServer };
		if (proxyUser !== undefined) obj.proxy.username = proxyUser;
		if (proxyPass !== undefined) obj.proxy.password = proxyPass;
	}

	if (twitterProxyEnabled && twitterProxyServer) {
		obj.twitterProxy = { server: twitterProxyServer };
		if (twitterProxyUser !== undefined) obj.twitterProxy.username = twitterProxyUser;
		if (twitterProxyPass !== undefined) obj.twitterProxy.password = twitterProxyPass;
	}

	_config = obj;
	return obj;
}

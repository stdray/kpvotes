import { YobaConfClient } from "@stdray-npm/yobaconf-client";
import type { Config } from "./types";

let _config: Config | null = null;

function required(val: string | undefined, name: string): string {
	if (val === undefined) throw new Error(`Missing required config binding: ${name}`);
	return val;
}

export async function getConfig(): Promise<Config> {
	if (_config) return _config;

	const endpoint = process.env.YOBACONF_ENDPOINT;
	const apiKey = process.env.YOBACONF_API_KEY;
	if (!endpoint || !apiKey) {
		throw new Error("YOBACONF_ENDPOINT and YOBACONF_API_KEY are required");
	}

	const client = new YobaConfClient({
		endpoint,
		apiKey,
		tags: { project: "kpvotes" },
		template: "flat",
	});

	const cfg = await client.fetch();

	const proxyServer = cfg.get("kpvotes.proxy-server");
	const proxyUser = cfg.get("kpvotes.proxy-username");
	const proxyPass = cfg.get("kpvotes.proxy-password");

	const obj: Config = {
		kpUri: required(cfg.get("kpvotes.kp-uri"), "kpvotes.kp-uri"),
		votesUri: required(cfg.get("kpvotes.votes-uri"), "kpvotes.votes-uri"),
		cachePath: required(cfg.get("kpvotes.cache-path"), "kpvotes.cache-path"),
		intervalMinutes: cfg.getNumber("kpvotes.interval-minutes") ?? 120,
		userAgent: required(cfg.get("kpvotes.user-agent"), "kpvotes.user-agent"),
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

	if (proxyServer) {
		obj.proxy = { server: proxyServer };
		if (proxyUser !== undefined) obj.proxy.username = proxyUser;
		if (proxyPass !== undefined) obj.proxy.password = proxyPass;
	}

	_config = obj;
	return obj;
}

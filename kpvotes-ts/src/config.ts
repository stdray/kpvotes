import { YobaConfClient } from "@stdray-npm/yobaconf-client";
import type { Config } from "./types";

let _config: Config | null = null;

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

  _config = {
    kpUri: cfg.get("kpvotes.kp-uri")!,
    votesUri: cfg.get("kpvotes.votes-uri")!,
    cachePath: cfg.get("kpvotes.cache-path")!,
    intervalMinutes: cfg.getNumber("kpvotes.interval-minutes") ?? 120,
    userAgent: cfg.get("kpvotes.user-agent")!,
    twitter: {
      appKey: cfg.get("kpvotes.twitter-app-key")!,
      appSecret: cfg.get("kpvotes.twitter-app-secret")!,
      accessToken: cfg.get("kpvotes.twitter-access-token")!,
      accessSecret: cfg.get("kpvotes.twitter-access-secret")!,
    },
    proxy: proxyServer
      ? {
          server: proxyServer,
          username: proxyUser ?? undefined,
          password: proxyPass ?? undefined,
        }
      : undefined,
    lightpanda: {
      cdpUrl: cfg.get("kpvotes.lightpanda-cdp-url")!,
    },
  };

  return _config;
}

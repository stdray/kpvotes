import type { Config } from './types';

let _config: Config | null = null;

export async function getConfig(configPath?: string): Promise<Config> {
  if (_config) return _config;

  const path = configPath
    || process.env.KPVOTES_CONFIG
    || `${import.meta.dirname}/../config.json`;

  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Config file not found: ${path}`);

  _config = (await file.json()) as Config;

  // Env overrides
  const env = process.env;
  if (env.KPVOTES_CACHE_PATH) _config.cachePath = env.KPVOTES_CACHE_PATH;
  if (env.KPVOTES_INTERVAL_MINUTES) _config.intervalMinutes = Number(env.KPVOTES_INTERVAL_MINUTES);
  if (env.KPVOTES_KP_URI) _config.kpUri = env.KPVOTES_KP_URI;
  if (env.KPVOTES_VOTES_URI) _config.votesUri = env.KPVOTES_VOTES_URI;
  if (env.KPVOTES_TWITTER_APPKEY) _config.twitter.appKey = env.KPVOTES_TWITTER_APPKEY;
  if (env.KPVOTES_TWITTER_APPSECRET) _config.twitter.appSecret = env.KPVOTES_TWITTER_APPSECRET;
  if (env.KPVOTES_TWITTER_ACCESSTOKEN) _config.twitter.accessToken = env.KPVOTES_TWITTER_ACCESSTOKEN;
  if (env.KPVOTES_TWITTER_ACCESSSECRET) _config.twitter.accessSecret = env.KPVOTES_TWITTER_ACCESSSECRET;
  if (env.KPVOTES_PROXY_SERVER) _config.proxy = { ..._config.proxy, server: env.KPVOTES_PROXY_SERVER };
  if (env.KPVOTES_LIGHTPANDA_CDP) _config.lightpanda.cdpUrl = env.KPVOTES_LIGHTPANDA_CDP;

  return _config;
}

import { TwitterApi } from "twitter-api-v2";
import type { Config } from "./types";

let _client: TwitterApi | null = null;

function getClient(cfg: Config): TwitterApi {
	if (_client) return _client;
	_client = new TwitterApi({
		appKey: cfg.twitter.appKey,
		appSecret: cfg.twitter.appSecret,
		accessToken: cfg.twitter.accessToken,
		accessSecret: cfg.twitter.accessSecret,
	});
	return _client;
}

export async function postTweet(cfg: Config, text: string): Promise<void> {
	const client = getClient(cfg);
	await client.v2.tweet(text);
}

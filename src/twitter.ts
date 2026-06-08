import { ApiResponseError, TwitterApi } from "twitter-api-v2";
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

/** Thrown when X has no API write credits left (HTTP 402 CreditsDepleted).
 *  Distinct from a transient failure: posting is paused until credits are topped
 *  up, so the caller should STOP the run (not retry the rest immediately). */
export class CreditsDepletedError extends Error {
	constructor() {
		super("X API credits depleted (402)");
		this.name = "CreditsDepletedError";
	}
}

export async function postTweet(cfg: Config, text: string): Promise<void> {
	const client = getClient(cfg);
	try {
		// v2 POST /2/tweets — v1.1 statuses/update is retired (404). Posting needs a
		// funded X API tier; an exhausted balance returns 402 CreditsDepleted.
		await client.v2.tweet(text);
	} catch (err) {
		if (err instanceof ApiResponseError && err.code === 402) throw new CreditsDepletedError();
		throw err;
	}
}

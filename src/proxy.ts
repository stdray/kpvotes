import type { Agent } from "node:http";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

/**
 * Shared proxy helpers for outbound egress. Both proxy consumers use these so
 * their config shape and URL construction are identical (only the value set is
 * independent):
 *   - the Twitter poster (twitter.ts) → `createProxyAgent` → http.Agent
 *   - the Kinopoisk fetch (loader.ts) → `buildProxyUrl` → Lightpanda `httpProxy`
 *
 * The scheme is carried in the server URL — `socks5://host:1080`,
 * `http://host:8080` — and (for the agent) selected from it. Auth, when supplied
 * separately, is injected into the URL. `createProxyAgent` supports both SOCKS
 * and HTTP; Lightpanda's `httpProxy` only supports HTTP proxies.
 *
 * `buildProxyUrl` and `proxyKind` are pure so scheme handling is unit-testable
 * without opening a socket.
 */

/**
 * Normalize a proxy `server` URL, injecting `username`/`password` if given.
 * Returns the full href (with embedded credentials). Throws if `server` is not a
 * parseable URL with a scheme (e.g. a bare `host:port`).
 */
export function buildProxyUrl(server: string, username?: string, password?: string): string {
	// Require an explicit `scheme://authority`. `new URL()` alone is too lenient:
	// a bare `host:1080` parses as scheme `host`, so demand the `//` to catch that.
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(server)) {
		throw new Error(`Invalid proxy server URL (need a scheme, e.g. socks5://host:1080): ${server}`);
	}
	let url: URL;
	try {
		url = new URL(server);
	} catch {
		throw new Error(`Invalid proxy server URL (need a scheme, e.g. socks5://host:1080): ${server}`);
	}
	if (username) {
		url.username = username;
		url.password = password ?? "";
	}
	return url.href;
}

/** Classify a proxy URL by scheme. Throws on an unsupported scheme. */
export function proxyKind(url: string): "socks" | "http" {
	const scheme = new URL(url).protocol.replace(/:$/, "");
	switch (scheme) {
		case "socks":
		case "socks4":
		case "socks5":
		case "socks5h":
			return "socks";
		case "http":
		case "https":
			return "http";
		default:
			throw new Error(`Unsupported proxy scheme: ${scheme}`);
	}
}

/**
 * Build a Node http.Agent that routes requests through the given proxy.
 * SOCKS proxies use SocksProxyAgent; http/https proxies tunnel to the HTTPS
 * target (api.twitter.com:443) via CONNECT using HttpsProxyAgent.
 */
export function createProxyAgent(server: string, username?: string, password?: string): Agent {
	const url = buildProxyUrl(server, username, password);
	return proxyKind(url) === "socks" ? new SocksProxyAgent(url) : new HttpsProxyAgent(url);
}

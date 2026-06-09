import { describe, expect, it } from "vitest";
import { buildProxyUrl, proxyKind } from "../src/proxy";

describe("buildProxyUrl", () => {
	it("injects credentials into a socks5 URL", () => {
		expect(buildProxyUrl("socks5://h:1080", "u", "p")).toBe("socks5://u:p@h:1080");
	});

	it("injects a username with an empty password", () => {
		expect(buildProxyUrl("socks5://h:1080", "u")).toBe("socks5://u@h:1080");
	});

	it("leaves a credential-less http URL unchanged", () => {
		expect(buildProxyUrl("http://h:8080")).toBe("http://h:8080/");
	});

	it("throws on a scheme-less host:port (the common footgun)", () => {
		expect(() => buildProxyUrl("h:1080")).toThrow(/scheme/);
		expect(() => buildProxyUrl("127.0.0.1:1080")).toThrow(/scheme/);
	});

	it("throws on garbage", () => {
		expect(() => buildProxyUrl("not a url")).toThrow(/Invalid proxy server URL/);
	});
});

describe("proxyKind", () => {
	it("maps socks variants to socks", () => {
		expect(proxyKind("socks://h:1080")).toBe("socks");
		expect(proxyKind("socks5://h:1080")).toBe("socks");
		expect(proxyKind("socks5h://h:1080")).toBe("socks");
		expect(proxyKind("socks4://h:1080")).toBe("socks");
	});

	it("maps http/https to http", () => {
		expect(proxyKind("http://h:8080")).toBe("http");
		expect(proxyKind("https://h:8443")).toBe("http");
	});

	it("throws on an unsupported scheme", () => {
		expect(() => proxyKind("ftp://h:21")).toThrow(/Unsupported proxy scheme: ftp/);
	});
});

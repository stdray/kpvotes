import type { Config } from "./types";

/**
 * Loads HTML via Lightpanda CDP (Chrome DevTools Protocol).
 *
 * Flow: Target.createTarget → Target.attachToTarget (sessionId)
 *       → Page.enable → Page.navigate → Page.loadEventFired
 *       → Runtime.evaluate (document.documentElement.outerHTML)
 */
export async function loadHtml(cfg: Config): Promise<string> {
	const cdpUrl = process.env.KPVOTES_LIGHTPANDA_CDP ?? "ws://127.0.0.1:9222";
	const uri = `${cfg.kpUri}/${cfg.votesUri}`;

	const ws = new WebSocket(cdpUrl + "/");

	let msgId = 0;
	const pending = new Map<number, (v: Record<string, unknown>) => void>();
	let loadFired = false;

	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data as string);
		if (msg.id !== undefined && pending.has(msg.id)) {
			const resolve = pending.get(msg.id)!;
			pending.delete(msg.id);
			resolve(msg);
		}
		if (msg.method === "Page.loadEventFired") {
			loadFired = true;
		}
	};

	const send = (method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> => {
		const id = ++msgId;
		return new Promise((resolve) => {
			pending.set(id, resolve);
			ws.send(JSON.stringify({ id, method, params }));
		});
	};

	await new Promise<void>((resolve, reject) => {
		ws.onopen = () => resolve();
		ws.onerror = () => reject(new Error("CDP WebSocket connection failed"));
	});

	let sessionId: string;
	try {
		// Create target
		const ct = await send("Target.createTarget", { url: "about:blank" });
		const targetId = (ct.result as { targetId: string }).targetId;

		// Attach to get sessionId
		const at = await send("Target.attachToTarget", { targetId, flatten: true });
		sessionId = (at.result as { sessionId: string }).sessionId;

		const session = (method: string, params?: Record<string, unknown>) =>
			send(method, { ...params, sessionId });

		// Enable Page and navigate
		await session("Page.enable");
		await session("Page.navigate", { url: uri });

		// Wait for load event (60s timeout)
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Page load timed out after 60s")), 60000);
			const check = setInterval(() => {
				if (loadFired) {
					clearTimeout(timeout);
					clearInterval(check);
					resolve();
				}
			}, 500);
		});

		// Extra wait for JS rendering
		await new Promise((r) => setTimeout(r, 15000));

		// Get HTML
		const re = await session("Runtime.evaluate", {
			expression: "document.documentElement.outerHTML",
			returnByValue: true,
		});
		const html = (re.result as { result?: { value?: string } })?.result?.value ?? "";
		if (!html) throw new Error("Empty HTML from Lightpanda");

		// Save page to disk
		Bun.write(`data/pages/${new Date().toISOString().replace(/:/g, "-")}.html`, html);
		return html;
	} finally {
		ws.close();
	}
}

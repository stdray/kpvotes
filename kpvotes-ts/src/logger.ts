import { Logger as SeqLogger } from "seq-logging";
import type { Config } from "./types";

let _logger: SeqLogger | null = null;

export function initLogger(cfg: Config): SeqLogger {
	if (_logger) return _logger;
	_logger = new SeqLogger({
		serverUrl: cfg.seq.serverUrl,
		apiKey: cfg.seq.apiKey,
		onError: (e) => console.error("[seq] send error:", e.message),
	});
	return _logger;
}

export function getLogger(): SeqLogger {
	if (!_logger) throw new Error("Logger not initialized");
	return _logger;
}

export function log(
	level: "Information" | "Warning" | "Error" | "Debug",
	messageTemplate: string,
	properties?: Record<string, unknown>,
): void {
	const logger = getLogger();
	logger.emit({
		timestamp: new Date(),
		level,
		messageTemplate,
		properties: properties ?? {},
	});

	// Console mirror for local visibility
	const tpl = messageTemplate.replace(/\{(\w+)\}/g, (_, k) => String(properties?.[k] ?? `{${k}}`));
	const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
	const fn = level === "Error" ? console.error : console.log;
	fn(`[${ts}] ${level}: ${tpl}`);
}

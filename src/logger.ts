import { SeqTransport } from "@datalust/winston-seq";
import winston from "winston";
import { runtimeInfo, tagVector } from "./runtime";
import type { Config } from "./types";

let _logger: winston.Logger | null = null;
let _seqTransport: SeqTransport | null = null;

export function initLogger(cfg: Config): winston.Logger {
	if (_logger) return _logger;

	_seqTransport = new SeqTransport({
		serverUrl: cfg.seq.serverUrl,
		apiKey: cfg.seq.apiKey,
		onError: (e) => console.error("[seq]", e.message),
	});

	const info = runtimeInfo();

	_logger = winston.createLogger({
		level: process.env.KPVOTES_LOG_LEVEL ?? "info",
		// Stamped on every event so the PetBox log says which build, on which host,
		// under which tag-vector produced it.
		defaultMeta: {
			app: info.app,
			version: info.version,
			sha: info.sha,
			host: info.host,
			...tagVector(),
		},
		format: winston.format.combine(
			winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
			winston.format.errors({ stack: true }),
			winston.format.json(),
		),
		transports: [
			new winston.transports.Console({
				// Console stays terse: drop the per-event identity meta (it's on every
				// line); the full context goes to Seq and the startup log below.
				format: winston.format.combine(
					winston.format.colorize(),
					winston.format.printf(
						({ timestamp, level, message, app: _a, version: _v, sha: _s, host: _h, project: _p, ...rest }) => {
							const meta = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
							return `${timestamp} ${level}: ${message}${meta}`;
						},
					),
				),
			}),
			_seqTransport,
		],
	});

	return _logger;
}

/**
 * Flush buffered Seq events and close the logger. Call on shutdown — the Seq
 * transport batches events (~2s) and would otherwise drop the tail on exit.
 */
export async function closeLogger(): Promise<void> {
	const logger = _logger;
	const seq = _seqTransport;
	// Null out first so this is idempotent and a late log() can't resurrect a
	// half-closed transport.
	_logger = null;
	_seqTransport = null;

	// Flush + close the Seq transport. winston's logger.close() would also unpipe
	// and re-close this transport, so we do NOT also call logger.close() — that
	// double-close throws "already closed". Closing the transport is enough to
	// flush the batch and release the process.
	if (seq) {
		try {
			await seq.close();
		} catch (e) {
			console.error("[seq] close failed", e instanceof Error ? e.message : e);
		}
	} else {
		logger?.close();
	}
}

export function getLogger(): winston.Logger {
	if (!_logger) throw new Error("Logger not initialized");
	return _logger;
}

export function log(level: "info" | "warn" | "error" | "debug", message: string, meta?: Record<string, unknown>): void {
	if (level === "error" && meta?.error instanceof Error) {
		const err = meta.error;
		getLogger().log(level, message, {
			...meta,
			error: err.message,
			stack: err.stack,
		});
	} else {
		getLogger().log(level, message, meta ?? {});
	}
}

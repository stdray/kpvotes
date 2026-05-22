import winston from "winston";
import { Seq } from "winston-seq";
import type { Config } from "./types";

let _logger: winston.Logger | null = null;

export function initLogger(cfg: Config): winston.Logger {
	if (_logger) return _logger;

	_logger = winston.createLogger({
		level: "info",
		format: winston.format.combine(
			winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
			winston.format.errors({ stack: true }),
			winston.format.json(),
		),
		transports: [
			new winston.transports.Console({
				format: winston.format.combine(
					winston.format.colorize(),
					winston.format.printf(({ timestamp, level, message, ...rest }) => {
						const meta = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
						return `${timestamp} ${level}: ${message}${meta}`;
					}),
				),
			}),
			// winston-seq v0.1.0 types don't match winston v3 TransportStream; safe cast
			new (Seq as unknown as new (o: object) => winston.transport)({
				serverUrl: cfg.seq.serverUrl,
				apiKey: cfg.seq.apiKey,
			}),
		],
	});

	return _logger;
}

export function getLogger(): winston.Logger {
	if (!_logger) throw new Error("Logger not initialized");
	return _logger;
}

export function log(
	level: "info" | "warn" | "error" | "debug",
	message: string,
	meta?: Record<string, unknown>,
): void {
	getLogger().log(level, message, meta);
}

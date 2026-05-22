import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Vote } from "./types";

const VOTES_SELECTOR = ".historyVotes .item";
const CAPTCHA_SELECTOR = ".CheckboxCaptcha-Button";

export function parseVotes(html: string): Vote[] {
	const $ = cheerio.load(html);

	if ($(CAPTCHA_SELECTOR).length > 0) {
		throw new Error("Captcha detected");
	}

	const votes: Vote[] = [];

	$(VOTES_SELECTOR).each((_, item) => {
		const nameEl = $(item).find(".nameRus a").first();
		if (!nameEl.length) return;

		const href = nameEl.attr("href");
		const name = nameEl.text().trim();
		const voteVal = extractVote($, item);

		if (href && name && voteVal !== null) {
			votes.push({ Uri: href, Name: name, Vote: voteVal });
		}
	});

	// Page lists oldest first; reverse to chronological order
	return votes.reverse();
}

function extractVote($: cheerio.CheerioAPI, item: AnyNode): number | null {
	const voteEl = $(item).find(".vote").first() || $(item).find(".myVote").first();
	const text = voteEl.text().trim();
	if (text) {
		const n = parseInt(text, 10);
		if (!Number.isNaN(n)) return n;
	}

	// Try extracting from script (rating: '7')
	const scripts = $(item).find("script");
	for (let i = 0; i < scripts.length; i++) {
		const content = $(scripts[i]).text();
		const m = content.match(/rating:\s*'(\d+)'/);
		if (m?.[1]) return parseInt(m[1], 10);
	}

	return null;
}

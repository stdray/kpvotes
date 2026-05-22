import { getConfig } from './config';
import { loadHtml } from './loader';
import { parseVotes } from './parser';
import { postTweet } from './twitter';
import { readCache, writeCache, diff } from './cache';
import type { Vote, Config } from './types';

async function main(): Promise<void> {
  const cfg = await getConfig();
  console.log('[kpvotes] Starting, interval:', cfg.intervalMinutes, 'min');

  await runCycle(cfg);

  setInterval(() => runCycle(cfg), cfg.intervalMinutes * 60 * 1000);
}

async function runCycle(cfg: Config): Promise<void> {
  try {
    console.log('[kpvotes] Loading page...');
    const html = await loadHtml(cfg);

    console.log('[kpvotes] Parsing votes...');
    const freshVotes = parseVotes(html);
    console.log(`[kpvotes] Found ${freshVotes.length} votes`);

    if (!freshVotes.length) {
      console.log('[kpvotes] No votes found');
      return;
    }

    const cached = await readCache(cfg.cachePath);

    if (!cached) {
      console.log('[kpvotes] No cache, creating...');
      writeCache(cfg.cachePath, freshVotes);
      console.log('[kpvotes] Cache created with', freshVotes.length, 'votes');
      return;
    }

    const newVotes = diff(cached, freshVotes);
    console.log(`[kpvotes] New votes: ${newVotes.length}`);

    for (const vote of newVotes) {
      await postVote(cfg, vote);
      cached.push(vote);
      writeCache(cfg.cachePath, cached);
      await sleep(30000);
    }

    console.log('[kpvotes] Cycle complete');
  } catch (err) {
    console.error('[kpvotes] Error:', err);
  }
}

async function postVote(cfg: Config, vote: Vote): Promise<void> {
  const filled = '★'.repeat(vote.Vote);
  const empty = '☆'.repeat(10 - vote.Vote);
  const stars = filled + empty;
  const uri = `${cfg.kpUri}${vote.Uri}`;
  const text = `${vote.Name}.\r\nМоя оценка ${vote.Vote} из 10 ${stars} #kinopoisk\r\n${uri}`;

  console.log(`[kpvotes] Posting: ${vote.Name} (${vote.Vote}/10)`);
  await postTweet(cfg, text);
  console.log(`[kpvotes] Posted: ${vote.Uri}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main();

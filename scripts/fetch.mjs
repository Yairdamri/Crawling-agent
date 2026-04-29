import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { fetchAllFeeds } from './feeds.mjs';
import { loadSeenUrls, filterUnseen } from './dedupe.mjs';
import { processArticles } from './openai.mjs';
import { mergeAndWrite } from './store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const FEEDS_PATH = join(root, 'config', 'feeds.json');
const NEWS_PATH = join(root, 'data', 'news.json');
const SEEN_PATH = join(root, 'data', 'seen_urls.json');

async function loadFeeds() {
  const raw = await readFile(FEEDS_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('config/feeds.json must be an array');
  return parsed.filter((f) => f && typeof f.url === 'string' && typeof f.name === 'string');
}

async function main() {
  const startedAt = Date.now();
  const feeds = await loadFeeds();
  console.log(`[pipeline] ${feeds.length} feeds configured`);

  const items = await fetchAllFeeds(feeds);
  if (items.length === 0) {
    console.log('[pipeline] no items fetched, nothing to do');
    return;
  }

  const seenMap = await loadSeenUrls(SEEN_PATH);
  const fresh = filterUnseen(items, seenMap);
  console.log(`[pipeline] ${fresh.length} fresh items after dedupe (was ${items.length})`);

  if (fresh.length === 0) {
    await mergeAndWrite({
      newsPath: NEWS_PATH,
      seenPath: SEEN_PATH,
      processed: [],
      seenMap,
    });
    console.log('[pipeline] no fresh items, news.json metadata refreshed');
    return;
  }

  const processed = await processArticles(fresh);
  console.log(`[pipeline] ${processed.length} articles returned by OpenAI`);

  const stats = await mergeAndWrite({
    newsPath: NEWS_PATH,
    seenPath: SEEN_PATH,
    processed,
    seenMap,
  });
  console.log(
    `[pipeline] done in ${Math.round((Date.now() - startedAt) / 1000)}s ` +
      `- written: ${stats.written}, dropped (score<5): ${stats.droppedLowScore}, ` +
      `seen cache: ${stats.seenSize}`
  );
}

main().catch((err) => {
  console.error('[pipeline] fatal:', err);
  process.exit(1);
});

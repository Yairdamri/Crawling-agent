import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateImages } from './images.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const NEWS_PATH = join(root, 'data', 'news.json');
const SEEN_PATH = join(root, 'data', 'seen_urls.json');
const IMAGES_DIR = join(root, 'data', 'images');

const MAX_BACKFILL = Number(process.env.BACKFILL_LIMIT) || 30;
const MIN_SCORE = Number(process.env.BACKFILL_MIN_SCORE) || 8;

async function main() {
  const news = JSON.parse(await readFile(NEWS_PATH, 'utf8'));
  const articles = Array.isArray(news.articles) ? news.articles : [];

  let seen = [];
  try {
    seen = JSON.parse(await readFile(SEEN_PATH, 'utf8'));
  } catch (err) {
    console.warn(`[backfill] could not read seen_urls.json: ${err.message}`);
  }

  const hashByUrl = new Map();
  for (const e of seen) {
    if (e && typeof e.url === 'string' && e.contentHash) {
      hashByUrl.set(e.url, e.contentHash);
    }
  }

  const candidates = articles
    .filter((a) => !a.imageFilename)
    .filter((a) => hashByUrl.has(a.url))
    .filter((a) => (Number(a.score) || 0) >= MIN_SCORE)
    .sort((a, b) => {
      const sa = Number(a.score) || 0;
      const sb = Number(b.score) || 0;
      if (sa !== sb) return sb - sa;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

  const targets = candidates.slice(0, MAX_BACKFILL);

  console.log(
    `[backfill] total: ${articles.length}, ` +
    `with image: ${articles.filter((a) => a.imageFilename).length}, ` +
    `eligible (score>=${MIN_SCORE}, no image, has hash): ${candidates.length}, ` +
    `processing: ${targets.length} (limit ${MAX_BACKFILL})`
  );

  if (targets.length === 0) {
    console.log('[backfill] nothing to do');
    return;
  }

  // generateImages mutates each article in-place by adding imageFilename
  await generateImages(targets, hashByUrl, IMAGES_DIR);

  const updated = targets.filter((a) => a.imageFilename).length;
  if (updated > 0) {
    news.generatedAt = new Date().toISOString();
    await writeFile(NEWS_PATH, JSON.stringify(news, null, 2) + '\n', 'utf8');
    console.log(`[backfill] wrote news.json with ${updated} new imageFilename entries`);
  } else {
    console.log('[backfill] generation produced no successful images, news.json untouched');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] fatal:', err);
    process.exit(1);
  });

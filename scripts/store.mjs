import { readFile, writeFile } from 'node:fs/promises';

const RETENTION_DAYS = 30;
const SEEN_RETENTION_DAYS = 60;
const MIN_SCORE = 5;
const SCHEMA_VERSION = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    console.warn(`[store] could not read ${path}: ${err.message}. Using fallback.`);
    return fallback;
  }
}

function isWithinDays(isoDate, days) {
  if (!isoDate) return false;
  const t = new Date(isoDate).getTime();
  if (isNaN(t)) return false;
  return Date.now() - t <= days * DAY_MS;
}

export async function mergeAndWrite({ newsPath, seenPath, processed, seenMap, hashByUrl }) {
  const existing = await readJson(newsPath, { schemaVersion: SCHEMA_VERSION, articles: [] });
  const existingArticles = Array.isArray(existing.articles) ? existing.articles : [];

  const filtered = processed.filter((a) => Number.isInteger(a.score) && a.score >= MIN_SCORE);

  const byUrl = new Map();
  for (const a of existingArticles) byUrl.set(a.url, a);
  for (const a of filtered) byUrl.set(a.url, a);

  const merged = Array.from(byUrl.values())
    .filter((a) => isWithinDays(a.publishedAt, RETENTION_DAYS))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

  const output = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    articles: merged,
  };
  await writeFile(newsPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  const now = new Date().toISOString();
  for (const a of processed) {
    const contentHash = hashByUrl?.get(a.url);
    seenMap.set(a.url, { seenAt: now, contentHash });
  }
  const prunedSeen = Array.from(seenMap.entries())
    .filter(([, entry]) => isWithinDays(entry.seenAt, SEEN_RETENTION_DAYS))
    .map(([url, entry]) => ({ url, seenAt: entry.seenAt, contentHash: entry.contentHash }));
  await writeFile(seenPath, JSON.stringify(prunedSeen, null, 2) + '\n', 'utf8');

  return {
    written: merged.length,
    droppedLowScore: processed.length - filtered.length,
    seenSize: prunedSeen.length,
  };
}

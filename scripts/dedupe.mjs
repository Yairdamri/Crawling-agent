import { readFile } from 'node:fs/promises';

export async function loadSeenUrls(path) {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    const map = new Map();
    for (const entry of parsed) {
      if (typeof entry === 'string') {
        map.set(entry, { seenAt: new Date().toISOString() });
      } else if (entry && typeof entry.url === 'string') {
        map.set(entry.url, {
          seenAt: entry.seenAt || new Date().toISOString(),
          contentHash: entry.contentHash,
        });
      }
    }
    return map;
  } catch (err) {
    if (err.code === 'ENOENT') return new Map();
    console.warn(`[dedupe] could not read ${path}: ${err.message}. Starting fresh.`);
    return new Map();
  }
}

export function filterUnseen(items, seen) {
  const fresh = [];
  const dedupedThisRun = new Set();
  for (const item of items) {
    const prior = seen.get(item.url);
    if (prior && prior.contentHash && prior.contentHash === item.contentHash) continue;
    if (dedupedThisRun.has(item.url)) continue;
    dedupedThisRun.add(item.url);
    fresh.push(item);
  }
  return fresh;
}

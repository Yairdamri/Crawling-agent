import { readFile } from 'node:fs/promises';

export async function loadSeenUrls(path) {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    const map = new Map();
    for (const entry of parsed) {
      if (typeof entry === 'string') {
        map.set(entry, new Date().toISOString());
      } else if (entry && typeof entry.url === 'string') {
        map.set(entry.url, entry.seenAt || new Date().toISOString());
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
    if (seen.has(item.url)) continue;
    if (dedupedThisRun.has(item.url)) continue;
    dedupedThisRun.add(item.url);
    fresh.push(item);
  }
  return fresh;
}

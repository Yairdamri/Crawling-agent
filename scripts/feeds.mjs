import Parser from 'rss-parser';
import { createHash } from 'node:crypto';

const parser = new Parser({ timeout: 15000 });

const MAX_ITEMS_PER_FEED = 20;
const MAX_TEXT_LENGTH = 1500;

const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAM_NAMES = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
  'igshid',
  'yclid',
  '_hsenc',
  '_hsmi',
]);

function isTrackingParam(name) {
  if (TRACKING_PARAM_NAMES.has(name)) return true;
  for (const prefix of TRACKING_PARAM_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

function normalizeUrl(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  try {
    const u = new URL(raw.trim());
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.hash = '';
    const keep = [];
    for (const [k, v] of u.searchParams) {
      if (!isTrackingParam(k)) keep.push([k, v]);
    }
    keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    u.search = '';
    for (const [k, v] of keep) u.searchParams.append(k, v);
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    return u.toString();
  } catch {
    return raw;
  }
}

function hashContent(title, rawText) {
  return createHash('sha256').update(`${title}\n${rawText}`).digest('hex').slice(0, 16);
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function pickPublishedAt(item) {
  const raw = item.isoDate || item.pubDate || null;
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function normalizeItem(item, feedName) {
  const rawUrl = item.link || item.guid;
  if (!rawUrl) return null;
  const url = normalizeUrl(rawUrl);
  if (!url) return null;
  const title = (item.title || '').trim();
  if (!title) return null;
  const rawText = stripHtml(
    item['content:encoded'] || item.content || item.contentSnippet || item.summary || ''
  ).slice(0, MAX_TEXT_LENGTH);
  return {
    title,
    url,
    originalUrl: rawUrl !== url ? rawUrl : undefined,
    source: feedName,
    publishedAt: pickPublishedAt(item),
    rawText,
    contentHash: hashContent(title, rawText),
  };
}

async function fetchOne(feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    const items = (parsed.items || [])
      .slice(0, MAX_ITEMS_PER_FEED)
      .map((item) => normalizeItem(item, feed.name))
      .filter(Boolean);
    return { ok: true, name: feed.name, items };
  } catch (err) {
    return { ok: false, name: feed.name, error: err?.message || String(err), items: [] };
  }
}

export async function fetchAllFeeds(feeds) {
  const results = await Promise.allSettled(feeds.map(fetchOne));
  const items = [];
  let okCount = 0;
  let failCount = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.ok) {
      okCount++;
      items.push(...r.value.items);
    } else {
      failCount++;
      const detail = r.status === 'fulfilled' ? r.value : { name: '?', error: r.reason?.message };
      console.warn(`[feeds] failed: ${detail.name} - ${detail.error}`);
    }
  }
  console.log(`[feeds] ${okCount} ok, ${failCount} failed, ${items.length} items collected`);
  return items;
}

import { readFile, readdir, stat, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const NEWS_PATH = join(root, 'data', 'news.json');
const SEEN_PATH = join(root, 'data', 'seen_urls.json');
const IMAGES_DIR = join(root, 'data', 'images');

const SOURCE_DIR = process.env.IMPORT_SOURCE_DIR || join(homedir(), 'Downloads');
const MIN_SCORE = Number(process.env.IMPORT_MIN_SCORE) || 8;
const LIMIT = Number(process.env.IMPORT_LIMIT) || 99;
const MAX_AGE_MIN = process.env.IMPORT_MAX_AGE_MIN === undefined
  ? 120
  : Number(process.env.IMPORT_MAX_AGE_MIN);
const APPLY = process.argv.includes('--apply');

const HASH_RE = /^[a-f0-9]{16}\.png$/i;

async function main() {
  const news = JSON.parse(await readFile(NEWS_PATH, 'utf8'));
  const seen = JSON.parse(await readFile(SEEN_PATH, 'utf8'));
  const hashByUrl = new Map(
    seen.filter((e) => e && e.url && e.contentHash).map((e) => [e.url, e.contentHash])
  );

  const pending = (news.articles || [])
    .filter((a) => !a.imageFilename)
    .filter((a) => hashByUrl.has(a.url))
    .filter((a) => (Number(a.score) || 0) >= MIN_SCORE)
    .sort((a, b) => {
      const sa = Number(a.score) || 0;
      const sb = Number(b.score) || 0;
      if (sa !== sb) return sb - sa;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

  const all = await readdir(SOURCE_DIR);
  const candidates = await Promise.all(
    all
      .filter((f) => /\.png$/i.test(f))
      .filter((f) => !HASH_RE.test(f))
      .map(async (f) => {
        const path = join(SOURCE_DIR, f);
        const s = await stat(path);
        return { path, name: f, mtime: s.mtimeMs };
      })
  );
  const cutoff = MAX_AGE_MIN > 0 ? Date.now() - MAX_AGE_MIN * 60 * 1000 : 0;
  const pngs = candidates
    .filter((c) => MAX_AGE_MIN === 0 || c.mtime >= cutoff)
    .sort((a, b) => a.mtime - b.mtime);

  const N = Math.min(pngs.length, pending.length, LIMIT);

  console.log(`Source dir:        ${SOURCE_DIR}`);
  console.log(`Unrenamed PNGs:    ${pngs.length}`);
  console.log(`Pending articles:  ${pending.length} (score>=${MIN_SCORE}, no image, has hash)`);
  console.log(`Pairing the ${N} oldest-mtime PNGs with the ${N} highest-score articles.`);
  console.log('');

  if (N === 0) {
    if (pngs.length === 0) console.log('No new PNGs in source dir.');
    else console.log('No pending articles to fill.');
    return;
  }

  const pairs = [];
  for (let i = 0; i < N; i++) {
    pairs.push({
      file: pngs[i],
      article: pending[i],
      destFilename: `${hashByUrl.get(pending[i].url)}.png`,
    });
  }

  console.log('Pairing plan (oldest download -> highest-score pending article):');
  for (const [i, p] of pairs.entries()) {
    const ageMin = Math.round((Date.now() - p.file.mtime) / 60000);
    console.log(`  [${i + 1}] ${p.file.name}  (${ageMin}m old)`);
    console.log(`        -> data/images/${p.destFilename}`);
    console.log(`        for: [${p.article.category}] score ${p.article.score} - ${p.article.title.slice(0, 65)}`);
  }
  console.log('');

  if (!APPLY) {
    console.log('DRY RUN. Re-run with --apply to actually move + rename the files.');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const p of pairs) {
    const dest = join(IMAGES_DIR, p.destFilename);
    try {
      await rename(p.file.path, dest);
      ok++;
      console.log(`  moved ${p.file.name} -> ${p.destFilename}`);
    } catch (err) {
      fail++;
      console.error(`  FAIL ${p.file.name}: ${err.message}`);
    }
  }
  console.log('');
  console.log(`Done. moved=${ok}, failed=${fail}`);
  console.log(`Next: node scripts/sync-image-filenames.mjs   to update news.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

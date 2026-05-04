import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const NEWS_PATH = join(root, 'data', 'news.json');
const SEEN_PATH = join(root, 'data', 'seen_urls.json');
const IMAGES_DIR = join(root, 'data', 'images');

async function main() {
  const news = JSON.parse(await readFile(NEWS_PATH, 'utf8'));
  const seen = JSON.parse(await readFile(SEEN_PATH, 'utf8'));
  const articles = Array.isArray(news.articles) ? news.articles : [];

  const hashByUrl = new Map(
    seen.filter((e) => e && e.url && e.contentHash).map((e) => [e.url, e.contentHash])
  );

  const filesOnDisk = new Set(
    (await readdir(IMAGES_DIR)).filter((f) => /\.png$/i.test(f))
  );

  let attached = 0;
  let alreadyOk = 0;
  let noFile = 0;
  let noHash = 0;

  for (const a of articles) {
    if (a.imageFilename) { alreadyOk++; continue; }
    const hash = hashByUrl.get(a.url);
    if (!hash) { noHash++; continue; }
    const filename = `${hash}.png`;
    if (!filesOnDisk.has(filename)) { noFile++; continue; }
    a.imageFilename = filename;
    attached++;
  }

  if (attached > 0) {
    news.generatedAt = new Date().toISOString();
    await writeFile(NEWS_PATH, JSON.stringify(news, null, 2) + '\n', 'utf8');
  }

  console.log(`[sync] articles total:           ${articles.length}`);
  console.log(`[sync] already had imageFilename: ${alreadyOk}`);
  console.log(`[sync] newly attached:            ${attached}`);
  console.log(`[sync] file on disk missing:      ${noFile} (waiting for you to drop them)`);
  console.log(`[sync] no contentHash known:      ${noHash} (article older than 60 days)`);
  if (attached > 0) {
    console.log(`[sync] news.json updated.`);
  } else {
    console.log(`[sync] no changes to news.json.`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

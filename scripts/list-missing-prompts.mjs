import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildImagePrompt } from './images.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const NEWS_PATH = join(root, 'data', 'news.json');
const SEEN_PATH = join(root, 'data', 'seen_urls.json');

const MIN_SCORE = Number(process.env.MIN_SCORE) || 8;

async function main() {
  const news = JSON.parse(await readFile(NEWS_PATH, 'utf8'));
  const seen = JSON.parse(await readFile(SEEN_PATH, 'utf8'));
  const hashByUrl = new Map(
    seen.filter((e) => e && e.url && e.contentHash).map((e) => [e.url, e.contentHash])
  );

  const cands = (news.articles || [])
    .filter((a) => !a.imageFilename)
    .filter((a) => hashByUrl.has(a.url))
    .filter((a) => (Number(a.score) || 0) >= MIN_SCORE)
    .sort((a, b) => {
      const sa = Number(a.score) || 0;
      const sb = Number(b.score) || 0;
      if (sa !== sb) return sb - sa;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

  console.log(`Total articles needing images (score>=${MIN_SCORE}, no image, has hash): ${cands.length}`);
  console.log('=================================================================');
  console.log('PASTE EACH PROMPT INTO gemini.google.com (Pro / 2.5 Pro)');
  console.log('Download the image. Save under the filename shown.');
  console.log('Drop all images into data/images/ and commit. Done.');
  console.log('=================================================================\n');

  cands.forEach((a, i) => {
    const hash = hashByUrl.get(a.url);
    const prompt = buildImagePrompt(a);
    console.log(`--- [${i + 1}/${cands.length}] ---`);
    console.log(`TITLE:    ${a.title}`);
    console.log(`CATEGORY: ${a.category} | SCORE: ${a.score} | URL: ${a.url}`);
    console.log(`SAVE AS:  data/images/${hash}.png`);
    console.log(`PROMPT:`);
    console.log(prompt);
    console.log('');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildImagePrompt, generateImage } from './images.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const NEWS_PATH = join(root, 'data', 'news.json');
const OUT_DIR = join(root, 'data', 'images-test');
const PER_CATEGORY = Number(process.env.SAMPLES_PER_CATEGORY) || 2;

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY missing.');
  process.exit(1);
}

function hashUrl(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function pickSample(articles, perCategory) {
  const grouped = new Map();
  for (const a of articles) {
    if (!grouped.has(a.category)) grouped.set(a.category, []);
    grouped.get(a.category).push(a);
  }
  const out = [];
  for (const [, items] of grouped) out.push(...items.slice(0, perCategory));
  return out;
}

async function main() {
  const news = JSON.parse(await readFile(NEWS_PATH, 'utf8'));
  const sample = pickSample(news.articles || [], PER_CATEGORY);
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`[poc] generating ${sample.length} images (${PER_CATEGORY} per category)\n`);

  for (const article of sample) {
    const prompt = buildImagePrompt(article);
    console.log(`---\n[${article.category}] ${article.title}`);
    console.log(`prompt: ${prompt}`);
    try {
      const bytes = await generateImage(prompt);
      const path = join(OUT_DIR, `${hashUrl(article.url)}.png`);
      await writeFile(path, bytes);
      console.log(`wrote ${path} (${(bytes.length / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.error(`gen failed: ${err.message}`);
    }
  }
  console.log(`\n[poc] done. inspect: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

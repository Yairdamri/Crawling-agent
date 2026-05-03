import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const NEWS_PATH = join(root, 'data', 'news.json');
const OUT_DIR = join(root, 'data', 'images-test');

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const SAMPLE_SIZE = 5;
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error('GEMINI_API_KEY missing. Add it to .env then run: npm run test:images');
  process.exit(1);
}

function buildPrompt({ title, category, tags }) {
  return [
    `A cinematic dark teal and orange tech illustration representing: ${title}.`,
    `Subject hints: ${(tags || []).join(', ')}. Category: ${category}.`,
    `Style: editorial, abstract-realistic, server-room/circuit/data-flow aesthetic, 16:9, no text, no logos.`,
  ].join('\n');
}

function hashUrl(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function pickSample(articles, n) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    if (seen.has(a.category)) continue;
    seen.add(a.category);
    out.push(a);
    if (out.length === n) return out;
  }
  for (const a of articles) {
    if (out.includes(a)) continue;
    out.push(a);
    if (out.length === n) return out;
  }
  return out;
}

async function generateImage(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = { contents: [{ parts: [{ text: prompt }] }] };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart) {
    throw new Error(`no image in response: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return {
    bytes: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType || 'image/png',
  };
}

function extFromMime(m) {
  if (m.includes('jpeg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  return 'png';
}

async function main() {
  const news = JSON.parse(await readFile(NEWS_PATH, 'utf8'));
  const sample = pickSample(news.articles || [], SAMPLE_SIZE);
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`[poc] generating ${sample.length} images via ${MODEL}\n`);

  for (const article of sample) {
    const prompt = buildPrompt(article);
    console.log(`---\n[${article.category}] ${article.title}`);
    console.log(`prompt: ${prompt.replace(/\n/g, ' ')}`);
    try {
      const { bytes, mimeType } = await generateImage(prompt);
      const ext = extFromMime(mimeType);
      const path = join(OUT_DIR, `${hashUrl(article.url)}.${ext}`);
      await writeFile(path, bytes);
      console.log(`wrote ${path} (${(bytes.length / 1024).toFixed(0)} KB, ${mimeType})`);
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

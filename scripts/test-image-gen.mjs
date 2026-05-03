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

const CATEGORY_VISUALS = {
  AI: 'a glowing silicon chip with intricate neural network traces, pulses of light flowing through circuit pathways',
  Security: 'an abstract luminous padlock dissolving into circuit traces, layered translucent shields with streaks of light',
  DevOps: 'stacked translucent containers and glowing modular cubes in orchestrated formation',
  Cloud: 'a vast distributed mesh of server racks connected by streams of light, abstract cloud topology with luminous nodes',
  Engineering: 'an architectural blueprint of glowing code structures, wireframe of modular software components',
  Other: 'an abstract atmospheric tech landscape with light streams and circuit pathways',
};

const COMPOSITIONS = [
  'top-down macro view, symmetrical layout',
  'low-angle cinematic shot, dramatic depth of field',
  'isometric perspective, geometric clarity',
  'wide establishing shot, atmospheric haze',
  'close-up macro detail, shallow focus, glowing particles',
  'high-angle overview, connective light threads',
  'centered hero composition, radial light burst',
  'asymmetric off-center framing, dynamic flow',
];

const LIGHTINGS = [
  'warm orange key light from above with cool teal rim',
  'cold teal ambient with bright orange accent points',
  'split lighting, half teal and half orange',
  'volumetric god rays cutting through darkness',
  'electric pulses illuminating from within',
  'soft fog with a bright focal glow',
];

function cleanTags(tags) {
  return (tags || [])
    .map((t) => String(t).toLowerCase().trim())
    .filter((t) => t.length >= 4)
    .filter((t) => !/^\d/.test(t))
    .filter((t) => !/^v\d/.test(t));
}

function hashIndex(seed, modulo) {
  return createHash('sha256').update(seed).digest().readUInt32BE(0) % modulo;
}

function buildPrompt({ url, category, tags }) {
  const primary = CATEGORY_VISUALS[category] || CATEGORY_VISUALS.Other;
  const composition = COMPOSITIONS[hashIndex(url, COMPOSITIONS.length)];
  const lighting = LIGHTINGS[hashIndex(url + ':L', LIGHTINGS.length)];
  const flavor = cleanTags(tags);
  const flavorLine = flavor.length
    ? `Subtle compositional motifs (interpret visually only, never render as text): ${flavor.join(', ')}.`
    : '';
  return [
    `Editorial tech illustration.`,
    `Primary subject: ${primary}.`,
    `Composition: ${composition}.`,
    `Lighting: ${lighting}.`,
    flavorLine,
    `Style: cinematic dark teal and orange palette, abstract-realistic, moody atmospheric, depth of field, professional editorial quality.`,
    `STRICT NEGATIVE: absolutely no text, no letters, no words, no logos, no UI elements, no readable symbols, no labels, no signage, no typography of any kind. The image must contain zero textual elements.`,
  ].filter(Boolean).join('\n');
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
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '16:9' },
    },
  };
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

import { writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

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
  'warm key light from above with cool rim',
  'cold ambient with bright accent points',
  'split lighting, contrasting tones',
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

export function buildImagePrompt({ url, category, tags }) {
  const primary = CATEGORY_VISUALS[category] || CATEGORY_VISUALS.Other;
  const composition = COMPOSITIONS[hashIndex(url, COMPOSITIONS.length)];
  const lighting = LIGHTINGS[hashIndex(url + ':L', LIGHTINGS.length)];
  const flavor = cleanTags(tags);
  const flavorLine = flavor.length
    ? `Subtle motifs (visual only): ${flavor.join(', ')}.`
    : '';
  return [
    'Editorial tech illustration.',
    `Primary subject: ${primary}.`,
    `Composition: ${composition}.`,
    `Lighting: ${lighting}.`,
    flavorLine,
    'Style: cinematic, abstract-realistic, moody atmospheric, depth of field, professional editorial quality.',
    'STRICT NEGATIVE: absolutely no text, no letters, no words, no logos, no UI elements, no readable symbols, no labels, no signage, no typography of any kind. The image must contain zero textual elements.',
  ].filter(Boolean).join(' ');
}

export async function generateImage(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
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
  if (!imagePart) throw new Error(`no image in response: ${JSON.stringify(json).slice(0, 400)}`);
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

export async function generateImages(articles, hashByUrl, outDir) {
  if (!articles.length) return articles;
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[images] GEMINI_API_KEY not set, skipping image generation');
    return articles;
  }
  await mkdir(outDir, { recursive: true });

  let generated = 0;
  let cached = 0;
  let failed = 0;

  for (const article of articles) {
    const contentHash = hashByUrl.get(article.url);
    if (!contentHash) continue;
    const filename = `${contentHash}.png`;
    const path = join(outDir, filename);
    if (await fileExists(path)) {
      article.imageFilename = filename;
      cached++;
      continue;
    }
    try {
      const prompt = buildImagePrompt(article);
      const bytes = await generateImage(prompt);
      await writeFile(path, bytes);
      article.imageFilename = filename;
      generated++;
    } catch (err) {
      console.warn(`[images] gen failed for ${article.url}: ${err.message}`);
      failed++;
    }
  }
  console.log(`[images] generated: ${generated}, cached: ${cached}, failed: ${failed}`);
  return articles;
}

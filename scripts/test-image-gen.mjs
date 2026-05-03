import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const NEWS_PATH = join(root, 'data', 'news.json');
const OUT_DIR = join(root, 'data', 'images-test');

const REGION = process.env.AWS_REGION || 'us-east-1';
const MODEL = process.env.BEDROCK_IMAGE_MODEL || 'stability.sd3-5-large-v1:0';
const PER_CATEGORY = Number(process.env.SAMPLES_PER_CATEGORY) || 2;
const NEGATIVE_PROMPT = 'text, letters, words, logos, UI elements, readable symbols, labels, signage, typography, watermark';

const bedrock = new BedrockRuntimeClient({ region: REGION });

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

function buildPrompt({ url, category, tags }) {
  const primary = CATEGORY_VISUALS[category] || CATEGORY_VISUALS.Other;
  const composition = COMPOSITIONS[hashIndex(url, COMPOSITIONS.length)];
  const lighting = LIGHTINGS[hashIndex(url + ':L', LIGHTINGS.length)];
  const flavor = cleanTags(tags);
  const flavorLine = flavor.length
    ? `Subtle motifs (visual only): ${flavor.join(', ')}.`
    : '';
  return [
    `Editorial tech illustration.`,
    `Primary subject: ${primary}.`,
    `Composition: ${composition}.`,
    `Lighting: ${lighting}.`,
    flavorLine,
    `Style: cinematic, abstract-realistic, moody atmospheric, depth of field, professional editorial quality.`,
  ].filter(Boolean).join(' ');
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
  for (const [, items] of grouped) {
    out.push(...items.slice(0, perCategory));
  }
  return out;
}

async function generateImage(prompt) {
  const body = {
    prompt,
    negative_prompt: NEGATIVE_PROMPT,
    mode: 'text-to-image',
    aspect_ratio: '16:9',
    output_format: 'png',
  };
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  }));
  const parsed = JSON.parse(new TextDecoder().decode(res.body));
  const b64 = parsed.images?.[0];
  if (!b64) {
    throw new Error(`no image in response: ${JSON.stringify(parsed).slice(0, 500)}`);
  }
  if (parsed.finish_reasons?.[0] && parsed.finish_reasons[0] !== null) {
    throw new Error(`generation flagged: ${parsed.finish_reasons[0]}`);
  }
  return { bytes: Buffer.from(b64, 'base64'), mimeType: 'image/png' };
}

async function main() {
  const news = JSON.parse(await readFile(NEWS_PATH, 'utf8'));
  const sample = pickSample(news.articles || [], PER_CATEGORY);
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`[poc] generating ${sample.length} images (${PER_CATEGORY} per category) via ${MODEL}\n`);

  for (const article of sample) {
    const prompt = buildPrompt(article);
    console.log(`---\n[${article.category}] ${article.title}`);
    console.log(`prompt: ${prompt.replace(/\n/g, ' ')}`);
    try {
      const { bytes } = await generateImage(prompt);
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

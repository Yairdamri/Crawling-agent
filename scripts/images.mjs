import { writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { GoogleGenAI } from '@google/genai';

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const PROJECT = process.env.GCP_PROJECT || 'crawling-agent';
const LOCATION = process.env.GCP_LOCATION || 'us-central1';

let _client;
function getClient() {
  if (!_client) {
    _client = new GoogleGenAI({
      vertexai: true,
      project: PROJECT,
      location: LOCATION,
    });
  }
  return _client;
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

// Per-source / per-category color hints — pulled from
// .claude/skills/develeap-news-imagery/references/brand-colors.md.
// Injected into the prompt so different articles get distinct palettes
// instead of all defaulting to the same cinematic blue+red.
const BRAND_COLOR_HINTS = {
  aws:         'warm amber and burnt-orange accents',
  kubernetes:  'deep cobalt blue accents with luminous cyan highlights',
  openai:      'cool teal-green accents with soft mint highlights',
  anthropic:   'warm terracotta and copper accents',
  github:      'soft slate-gray accents with off-white highlights',
  hashicorp:   'deep violet-purple accents with magenta highlights',
  docker:      'bright sky-blue accents',
  nvidia:      'vivid neon-green accents',
  huggingface: 'bright golden-yellow accents',
  microsoft:   'bright cyan-blue accents',
  google:      'bold royal-blue accents with subtle red and yellow highlights',
  databricks:  'bright red-orange accents',
  cisa:        'deep federal-navy with pale-gold accents',
  security:    'alert crimson-red with warning amber accents',
  stripe:      'deep indigo-violet accents',
  cloudflare:  'vivid orange accents with warm gold highlights',
  meta:        'cobalt-blue accents with bright white highlights',
};

const CATEGORY_COLOR_HINTS = {
  AI:          'warm amber and golden accents',
  DevOps:      'deep cobalt-blue accents with steel-gray highlights',
  Cloud:       'cool teal and silver accents',
  Engineering: 'rich navy with warm copper accents',
  Security:    'alert crimson-red and warning amber accents',
  Other:       'muted sand and slate-gray accents',
};

function detectBrandSlug({ source = '', tags = [] }) {
  const src = String(source).toLowerCase();
  const tagsLower = (tags || []).map((t) => String(t).toLowerCase());
  const haystack = `${src} ${tagsLower.join(' ')}`;

  if (haystack.includes('cisa')) return 'cisa';
  if (haystack.includes('krebs') || haystack.includes('project zero') ||
      haystack.includes('hacker news') || haystack.includes('snyk')) return 'security';
  if (/\baws\b/.test(haystack) || haystack.includes('amazon bedrock') ||
      haystack.includes('amazon ml')) return 'aws';
  if (haystack.includes('kubernetes') || haystack.includes('cncf') ||
      /\bk8s\b/.test(haystack)) return 'kubernetes';
  if (haystack.includes('openai')) return 'openai';
  if (haystack.includes('anthropic') || haystack.includes('claude')) return 'anthropic';
  if (haystack.includes('github')) return 'github';
  if (haystack.includes('hashicorp') || haystack.includes('terraform')) return 'hashicorp';
  if (haystack.includes('docker')) return 'docker';
  if (haystack.includes('nvidia')) return 'nvidia';
  if (haystack.includes('hugging face') || haystack.includes('huggingface')) return 'huggingface';
  if (haystack.includes('microsoft') || haystack.includes('azure')) return 'microsoft';
  if (haystack.includes('deepmind')) return 'google';
  if (/\bgoogle\b/.test(haystack)) return 'google';
  if (haystack.includes('databricks')) return 'databricks';
  if (haystack.includes('stripe')) return 'stripe';
  if (haystack.includes('cloudflare')) return 'cloudflare';
  if (/\bmeta\b/.test(haystack) || haystack.includes('llama')) return 'meta';
  return null;
}

export function buildImagePrompt(article) {
  const { url, category, tags, source } = article;
  const primary = CATEGORY_VISUALS[category] || CATEGORY_VISUALS.Other;
  const composition = COMPOSITIONS[hashIndex(url, COMPOSITIONS.length)];
  const lighting = LIGHTINGS[hashIndex(url + ':L', LIGHTINGS.length)];
  const flavor = cleanTags(tags);
  const flavorLine = flavor.length
    ? `Subtle motifs (visual only): ${flavor.join(', ')}.`
    : '';
  const brandSlug = detectBrandSlug({ source, tags });
  const colorHint = brandSlug
    ? BRAND_COLOR_HINTS[brandSlug]
    : (CATEGORY_COLOR_HINTS[category] || CATEGORY_COLOR_HINTS.Other);
  return [
    'Editorial tech illustration.',
    `Primary subject: ${primary}.`,
    `Composition: ${composition}.`,
    `Lighting: ${lighting}.`,
    flavorLine,
    `Color palette: ${colorHint} on a deep moody base.`,
    'Style: cinematic, abstract-realistic, moody atmospheric, depth of field, professional editorial quality.',
    'STRICT NEGATIVE: absolutely no text, no letters, no words, no logos, no UI elements, no readable symbols, no labels, no signage, no typography of any kind. The image must contain zero textual elements.',
  ].filter(Boolean).join(' ');
}

export async function generateImage(prompt) {
  const client = getClient();
  const response = await client.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '16:9' },
    },
  });
  const parts = response.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart) {
    throw new Error(`no image in response: ${JSON.stringify(response).slice(0, 400)}`);
  }
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

export async function generateImages(articles, hashByUrl, outDir) {
  if (!articles.length) return articles;
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT) {
    console.warn('[images] no Google Cloud credentials detected (GOOGLE_APPLICATION_CREDENTIALS or ADC); skipping image generation');
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

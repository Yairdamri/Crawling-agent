import { writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { withRetry } from './retry.mjs';

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

// Bounded vocabulary per category. Gemini picks ONE option from the list,
// choosing whichever best fits the article's title. Each special-case option
// has a literal-keyword condition; defaults are unconditional fallbacks.
// The bounded list kills two failure modes the previous prompt had:
// "free invention" (weird funnel objects) and "letters as the subject"
// (rendering OAM/AWS/etc. as the literal letterforms).
const CATEGORY_OPTIONS = {
  AI: [
    'a 3D isometric microchip / processor with metallic pin legs and subtle circuit traces on top (DEFAULT — use this unless the title explicitly contains a keyword for one of the special-case options below)',
    'a 3D isometric microchip with a small heatsink stacked on top (DEFAULT alternative)',
    'a 3D isometric floating microchip with a few small data-point spheres orbiting around it (DEFAULT alternative)',
    'a 3D isometric circuit board with smooth surface-mounted components (DEFAULT alternative)',
    'a 3D isometric magnifying glass (use ONLY IF the title literally contains one of: "search", "indexing", "retrieval", "research", "RAG")',
    'a 3D isometric balance scales (use ONLY IF the title literally contains one of: "evaluation", "evaluat", "judge", "judging", "ranking", "eval")',
    'a 3D isometric gauge / dial (use ONLY IF the title literally contains one of: "benchmark", "performance score", "leaderboard")',
    'a 3D isometric robotic arm (use ONLY IF the title literally contains one of: "agent", "agentic", "automation", "robotic", "robot")',
  ],
  DevOps: [
    'a 3D isometric pair of stacked shipping containers with corrugated metal sides (DEFAULT — use this unless the title explicitly contains a keyword for one of the special-case options below)',
    'a 3D isometric single shipping container with the door slightly open showing smooth modular blocks inside (DEFAULT alternative)',
    'a 3D isometric crane arm gently lifting one shipping container (DEFAULT alternative)',
    'a 3D isometric cluster of small rounded pod shapes (use ONLY IF the title literally contains one of: "pod", "Kubernetes", "K8s", "workload")',
    'a 3D isometric large gear/cog with a smaller wrench resting on top (use ONLY IF the title literally contains one of: "CI", "CD", "pipeline", "IaC", "Terraform", "Pulumi", "GitOps", "Argo", "platform engineering")',
    'a 3D isometric small screen with a smooth pulse/heartbeat line (use ONLY IF the title literally contains one of: "observability", "Datadog", "Honeycomb", "Grafana", "OpenTelemetry", "OTel", "eBPF", "trace", "tracing", "monitor")',
  ],
  Cloud: [
    'a 3D isometric single fluffy cloud (DEFAULT — use this unless the title explicitly contains a keyword for one of the special-case options below)',
    'a 3D isometric small server rack with cloud shapes floating above it (DEFAULT alternative)',
    'a 3D isometric stack of two clouds, one solid and one slightly translucent (DEFAULT alternative)',
    'a 3D isometric storage bucket (use ONLY IF the title literally contains one of: "S3", "bucket", "storage", "data lake", "object store", "blob")',
    'a 3D isometric storage bucket with a small fluffy cloud rising above it (use ONLY IF the title literally contains one of: "S3", "bucket", "storage", "data lake")',
    'a 3D isometric cylindrical database stack (use ONLY IF the title literally contains one of: "database", "DynamoDB", "RDS", "Postgres", "warehouse", "OLAP", "BigQuery", "Snowflake")',
  ],
  Engineering: [
    'a 3D isometric crossed wrench and gear/cog (DEFAULT — use this unless the title explicitly contains a keyword for one of the special-case options below)',
    'a 3D isometric open toolbox with a few tools (wrench, screwdriver, hammer) visibly spilling out (DEFAULT alternative)',
    'a 3D isometric large gear/cog with a smaller wrench resting on top (DEFAULT alternative)',
    'a 3D isometric hammer and screwdriver crossed on a small workbench surface (DEFAULT alternative)',
    'a 3D isometric scroll of blueprint paper (use ONLY IF the title literally contains one of: "architecture", "design", "system design", "blueprint")',
    'a 3D isometric smooth typewriter (use ONLY IF the title literally contains one of: "CLI", "TUI", "terminal", "REPL", "shell", "command-line")',
  ],
  Security: [
    'a 3D isometric padlock with one small warning indicator (triangle, exclamation, or dot) hovering nearby (DEFAULT — use this unless the title explicitly contains a keyword for one of the special-case options below)',
    'a 3D isometric shield with one small warning indicator (DEFAULT alternative)',
    'a 3D isometric padlock and a smooth metallic key together (DEFAULT alternative)',
    'a 3D isometric vault door, slightly ajar, with a smooth handle (DEFAULT alternative)',
    'a 3D isometric small safe / strongbox (DEFAULT alternative)',
    'a 3D isometric magnifying glass (use ONLY IF the title literally contains one of: "forensic", "threat hunting", "investigat", "research", "analysis", "hunt")',
  ],
  Other: [
    'a 3D isometric smooth orb floating above the platform with three small geometric satellite shapes around it (DEFAULT — use this unless the title explicitly contains a keyword for one of the special-case options below)',
    'a 3D isometric satellite dish (use ONLY IF the title literally contains one of: "antenna", "radio", "signal", "broadcast", "5G", "LoRa", "satellite", "wireless")',
    'a 3D isometric radar dish (use ONLY IF the title literally contains one of: "radar", "scan", "detection", "sensor"; AVOID overlap with networking — pick satellite dish for those)',
    'a 3D isometric smooth typewriter (use ONLY IF the title literally contains one of: "CLI", "TUI", "terminal", "REPL", "shell")',
    'a 3D isometric cylindrical database stack (use ONLY IF the title literally contains one of: "database", "warehouse", "RDBMS")',
    'a 3D isometric medal or trophy (use ONLY IF the title literally contains one of: "certification", "certified", "credential", "exam", "award", "kubestronaut")',
  ],
};

// Composition / framing variants. Picked independently of subject by a
// different hash seed, so subject pick and framing pick combine for variety.
const COMPOSITIONS = [
  'centered hero composition, slight 3/4 isometric tilt',
  'asymmetric off-center placement, balanced negative space, 3/4 isometric',
  'low-angle isometric view, looking slightly up at the subject',
  'top-down with subtle isometric perspective, clean layout',
];

function hashIndex(seed, modulo) {
  return createHash('sha256').update(seed).digest().readUInt32BE(0) % modulo;
}

// Single solid background color per brand / fallback per category.
// These are the *full background*, not accents — designer's mockup has
// large flat color fields, not gradients.
const BRAND_BACKGROUND = {
  aws:         'warm amber-orange',
  kubernetes:  'sky blue',
  openai:      'soft mint teal',
  anthropic:   'warm terracotta',
  github:      'soft slate gray',
  hashicorp:   'violet purple',
  docker:      'bright sky blue',
  nvidia:      'fresh mint green',
  huggingface: 'golden yellow',
  microsoft:   'cyan blue',
  google:      'soft royal blue',
  databricks:  'coral red-orange',
  cisa:        'navy blue',
  security:    'soft alert crimson',
  stripe:      'indigo violet',
  cloudflare:  'warm orange',
  meta:        'cobalt blue',
};
const CATEGORY_BACKGROUND = {
  AI:          'soft mint teal',
  DevOps:      'sky blue',
  Cloud:       'pastel teal',
  Engineering: 'soft sand or pale lavender',
  Security:    'soft alert crimson',
  Other:       'pale cream',
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

// Subjects that benefit from situational cartoon cloud accents (designer's
// mockup uses these on cloud / observability / weather concepts).
function shouldHaveCloudAccents(article) {
  const haystack = `${article.title} ${(article.tags || []).join(' ')}`.toLowerCase();
  if (article.category === 'Cloud') return true;
  if (/observabilit|monitor|tracing|metric|telemetr|log|ebpf/.test(haystack)) return true;
  if (/cloud|cdn|edge|s3|bucket/.test(haystack)) return true;
  return false;
}

export function buildImagePrompt(article) {
  const { title, category, url, source, tags } = article;
  const options = CATEGORY_OPTIONS[category] || CATEGORY_OPTIONS.Other;
  const optionsList = options.map((opt, i) => `  ${i + 1}. ${opt}`).join('\n');
  const composition = COMPOSITIONS[hashIndex(url + ':composition', COMPOSITIONS.length)];
  const brandSlug = detectBrandSlug({ source, tags });
  const background = brandSlug
    ? BRAND_BACKGROUND[brandSlug]
    : (CATEGORY_BACKGROUND[category] || CATEGORY_BACKGROUND.Other);
  const cloudAccents = shouldHaveCloudAccents(article)
    ? 'A few small soft cartoon cloud accents float around the subject (only as situational decoration, not the main subject).'
    : '';
  return [
    'CRITICAL CONSTRAINT: this image must contain ZERO text. No letters, no words, no numbers, no symbols, no labels, no signs, no logos, no UI elements, no typography, no hieroglyphs or writing-like marks of any kind. The SUBJECT itself must NEVER be a letter, alphabetical character, word, acronym, or shape resembling typography. Even if the article title contains acronyms, brand names, or initials (like AWS, OpenAI, OAM), render the actual concept they refer to (a chip, a cloud, a container) — never the letters themselves. All visible surfaces must be smooth, matte, and completely unmarked.',
    '',
    `The article being illustrated is titled: "${title}".`,
    '',
    '3D isometric editorial illustration.',
    'Subject selection — follow these rules in order:',
    '  STEP 1: scan the article title for the literal keywords listed in any "use ONLY IF" option below.',
    '  STEP 2: if a keyword matches, use that option.',
    '  STEP 3: if no "use ONLY IF" keyword matches, you MUST use one of the DEFAULT options.',
    '  STEP 4: never combine options. Never invent objects. Pick exactly one option from the list.',
    'Available options:',
    optionsList,
    'Place the chosen subject centered on a small circular platform. All surfaces of the subject must be smooth, matte, and unmarked — no engraved logos, no labels, no embossed text.',
    `Composition: ${composition}.`,
    '',
    `Background: solid vibrant ${background}, completely flat, no gradient, no atmospheric scene, no depth of field, no haze.`,
    cloudAccents,
    'Style: 3D rendered like Spline 3D / Stripe illustrations / Material Design 3D / claymation. Friendly, clean, minimal, even soft lighting from above. Single soft drop shadow under the platform. No glow effects. No god rays. No moody atmosphere. No dramatic lighting. No cinematic depth of field. Bright and inviting.',
    'FINAL REMINDER: subject is exactly ONE option from the numbered list above. Zero text anywhere. No letters as subjects.',
  ].filter(Boolean).join('\n');
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

// Mutates each article in place by setting article.imageFilename on success.
// fetch.mjs passes a `keepers` subarray whose elements share refs with the
// `processed` array sent to mergeAndWrite, so the mutation threads through
// to store.mjs's imageFilename filter. Refactoring this to return new
// objects without updating the caller would silently empty news.json —
// every article would fail the imageFilename filter. Load-bearing contract.
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
      const bytes = await withRetry(
        () => generateImage(prompt),
        `[images] ${article.url}`,
        { shouldRetry: () => true }
      );
      await writeFile(path, bytes);
      article.imageFilename = filename;
      generated++;
    } catch (err) {
      failed++;
      console.warn(`[images] gen failed for ${article.url}: ${err.message}`);
    }
  }

  console.log(`[images] generated: ${generated}, cached: ${cached}, failed: ${failed}`);
  return articles;
}

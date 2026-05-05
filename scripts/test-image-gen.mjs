// Local image-prompt iteration script.
// Imports `generateImage` from images.mjs (the actual Vertex AI call, untouched)
// but overrides `buildImagePrompt` here with a candidate prompt template that
// matches the designer's 3D-isometric + brand-tinted Figma mockup. Output goes
// to data/images-test/ (gitignored). Production images.mjs stays unchanged
// until we promote a prompt that looks right.
//
// Usage:
//   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/blog-agent-key.json
//   node scripts/test-image-gen.mjs            # 2 per category
//   SAMPLES_PER_CATEGORY=1 node scripts/test-image-gen.mjs

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateImage } from './images.mjs';
import { sleep } from './retry.mjs';

// Vertex AI Gemini Flash Image has a 10 IPM (images-per-minute) per-project
// cap. 12s = 5 IPM, comfortably under the cap. Burst-bucket-friendly so
// we don't get 429s when we're near steady-state.
const DELAY_BETWEEN_CALLS_MS = 12000;
// Skip articles whose test image already exists (saves quota when re-running
// after iterating on a single category's prompt).
const SKIP_EXISTING = process.env.SKIP_EXISTING !== '0';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const NEWS_PATH = join(root, 'data', 'news.json');
const OUT_DIR = join(root, 'data', 'images-test');
const PER_CATEGORY = Number(process.env.SAMPLES_PER_CATEGORY) || 2;
// Comma-separated list of categories to skip (saves quota when iterating
// on specific categories). e.g. SKIP_CATEGORIES=Security,Cloud
const SKIP_CATEGORIES = new Set(
  (process.env.SKIP_CATEGORIES || '').split(',').map((s) => s.trim()).filter(Boolean)
);
// Only test a single category. Takes precedence over SKIP_CATEGORIES.
// e.g. ONLY_CATEGORY=Cloud
const ONLY_CATEGORY = (process.env.ONLY_CATEGORY || '').trim();
// Only test articles whose title contains this substring (case-insensitive).
// Takes precedence over ONLY_CATEGORY and SKIP_CATEGORIES.
// e.g. ONLY_TITLE=BYOMesh  or  ONLY_TITLE="LoRa mesh"
const ONLY_TITLE = (process.env.ONLY_TITLE || '').trim().toLowerCase();

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT) {
  console.error(
    'No Google Cloud credentials detected. Either:\n' +
      '  - export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json\n' +
      '  - or run: gcloud auth application-default login'
  );
  process.exit(1);
}

// ---- Candidate prompt template (matches designer's Figma mockup) ----

// Bounded vocabulary per category. Gemini picks ONE option from the list,
// choosing whichever best fits the article's title — that gives article-aware
// variety. But the model can't invent objects outside the list, which kills
// the "weird funnel" / "OAM letters" failure modes.
//
// Each option includes a parenthetical hint about when to prefer it. The
// first item in each list is the safe default if the article doesn't clearly
// suggest one of the special-case picks.
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
// different hash seed, so subject pick and framing pick combine.
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
// These are the *full background*, not accents — the designer's mockup has
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
  const haystack = `${src} ${(tags || []).map((t) => String(t).toLowerCase()).join(' ')}`;
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

// Subjects that benefit from situational cartoon cloud accents (the
// designer's mockup uses these on cloud / observability / weather concepts).
function shouldHaveCloudAccents(article) {
  const haystack = `${article.title} ${(article.tags || []).join(' ')}`.toLowerCase();
  if (article.category === 'Cloud') return true;
  if (/observabilit|monitor|tracing|metric|telemetr|log|ebpf/.test(haystack)) return true;
  if (/cloud|cdn|edge|s3|bucket/.test(haystack)) return true;
  return false;
}

function buildImagePromptCandidate(article) {
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

// ---- Sampling ----

function hashUrl(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function pickSample(articles, perCategory) {
  if (ONLY_TITLE) {
    return articles.filter((a) =>
      String(a.title || '').toLowerCase().includes(ONLY_TITLE)
    );
  }
  const grouped = new Map();
  for (const a of articles) {
    if (ONLY_CATEGORY && a.category !== ONLY_CATEGORY) continue;
    if (!ONLY_CATEGORY && SKIP_CATEGORIES.has(a.category)) continue;
    if (!grouped.has(a.category)) grouped.set(a.category, []);
    grouped.get(a.category).push(a);
  }
  const out = [];
  for (const [, items] of grouped) out.push(...items.slice(0, perCategory));
  return out;
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function main() {
  const news = JSON.parse(await readFile(NEWS_PATH, 'utf8'));
  const sample = pickSample(news.articles || [], PER_CATEGORY);
  await mkdir(OUT_DIR, { recursive: true });

  // Pre-filter against existing files so we know up front how many gens to expect.
  const todo = [];
  for (const article of sample) {
    const filename = `${article.category.toLowerCase()}-${hashUrl(article.url)}.png`;
    const path = join(OUT_DIR, filename);
    if (SKIP_EXISTING && await fileExists(path)) {
      console.log(`[skip-existing] ${filename}`);
      continue;
    }
    todo.push({ article, filename, path });
  }

  const filterDesc = ONLY_TITLE
    ? `title~="${ONLY_TITLE}"`
    : ONLY_CATEGORY
      ? `only=${ONLY_CATEGORY}`
      : `skip=${[...SKIP_CATEGORIES].join(',') || 'none'}`;
  console.log(
    `[poc] candidate prompt | per-category=${PER_CATEGORY} | ${filterDesc} | ` +
    `delay=${DELAY_BETWEEN_CALLS_MS}ms | to-generate=${todo.length} (skipped ${sample.length - todo.length} existing)\n`
  );

  for (let i = 0; i < todo.length; i++) {
    const { article, path } = todo[i];
    if (i > 0) await sleep(DELAY_BETWEEN_CALLS_MS);
    const prompt = buildImagePromptCandidate(article);
    console.log(`---\n[${article.category}] ${article.title}`);
    console.log(`prompt: ${prompt}`);
    try {
      const bytes = await generateImage(prompt);
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

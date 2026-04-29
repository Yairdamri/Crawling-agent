import OpenAI from 'openai';

const MODEL = 'gpt-4o-mini';
const BATCH_SIZE = 8;
const TEMPERATURE = 0.3;

const SYSTEM_PROMPT = `You are a senior tech editor specializing in AI, DevOps, cloud, infrastructure, Kubernetes, containers, and software engineering.

Your job is to process technical news articles and return clean structured JSON.

Focus on practical engineering value. Avoid hype and marketing language. Prefer useful, specific summaries that tell a working engineer what changed and why it matters.

Scoring rubric (1-10):
- 9-10: Major release, breaking change, or genuinely novel work that engineers in this domain need to know about today.
- 7-8: Solid practical update, useful tutorial, or noteworthy launch.
- 5-6: Mildly interesting; worth scanning if relevant to your stack.
- 1-4: Marketing fluff, vendor announcement with no substance, off-topic, or already widely known.

Categories: AI, DevOps, Cloud, Engineering, Other. Pick the single best fit.

Tags: 1-5 short technical tags (e.g. "Kubernetes", "Terraform", "LLM", "observability").`;

const ARTICLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['articles'],
  properties: {
    articles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['url', 'title', 'summary', 'source', 'tags', 'score', 'category', 'publishedAt'],
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          source: { type: 'string' },
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
          score: { type: 'integer', minimum: 1, maximum: 10 },
          category: {
            type: 'string',
            enum: ['AI', 'DevOps', 'Cloud', 'Engineering', 'Other'],
          },
          publishedAt: { type: 'string' },
        },
      },
    },
  },
};

function buildUserMessage(batch) {
  const formatted = batch.map((item, i) => {
    return [
      `### Article ${i + 1}`,
      `URL: ${item.url}`,
      `Title: ${item.title}`,
      `Source: ${item.source}`,
      `Published: ${item.publishedAt}`,
      `Excerpt:`,
      item.rawText || '(no excerpt available)',
    ].join('\n');
  });
  return [
    'Analyze the following articles. For each, return: title, summary (2-3 sentences, practical), url (echo back exactly), source (echo back), tags, score (1-10), category, publishedAt (echo back).',
    'Echo url, source, and publishedAt back exactly as provided. Do not invent fields.',
    '',
    formatted.join('\n\n'),
  ].join('\n');
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function processBatch(client, batch) {
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(batch) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'article_batch',
        strict: true,
        schema: ARTICLE_SCHEMA,
      },
    },
  });

  const content = completion.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty content');
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed.articles)) throw new Error('OpenAI response missing articles[]');
  return parsed.articles;
}

export async function processArticles(items) {
  if (items.length === 0) return [];
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  const client = new OpenAI({ apiKey });

  const batches = chunk(items, BATCH_SIZE);
  const processed = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`[openai] batch ${i + 1}/${batches.length} (${batch.length} articles)`);
    try {
      const out = await processBatch(client, batch);
      processed.push(...out);
    } catch (err) {
      console.warn(`[openai] batch ${i + 1} failed: ${err.message}. Skipping batch.`);
    }
  }
  return processed;
}

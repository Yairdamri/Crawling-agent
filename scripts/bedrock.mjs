import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { withRetry, RETRY_DELAYS_MS } from './retry.mjs';

const REGION = process.env.AWS_REGION || 'us-east-1';
const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const BATCH_SIZE = 8;
const TEMPERATURE = 0.3;
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = `You are a senior tech editor for a feed read by working engineers.
AI is your primary beat: LLMs, agents, foundation models, retrieval, evals, tool use, prompt engineering, AI infrastructure, MLOps. You also cover the adjacent engineering world (DevOps, cloud, Kubernetes, infra, software engineering) but only when an item is substantive and useful, not as filler.

When an item has both an AI angle and a generic-engineering angle, lead with the AI angle and pick category "AI". When an item is purely engineering with no AI relevance, that is fine, it can still appear, but only at score 5+ if genuinely useful.

Categories. Pick the single best fit using these definitions:
- AI: LLMs, agents, foundation models, retrieval, evals, tool use, prompt engineering, training/inference infrastructure, MLOps, fine-tuning, AI safety. AI overrides all other categories: if the article has a real AI angle, it is AI even when adjacent topics also apply.
- DevOps: Kubernetes, Docker, container orchestration, CI/CD, GitOps, Terraform, Pulumi, Helm, Argo, service mesh, observability tooling (Prometheus, Grafana, OpenTelemetry), platform engineering. Anything about how software is built, shipped, and run.
- Cloud: Cloud-provider product news and deep-dives (AWS Lambda/S3/RDS/EC2, Azure Functions, GCP Cloud Run/BigQuery), serverless platforms, managed databases on a cloud, cloud cost and architecture topics that are not tied to a specific DevOps tool.
- Engineering: Programming languages, frameworks, libraries, software architecture, testing, debugging, performance, application-layer concerns, web frameworks, databases when not tied to a cloud provider.
- Security: CVEs, vulnerability research, breach reports, threat intelligence, ransomware, supply-chain attacks, security tooling (SAST/DAST/SBOM), container and cluster security advisories. Use Security when the article is primarily about a security incident, advisory, or research finding. If a release happens to include a security fix among many features, that is still its primary category (DevOps/Cloud/etc.) with tag "security".
- Other: Hardware, business and industry news, broad tech that does not fit the above.

Disambiguation:
- Kubernetes anything (without a primary AI angle) -> DevOps, not Cloud.
- A specific AWS/Azure/GCP service news -> Cloud.
- Terraform/Pulumi/Helm/Argo/CI tools -> DevOps.
- A programming-language release or framework feature -> Engineering.
- AI angle anywhere -> AI overrides everything except a primary security incident.
- A primary security incident or CVE -> Security overrides everything except a primary AI angle.

Voice:
- Technical depth. Readers know what an embedding, a CRD, a token, a sidecar is. Do not define basics.
- Concrete over abstract. Every summary must mention at least one specific detail: a feature name, a benchmark number, an architecture choice, a version, an API. Generic "this article discusses X" is failure.
- No hype. Banned words and phrases: "revolutionary", "unleash", "supercharge", "game-changing", "next-generation", "cutting-edge", "AI-powered" (when meaningless), "leverage" (as a verb).
- Punctuation: do NOT use em dashes (—) or en dashes (–). Regular hyphens (-) are fine and expected in normal usage like "tool-use", "open-source", "v1.36.0-beta". When you would naturally reach for an em dash to set off a clause, use a comma, period, parenthesis, or colon instead. This applies to every text field you produce.
- Editorial, not promotional. If an article reads like a press release, score it accordingly (1-4) and flatly summarize what was actually announced.

Scoring rubric (1-10):
- 9-10: Major release, breaking change, or genuinely novel work that engineers in this domain need to know about today.
- 7-8: Solid practical update, useful tutorial, or noteworthy launch.
- 5-6: Mildly interesting; worth scanning if relevant to your stack.
- 1-4: Marketing fluff, vendor announcement with no substance, off-topic, or already widely known.

Tags: 1-5 short technical tags (e.g. "LLM", "agents", "RAG", "evals", "Kubernetes", "Terraform", "observability", "security", "CVE"). Lowercase except proper nouns. Tags should help a reader filter by topic, not describe sentiment.

relevant_for: 4-6 concrete tools, products, or stack components a working engineer would recognize as theirs. This is distinct from tags. Tags name a topic ("CVE", "supply-chain", "evals"); relevant_for names a thing that lives in someone's stack ("Gemini CLI", "GitHub Actions", "Lambda", "Postgres", "kubectl"). A reader scans this row to decide "is this my stack?" in seconds.
- Use the exact product/tool spelling readers see in their dashboards or docs (e.g. "GitHub Actions" not "github-actions"; "@google/gemini-cli" not "gemini cli npm package").
- Vocabulary must not overlap with tags. If "npm" is a tag, do not also list it in relevant_for unless it is the literal package ecosystem the article targets.
- No verbs, no abstract nouns, no marketing labels. "Observability platforms" is not a tool; "Grafana" or "Datadog" is.
- If the article is purely conceptual with no specific tool surface (rare), emit the closest 4 generic stack components that the topic actually touches (e.g. an article on agent eval methodology -> ["LLM agents", "evaluation harnesses", "production traces", "LLM-as-Judge"]).
Example for "Google Fixes CVSS 10 RCE in Gemini CLI":
  ["Gemini CLI", "Cursor", "GitHub Actions", "CI runners", "npm", "@google/gemini-cli"]

why_it_matters: exactly 3 items, each {lead, detail}, telling a working engineer in 2 seconds why this article is worth opening.
- lead: the punchline. 1-4 words. Concrete: CVE id, severity, version, breaking-change keyword, key impact. This is rendered bold.
- detail: the context that earns the lead. 4-10 words. Concrete and specific. Do not repeat the lead's words.
- Both fields obey the voice rules above (no banned words, no restating the title).
Example for "Google Fixes CVSS 10 RCE in Gemini CLI":
  [
    {"lead": "CVSS 10", "detail": "easy remote root via crafted config injection"},
    {"lead": "Hits CI runners", "detail": "using @google/gemini-cli or run-gemini-cli action"},
    {"lead": "Update before next pipeline run", "detail": "npm patch already shipped"}
  ]

You MUST call the record_articles tool exactly once with one entry per input article. Echo the url back exactly as provided so each response can be matched to its input.`;

const TOOL_SCHEMA = {
  type: 'object',
  required: ['articles'],
  properties: {
    articles: {
      type: 'array',
      items: {
        type: 'object',
        required: ['url', 'title', 'summary', 'tags', 'score', 'category', 'why_it_matters', 'relevant_for'],
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          score: { type: 'integer', minimum: 1, maximum: 10 },
          category: {
            type: 'string',
            enum: ['AI', 'DevOps', 'Cloud', 'Engineering', 'Security', 'Other'],
          },
          why_it_matters: {
            type: 'array',
            items: {
              type: 'object',
              required: ['lead', 'detail'],
              properties: {
                lead: { type: 'string' },
                detail: { type: 'string' },
              },
            },
            minItems: 3,
            maxItems: 3,
          },
          relevant_for: {
            type: 'array',
            items: { type: 'string' },
            minItems: 4,
            maxItems: 6,
          },
        },
      },
    },
  },
};

const TOOL_CONFIG = {
  tools: [
    {
      toolSpec: {
        name: 'record_articles',
        description: 'Record processed news articles with summary, score, category, and tags.',
        inputSchema: { json: TOOL_SCHEMA },
      },
    },
  ],
  toolChoice: { tool: { name: 'record_articles' } },
};

function buildUserMessage(batch) {
  const formatted = batch.map((item, i) => {
    return [
      `### Article ${i + 1}`,
      `URL: ${item.url}`,
      `Title: ${item.title}`,
      `Source: ${item.source}`,
      `Excerpt:`,
      item.rawText || '(no excerpt available)',
    ].join('\n');
  });
  return [
    'Analyze the following articles. For each, return: url (echo back exactly so we can match), title, summary (2-3 sentences, practical), tags, score (1-10), category, why_it_matters (exactly 3 items, each {lead, detail}: 1-4 word punchline plus 4-10 word context), relevant_for (4-6 specific tool/product/stack names a reader would recognize as theirs, distinct vocabulary from tags).',
    '',
    formatted.join('\n\n'),
  ].join('\n');
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const CONCURRENCY = 5;

async function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      try {
        results[i] = { ok: true, value: await tasks[i]() };
      } catch (err) {
        results[i] = { ok: false, error: err };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function extractToolUse(response) {
  const content = response.output?.message?.content || [];
  for (const block of content) {
    if (block.toolUse?.name === 'record_articles') {
      return block.toolUse.input;
    }
  }
  throw new Error('Bedrock response did not include record_articles tool use');
}

async function processBatch(client, batch) {
  const command = new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [
      {
        role: 'user',
        content: [{ text: buildUserMessage(batch) }],
      },
    ],
    inferenceConfig: {
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
    },
    toolConfig: TOOL_CONFIG,
  });

  const response = await client.send(command);
  const parsed = extractToolUse(response);
  if (!parsed || !Array.isArray(parsed.articles)) {
    throw new Error('Bedrock tool input missing articles[]');
  }
  return mergeDeterministicFields(parsed.articles, batch);
}

function mergeDeterministicFields(parsedArticles, batch) {
  const byUrl = new Map(batch.map((item) => [item.url, item]));
  const out = [];
  for (const a of parsedArticles) {
    const input = byUrl.get(a.url);
    if (!input) {
      console.warn(`[bedrock] returned URL not in batch, skipping: ${a.url}`);
      continue;
    }
    out.push({
      ...a,
      source: input.source,
      sourceDomain: input.sourceDomain || '',
      publishedAt: input.publishedAt,
    });
  }
  return out;
}

export async function processArticles(items) {
  if (items.length === 0) return [];
  const client = new BedrockRuntimeClient({ region: REGION });

  const batches = chunk(items, BATCH_SIZE);
  console.log(
    `[bedrock] ${batches.length} batches, concurrency=${CONCURRENCY}, retries=${RETRY_DELAYS_MS.length}`
  );

  const tasks = batches.map((batch, i) => async () => {
    const label = `batch ${i + 1}/${batches.length} (${batch.length} articles)`;
    console.log(`[bedrock] ${label} starting`);
    const out = await withRetry(() => processBatch(client, batch), `[bedrock] ${label}`);
    console.log(`[bedrock] ${label} done (${out.length} articles)`);
    return out;
  });

  const results = await runWithConcurrency(tasks, CONCURRENCY);

  const processed = [];
  let failedCount = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.ok) {
      processed.push(...r.value);
    } else {
      failedCount++;
      console.warn(`[bedrock] batch ${i + 1} failed after retries: ${r.error?.message}`);
    }
  }
  if (failedCount > 0) {
    console.warn(`[bedrock] ${failedCount}/${batches.length} batches failed after retries`);
  }
  return processed;
}

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

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

You MUST call the record_articles tool exactly once with one entry per input article. Echo url, source, and publishedAt back exactly as provided.`;

const TOOL_SCHEMA = {
  type: 'object',
  required: ['articles'],
  properties: {
    articles: {
      type: 'array',
      items: {
        type: 'object',
        required: ['url', 'title', 'summary', 'source', 'tags', 'score', 'category', 'publishedAt'],
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          source: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          score: { type: 'integer', minimum: 1, maximum: 10 },
          category: {
            type: 'string',
            enum: ['AI', 'DevOps', 'Cloud', 'Engineering', 'Security', 'Other'],
          },
          publishedAt: { type: 'string' },
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
  return parsed.articles;
}

export async function processArticles(items) {
  if (items.length === 0) return [];
  const client = new BedrockRuntimeClient({ region: REGION });

  const batches = chunk(items, BATCH_SIZE);
  const processed = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`[bedrock] batch ${i + 1}/${batches.length} (${batch.length} articles)`);
    try {
      const out = await processBatch(client, batch);
      processed.push(...out);
    } catch (err) {
      console.warn(`[bedrock] batch ${i + 1} failed: ${err.message}. Skipping batch.`);
    }
  }
  return processed;
}

# AI News Pipeline

Automated AI / DevOps / cloud / security news feed. GitHub Actions runs daily, fetches RSS, has **Claude Haiku 4.5 on AWS Bedrock** summarize / tag / score each article, generates a cover image per article via **Gemini 2.5 Flash Image**, commits everything to `data/news.json` + `data/images/`. A WordPress plugin renders the JSON on a WP site via `[ai_news_feed]` (simple grid) or `[ai_news_feed_page]` (full magazine layout).

## Architecture

Visual: [docs/architecture.excalidraw](docs/architecture.excalidraw) — open in [Excalidraw](https://excalidraw.com/) (drag-and-drop), or in VS Code via the [Excalidraw editor extension](https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor).

```
GitHub Actions (cron daily, 00:00 UTC)
    -> scripts/fetch.mjs
        -> rss-parser (config/feeds.json)
        -> dedupe via data/seen_urls.json (URL + content hash)
        -> Bedrock Claude Haiku 4.5 (Converse API, batched, tool-use structured output)
        -> Gemini 2.5 Flash Image (cover image per article, brand-tinted style)
        -> data/news.json + data/images/<hash>.png (committed back to repo)

WordPress (managed host)
    -> ai-news-feed plugin
        -> shortcode [ai_news_feed] or [ai_news_feed_page]
        -> wp_remote_get(<raw GitHub URL>) with 1h transient cache
        -> renders article cards (with images, brand-tinted placeholders, IMPACT badges)
```

Auth from Actions to AWS uses **GitHub OIDC** — no static AWS keys stored anywhere. Auth to Google Cloud (Vertex AI for Gemini) uses a **GCP service account key** in repo secrets, loaded via `google-github-actions/auth@v2`.

## Repository layout

```
.github/workflows/fetch-news.yml   Cron + commit pipeline
config/feeds.json                  RSS sources (currently 20)
scripts/
  fetch.mjs                        Pipeline entrypoint
  feeds.mjs                        RSS fetch + normalize + URL normalization + content hash
  dedupe.mjs                       Filter against seen_urls (URL + content hash)
  bedrock.mjs                      Bedrock Converse + tool-use schema
  images.mjs                       Gemini cover image generation (in-pipeline)
  store.mjs                        Merge, retention, write
  backfill-images.mjs              Batch-generate images for older articles
  import-gemini-images.mjs         Import manually-generated Gemini Pro images
  list-missing-prompts.mjs         Audit which articles still need images
  sync-image-filenames.mjs         Reconcile filename hashes
  test-image-gen.mjs               Iterate on image prompts locally
data/
  news.json                        Public output (read by WP)
  seen_urls.json                   Dedup cache (URL -> {seenAt, contentHash})
  images/<hash>.png                Generated cover images (tracked in git)
wordpress-plugin/ai-news-feed/     PHP plugin: 2 shortcodes, image rendering, brand tints
docs/architecture.excalidraw       Architecture diagram
.claude/skills/
  develeap-news-imagery/           Image style + brand-color reference
  backman/                         Develeap product backlog tool integration
CLAUDE.md                          Codebase docs for Claude Code
```

## Local development

```bash
npm install
aws sso login --profile <your-profile>                    # any session that can call bedrock:InvokeModel
gcloud auth application-default login                     # OR: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json
AWS_REGION=us-east-1 GCP_PROJECT=crawling-agent GCP_LOCATION=us-central1 node scripts/fetch.mjs
```

Inspect `data/news.json` and `data/images/` afterwards. A second run is near-instant — `seen_urls.json` (now keyed by URL + content hash) shortcuts already-processed URLs.

If image generation fails locally with `permission denied`, check that your account has `roles/aiplatform.user` on the GCP project. The pipeline still completes without images — they're optional, the WP plugin falls back to brand-tinted placeholders.

## Deployment

1. **AWS one-time setup:**
   - Create OIDC identity provider for `https://token.actions.githubusercontent.com` (audience `sts.amazonaws.com`).
   - Create IAM role with trust policy scoped to `repo:<owner>/<repo>:ref:refs/heads/main`.
   - Attach inline policy allowing `bedrock:InvokeModel` on the Haiku 4.5 inference profile + underlying foundation models.
2. **GCP one-time setup (for Vertex AI image generation):**
   - Create a GCP project (or reuse one).
   - Enable the **Vertex AI API** in that project.
   - Create a service account with role `roles/aiplatform.user`.
   - Generate a JSON key for the service account; **do not commit it**.
3. **GitHub one-time setup:**
   - Push this repo (public, so the raw JSON URL is reachable).
   - **Settings → Secrets and variables → Actions → Variables:** set
     - `AWS_ROLE_ARN` → your IAM role ARN
     - `AWS_REGION` → e.g. `us-east-1`
     - `GCP_PROJECT` → your GCP project ID
     - `GCP_LOCATION` → e.g. `us-central1`
   - **Settings → Secrets and variables → Actions → Secrets:** set
     - `GCP_SA_KEY` → the entire JSON contents of the service account key file
4. **Run the workflow:** Actions tab → Fetch News → Run workflow. First run seeds `data/news.json`.
5. **WordPress:** Zip `wordpress-plugin/ai-news-feed/` and upload via wp-admin → Plugins → Add New → Upload Plugin → Activate.
6. In WP, **Settings → AI News Feed**, paste your raw JSON URL:
   `https://raw.githubusercontent.com/<owner>/<repo>/main/data/news.json`
7. Create a WP page with the shortcode `[ai_news_feed]`.

## Configuration

- [config/feeds.json](config/feeds.json) — list of RSS sources. Edit freely, no code changes needed.
- [scripts/bedrock.mjs](scripts/bedrock.mjs) — system prompt, model ID, batch size, concurrency cap, retry delays. Tweak the prompt to change editorial voice / categories / tags.
- [scripts/images.mjs](scripts/images.mjs) — Gemini image model, per-category visual style, composition variants. Auths via Vertex AI by default; project + location are env-driven (`GCP_PROJECT`, `GCP_LOCATION`).
- [.github/workflows/fetch-news.yml](.github/workflows/fetch-news.yml) — cron schedule (currently `0 0 * * *`, daily at 00:00 UTC). Region/project/location all sourced from GitHub Actions Variables (`vars.AWS_REGION`, `vars.GCP_PROJECT`, `vars.GCP_LOCATION`).

### Article ordering

Articles in [data/news.json](data/news.json) are sorted by `publishedAt` descending — newest first. Score is used only as a tie-breaker. (The original MVP sorted by score; flipped after readers wanted "what's new today" up top.)

## Shortcode options

The plugin ships two shortcodes.

### `[ai_news_feed]` — simple grid

The original layout: a single responsive grid of cards. Use this when you want to drop the feed into an existing page that already has its own surrounding chrome.

```
[ai_news_feed]                              full feed
[ai_news_feed limit="10"]                   first 10
[ai_news_feed category="AI"]                filter by category
[ai_news_feed limit="5" category="Security"] both
```

### `[ai_news_feed_page]` — full magazine layout

The Develeap-styled news page: site header (logo + nav + "Get Your Expert" CTA), hero, 2×2 featured grid, "Top Stories" rail, search + sort + category-filter pills, and the main 3-column card grid with image thumbnails, IMPACT score badges, source-brand-tinted placeholders, and `#tag` chips. Includes a small client-side script for filter / search / sort with no page reloads.

```
[ai_news_feed_page]                         everything: header + hero + featured + top + grid
[ai_news_feed_page limit="30"]              cap the main grid at 30 cards
[ai_news_feed_page featured="6" top="8"]    larger spotlight section
[ai_news_feed_page limit="60" featured="4" top="5"]  defaults shown explicitly
```

Attributes:
- `limit` — max number of cards in the main grid. Default `60`.
- `featured` — articles in the 2×2 spotlight (top by score, ties broken by date desc). Default `4`.
- `top` — articles in the right-rail "Top Stories" list (next-best by score after featured). Default `5`.

Categories: `AI`, `DevOps`, `Cloud`, `Engineering`, `Security`, `Other`.

Source-brand tints (used for image placeholders before / when the AI-generated thumbnail isn't present): AWS, Kubernetes/CNCF, OpenAI, Anthropic, GitHub, HashiCorp, Docker, NVIDIA, Hugging Face, Microsoft/Azure, Google/DeepMind, Databricks, Snyk, CISA, Stripe, Cloudflare, Meta, plus a `security` fallback for Krebs / Hacker News / Project Zero. Defined in [wordpress-plugin/ai-news-feed/style.css](wordpress-plugin/ai-news-feed/style.css), keyed off the source name via `ainfp_source_slug()` in [ai-news-feed.php](wordpress-plugin/ai-news-feed/ai-news-feed.php). Colors come from the [develeap-news-imagery skill](.claude/skills/develeap-news-imagery/references/brand-colors.md).

## Costs

At current load (20 feeds, daily cron, dedup cache warm, ~12 articles/day going live):

- **Bedrock Haiku 4.5:** ~$0.10–0.15 per run × 1/day ≈ **$3–4/month** (was $10 estimate when running every 6h)
- **Gemini 2.5 Flash Image:** ~$0.04 per image × ~30 new articles/day = **~$1.20/day, ~$36/month** at full image generation. Lower in practice because the dedup cache means most cron runs touch fewer than 30 new articles.
- **GitHub Actions minutes:** free tier covers this comfortably (~10 min × 1/day = ~300 min/month, well under the 2,000 free).
- **One-time backlog spikes** (feed list expansion, prompt rewrite forcing reprocess): ~$1 each, infrequent.

Total steady state: **~$40/month** if image generation is enabled for every article. Halve that by only generating images for top-scoring items.

## Operations

**Force re-categorization** (e.g., after editing the system prompt and you want existing entries re-processed under new rules): reset `data/seen_urls.json` to `[]`, push, trigger workflow. Pipeline re-fetches everything and merge-by-URL overwrites old entries. ~$1 one-time including image regeneration.

**Edit a publisher article** (publisher updates the original post): the content-hash dedupe in [scripts/dedupe.mjs](scripts/dedupe.mjs) detects the change automatically — same URL with different `contentHash` triggers reprocessing on the next run. No manual action required.

**Add or remove a feed:** edit `config/feeds.json`, push. No code changes.

**Change the LLM** (e.g., Haiku → Sonnet for better summaries): update `MODEL_ID` in [scripts/bedrock.mjs](scripts/bedrock.mjs) and add the new model ARN to the IAM role's inline policy. Two lines.

**Change the image model**: update `GEMINI_IMAGE_MODEL` env var in the workflow. Default is `gemini-2.5-flash-image`.

**Manually backfill an image** (fix a bad auto-generated one): generate via `gemini.google.com`, save into `data/images-test/` (gitignored), then run `node scripts/import-gemini-images.mjs <article-url> <local-image-path>` to copy it into `data/images/<hash>.png` and update `news.json`.

**Audit missing images:** `node scripts/list-missing-prompts.mjs` lists articles without an `imageFilename`.

## Roadmap

Post-MVP roadmap and architecture migration plan live at `~/.claude/plans/ok-great-lets-continue-graceful-penguin.md` (outside the repo). Read it before designing changes that touch dedupe, categorization, or storage — captures decisions from prior conversations. Live tickets are tracked in [Backman](https://$BACKMAN_BASE_URL).

**Done:**
- Content-hash dedupe (re-process publisher edits)
- URL normalization (strip `utm_*`, trailing slashes, etc.)
- Image generation pipeline (Gemini via Vertex AI)
- Parallel Bedrock batches with retry + backoff (~75% latency drop)

**Still on the list:**
- Handle Gemini image generation failures (retry + classify + don't re-pay for permanent refusals)
- Cross-source duplicate detection (HN → TheNewStack → AWS triplets become one)
- Per-feed metrics (`data/metrics.json`)
- Deterministic categorization (move "Kubernetes → DevOps" rules out of the prompt into code)
- Phased AWS migration (S3 + DynamoDB + Lambda fanout) for post-MVP scaling

# AI News Pipeline

Automated AI / DevOps / cloud / security news feed. GitHub Actions runs every 6 hours, fetches RSS, has **Claude Haiku 4.5 on AWS Bedrock** summarize / tag / score each article, commits the result to `data/news.json`. A small WordPress plugin renders the JSON on a WP site via a `[ai_news_feed]` shortcode.

## Architecture

Visual: [docs/architecture.excalidraw](docs/architecture.excalidraw) — open in [Excalidraw](https://excalidraw.com/) (drag-and-drop), or in VS Code via the [Excalidraw editor extension](https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor).

```
GitHub Actions (cron 6h)
    -> scripts/fetch.mjs
        -> rss-parser (config/feeds.json)
        -> dedupe via data/seen_urls.json
        -> Bedrock Claude Haiku 4.5 (Converse API, batched, tool-use structured output)
        -> data/news.json (committed back to repo)

WordPress (managed host)
    -> ai-news-feed plugin
        -> shortcode [ai_news_feed]
        -> wp_remote_get(<raw GitHub URL>) with 1h transient cache
        -> renders article cards
```

Auth from Actions to AWS uses **GitHub OIDC** — no static AWS keys stored anywhere.

## Repository layout

```
.github/workflows/fetch-news.yml   Cron + commit pipeline
config/feeds.json                  RSS sources (currently 20)
scripts/
  fetch.mjs                        Pipeline entrypoint
  feeds.mjs                        RSS fetch + normalize, isolated per feed
  dedupe.mjs                       Filter against seen_urls
  bedrock.mjs                      Bedrock Converse + tool-use schema
  store.mjs                        Merge, retention, write
data/
  news.json                        Public output (read by WP)
  seen_urls.json                   Dedup cache
wordpress-plugin/ai-news-feed/     PHP plugin (shortcode + admin settings)
docs/architecture.excalidraw       Architecture diagram
```

## Local development

```bash
npm install
aws sso login --profile <your-profile>      # any session that can call bedrock:InvokeModel
AWS_REGION=us-east-1 node scripts/fetch.mjs
```

Inspect `data/news.json` afterwards. A second run should be near-instant — `seen_urls.json` shortcuts already-processed URLs.

## Deployment

1. **AWS one-time setup:**
   - Create OIDC identity provider for `https://token.actions.githubusercontent.com` (audience `sts.amazonaws.com`).
   - Create IAM role with trust policy scoped to `repo:<owner>/<repo>:ref:refs/heads/main`.
   - Attach inline policy allowing `bedrock:InvokeModel` on the Haiku 4.5 inference profile + underlying foundation models.
2. **GitHub one-time setup:**
   - Push this repo (public, so the raw JSON URL is reachable).
   - In repo **Settings → Secrets and variables → Actions → Variables**, set `AWS_ROLE_ARN` to your role ARN.
3. **Run the workflow:** Actions tab → Fetch News → Run workflow. First run seeds `data/news.json`.
4. **WordPress:** Zip `wordpress-plugin/ai-news-feed/` and upload via wp-admin → Plugins → Add New → Upload Plugin → Activate.
5. In WP, **Settings → AI News Feed**, paste your raw JSON URL:
   `https://raw.githubusercontent.com/<owner>/<repo>/main/data/news.json`
6. Create a WP page with the shortcode `[ai_news_feed]`.

## Configuration

- [config/feeds.json](config/feeds.json) — list of RSS sources. Edit freely, no code changes needed.
- [scripts/bedrock.mjs](scripts/bedrock.mjs) — system prompt, model ID, batch size. Tweak the prompt to change editorial voice / categories / tags.
- [.github/workflows/fetch-news.yml](.github/workflows/fetch-news.yml) — cron schedule, region.

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

Bedrock Haiku 4.5 at the current load (20 feeds, 6h cron, dedup cache warm):

- First run after a feed-list expansion: ~$0.70 (one-time, processes all backlog)
- Steady state: ~$0.08 per run × 4/day = **~$10/month**
- GitHub Actions minutes: free tier covers this (~6 min × 4/day = under 1k min/month).

## Operations

**Force re-categorization** (e.g., after editing the system prompt and you want existing entries re-processed under new rules): reset `data/seen_urls.json` to `[]`, push, trigger workflow. Pipeline re-fetches everything and merge-by-URL overwrites old entries. ~$0.70 one-time.

**Add or remove a feed:** edit `config/feeds.json`, push. No code changes.

**Change the model** (e.g., Haiku → Sonnet for better summaries): update `MODEL_ID` in [scripts/bedrock.mjs](scripts/bedrock.mjs) and add the new model ARN to the IAM role's inline policy. Two lines.

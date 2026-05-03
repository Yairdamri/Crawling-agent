# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common commands

```bash
npm install                                    # one-time install
AWS_REGION=us-east-1 node scripts/fetch.mjs    # run the full pipeline locally
npm run fetch                                  # same thing, via package.json
node --check scripts/<file>.mjs                # syntax check a single script
```

There is no test suite, no linter, no build step. The pipeline is a Node 20 ES-module script. AWS credentials must be available in the shell (typically `aws sso login --profile <p>`) for Bedrock calls.

## Architecture (the parts that span multiple files)

### Pipeline stages — single file orchestrates four

[scripts/fetch.mjs](scripts/fetch.mjs) is the entrypoint and orchestrator. It chains four stages, each in its own module:

1. **Fetch** ([scripts/feeds.mjs](scripts/feeds.mjs)) — `fetchAllFeeds(feeds)` parses each RSS feed in parallel via `rss-parser`, normalizes items, attaches a `contentHash` (sha256 of `title + rawText`, 16 hex chars), and **normalizes URLs** (strips tracking params like `utm_*`/`fbclid`, drops `www.`/fragment/trailing slash, sorts query params).
2. **Dedupe** ([scripts/dedupe.mjs](scripts/dedupe.mjs)) — `loadSeenUrls()` builds a `Map<url, {seenAt, contentHash}>` from `data/seen_urls.json`. `filterUnseen()` skips items only when **both** the URL matches **and** the contentHash matches. URL-match-but-different-hash means the article was edited by the publisher → reprocess.
3. **Process** ([scripts/bedrock.mjs](scripts/bedrock.mjs)) — `processArticles(items)` batches into groups of 8 and calls Bedrock Converse with `toolChoice` forced to a `record_articles` tool. Tool-use is the structured-output mechanism — never parse free-form JSON from the model. Returns articles with `summary`, `score` (1-10), `category`, and `tags`. The system prompt is the editorial brain: voice rules, banned words (no em dashes, no marketing speak), category disambiguation rules, scoring rubric.
4. **Store** ([scripts/store.mjs](scripts/store.mjs)) — `mergeAndWrite()` merges newly processed articles into existing `news.json` keyed by URL (new entries overwrite old), filters by `score >= 5`, applies retention windows (articles 30d, seen-cache 60d), sorts by score desc → publishedAt desc, writes both files.

### Dedupe is dual-keyed (URL + content hash)

This is the single most important invariant to preserve. Existing seen-cache entries lacking `contentHash` are intentionally treated as falsy — so they get reprocessed once, picking up a hash, then stabilize. Any change to dedupe semantics must keep this lazy-migration property or the cache breaks for everyone running on old data.

### Why the merge in store.mjs is by URL

Reprocessed articles naturally overwrite their old entries because `byUrl.set(a.url, a)` runs after the existing-articles loop. This is what makes "edit a post → re-summarize on next run" work end-to-end without a separate update path. Don't introduce content-keyed merging without understanding this.

### Retention asymmetry (articles 30d, seen-cache 60d)

Articles fall out of `news.json` after 30 days. The seen-cache holds URLs for 60 days. So there's a 30-day window where an article is invisible to consumers but still blocked from reappearing. This is intentional — prevents old articles from re-entering the feed if they show up in RSS again — but it means resetting `seen_urls.json` is the only way to force-reprocess existing articles under a new prompt.

### Output schema is a public contract

[data/news.json](data/news.json) is consumed by [wordpress-plugin/ai-news-feed/](wordpress-plugin/ai-news-feed/) via `wp_remote_get(<raw GitHub URL>)`. Field renames or removals break live WordPress sites without warning. The plugin checks `schemaVersion === 1` ([ai-news-feed.php](wordpress-plugin/ai-news-feed/ai-news-feed.php)) — bump it on incompatible changes.

### Pipeline must be idempotent

The GitHub Actions workflow runs every 6h and commits changes. A re-run on the same data must produce identical output. Anything random or time-dependent that ends up in `news.json` will create churn commits. The `generatedAt` timestamp at the top is the only intentional time-dependent field.

### Bedrock auth via OIDC, not static keys

[.github/workflows/fetch-news.yml](.github/workflows/fetch-news.yml) assumes a role via `aws-actions/configure-aws-credentials` using GitHub's OIDC token (`vars.AWS_ROLE_ARN`). No AWS access keys exist anywhere. If a feature needs new AWS permissions, the IAM role's inline policy must be updated out-of-band — there's no Terraform here.

### Concurrency in the workflow

`concurrency: { group: fetch-news, cancel-in-progress: false }` — overlapping runs queue, never run in parallel. This protects `seen_urls.json` from write races since git is the state store.

## Working in this repo

- **Edit `config/feeds.json` to add/remove feeds** — no code change needed; `scripts/fetch.mjs` reads it dynamically.
- **Tweak the editorial voice via `SYSTEM_PROMPT` in [scripts/bedrock.mjs](scripts/bedrock.mjs)** — this is where category rules, scoring rubric, and banned words live. Resetting `data/seen_urls.json` to `[]` and re-running forces all extant articles to reprocess under the new prompt (~$0.70 one-time).
- **Avoid running the pipeline against a stale `data/seen_urls.json`** during local debugging — you may end up reprocessing everything by accident. Fastest dev loop: short-circuit `fetchAllFeeds` to return a hardcoded test array.
- **Don't commit `data/news.json` from local runs.** The workflow is the only intended writer; local diffs there will trip the action's commit step on next run.

## Roadmap context

A planned-work document lives at `~/.claude/plans/ok-great-lets-continue-graceful-penguin.md` (outside the repo) covering: URL normalization (done), deterministic categorization, parallel Bedrock with retry, per-feed metrics output, cross-source duplicate clustering, and a phased AWS migration (S3 + DynamoDB + Lambda fanout) for post-MVP scaling. Read it before designing changes that touch the dedupe, categorization, or storage layers — it captures decisions made in prior conversations.

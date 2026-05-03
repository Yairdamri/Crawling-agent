# Integration with the Crawling-agent pipeline

Read once, when first wiring the skill into the Develeap news flow. The hard rules below protect the Crawling-agent invariants documented in its `CLAUDE.md`. Break any of them and you will silently corrupt the dedupe cache, the schema contract, or the idempotency guarantee.

## Where the skill sits

```
RSS feeds  →  scripts/feeds.mjs   (fetch + normalize)
           →  scripts/dedupe.mjs  (URL + contentHash dual-key)
           →  scripts/bedrock.mjs (summary, score, category, tags)
           →  scripts/store.mjs   (merge by URL into data/news.json)
                       │
                       ▼
              data/news.json  ← consumed by:
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
       this skill   WordPress  Figma / etc
       (imagery)    plugin
```

The skill is **downstream** of `data/news.json`, never upstream. It reads articles and produces image files + a decision manifest. The dev (Yair) decides if/when to fold an `image` field back into the schema and bump `schemaVersion`.

## The article record we read

From `data/news.json` → `articles[]`. Schema version 1. Fields the skill uses:

| Field | Type | Use |
|---|---|---|
| `url` | string | Primary key. Drives the filename `sha256(url)[:16].jpg`. |
| `title` | string | Subject-sentence input + alt text. |
| `summary` | string | Subject-sentence input. |
| `source` | string | Attribution context only. |
| `category` | enum | `AI / DevOps / Cloud / Engineering / Security / Other` — drives category-fallback color. |
| `tags` | string[] | Subject-sentence flavor + Tier 1-3 source hints. |
| `score` | 1..10 | Not used by the skill. |
| `publishedAt` | ISO 8601 | Not used by the skill. |

Already present in newer pipeline runs (do not depend on it being there for older entries):

| Field | Type | Use |
|---|---|---|
| `imageFilename` | string | If set, the Crawling-agent already wrote an image at `data/images/<filename>`. The skill should treat the article as already-imaged unless asked to re-decide. |

## The filename convention

`sha256(article.url)[:16].jpg` (16 hex chars + `.jpg`). This matches the existing PoC at `scripts/test-image-gen.mjs` (which writes `.png` — we standardize on `.jpg` because Pollinations returns JPEG and the file slot in WordPress doesn't care).

The script in this skill emits **exactly this filename** when given an article record with a `url` field. Don't override it. Filename collisions across surfaces are how the WordPress plugin and Figma stay in sync without a database lookup.

## Output directory

Default: `data/images/` relative to the consumer repo's root. The script does not assume; the consumer points it via `--out-dir`. From the Crawling-agent repo:

```bash
python .claude/skills/develeap-news-imagery/scripts/generate_images.py \
  --in /tmp/articles-batch.json \
  --out-dir data/images \
  --manifest /tmp/imagery-manifest.json
```

## Hard constraints — what the skill must NOT do

These mirror the invariants in `CLAUDE.md`. Violations break the pipeline.

1. **No writes to `data/news.json`.** Only `scripts/store.mjs` writes `news.json`. Adding an `image*` field is the dev's call, not the skill's. The skill produces image files and a side-channel manifest; the dev folds those into the schema (and bumps `schemaVersion` if the change is incompatible).
2. **No writes to `data/seen_urls.json`.** This is the dedupe state, owned by `scripts/dedupe.mjs`. Touching it breaks the URL+contentHash dual-key invariant.
3. **No edits to `scripts/feeds.mjs`, `scripts/dedupe.mjs`, `scripts/bedrock.mjs`, `scripts/store.mjs`, or `scripts/fetch.mjs`.** The pipeline must remain idempotent — the GitHub Actions workflow runs every 6h and any time-dependent or random output causes churn commits.
4. **No new GitHub Actions steps without the dev's review.** The OIDC role (`vars.AWS_ROLE_ARN`) is scoped to Bedrock today. Pollinations doesn't need AWS, but introducing a new outbound call from the workflow is a security review.
5. **Don't re-host Tier 1/2 images.** Record the source URL and license. The consumer hot-links or downloads at their surface, with attribution.
6. **Don't compose Tier 3 layouts.** The skill records the brand color + logo URL + intent. The composite (logo on tinted background, 16:9) is built by the consuming surface, because the format differs by surface (SVG / React / static PNG / Figma frame).
7. **Image files are not committed by the skill.** The Crawling-agent workflow already commits `data/images/*` produced by its own image step — the skill writes alongside that. If the skill is run locally outside the workflow, treat the resulting image files like a local `news.json` diff: don't commit them ad-hoc.
8. **Filename must be `sha256(url)[:16]`.** Anything else breaks the convention shared with `scripts/test-image-gen.mjs` and `scripts/images.mjs`.

## How the consumer dev (Yair) wires it in

A typical integration pattern (the dev decides whether to take this path or another):

1. Run the Crawling-agent pipeline as today. `news.json` updates.
2. Diff the new `news.json` to find articles missing an `imageFilename` (or all articles, when reprocessing).
3. For each missing article, the skill picks a tier per `source-priority.md`. Tiers 1-3 emit a manifest entry only; Tier 4 also writes `<sha256_16>.jpg` into `data/images/`.
4. Dev reviews the manifest, decides whether to:
   - Add an `image` field (object: `{ filename, source_type, attribution, alt_text }`) to `news.json`. Bump `schemaVersion` to 2 in the same change, and update the WordPress plugin's `schemaVersion === 1` check.
   - Or, hot-link the manifest from a sidecar file (e.g. `data/imagery.json`) until the schema change is ready.

Either way: the schema bump and the WordPress plugin update ship together, in one commit, with both ends tested. The skill produces files; the dev integrates them.

## Sanity checks before kicking off a batch

- [ ] You're running from the Crawling-agent repo root (so `data/images/` resolves correctly).
- [ ] You're not about to rewrite `data/seen_urls.json` or `data/news.json`.
- [ ] You've confirmed Pollinations is reachable (`curl -I https://image.pollinations.ai`).
- [ ] If the batch is >50 articles, you've told the user it'll take ~30+ min wall time.
- [ ] You're not running concurrent invocations against the same `--out-dir` — Pollinations throttles per IP, and concurrent writers to the same directory will race.

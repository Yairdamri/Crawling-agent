# Things to Consider

Open design questions to revisit when we have evidence or when they start mattering. Not blocked — just defaults worth being honest about.

---

## Sort order in `news.json`

Sorted by `publishedAt` desc, score as tiebreaker. Set in [scripts/store.mjs](scripts/store.mjs).

Trade-off: a today-score-5 article shows above a yesterday-score-9 article. Fine if "freshness first" feels right. Revisit if score-5/6 items dominate the top while genuinely important score-8+ items sit lower (or the reverse — feed feels stale because newer items are weak).

Alternatives: date-bucketed (today by score, then yesterday by score), composite weight (`score - hoursOld * 0.1`), or revert to score-first.

---

## Articles without images

If image generation fails after 3 attempts (1 try + 2 retries with 1s/4s backoff, retrying on any error), the article is dropped from `news.json` entirely. Filter lives in [scripts/store.mjs](scripts/store.mjs); retry lives in [scripts/images.mjs](scripts/images.mjs).

Trade-off: visual consistency on the WP page (every card has an image) at the cost of silently disappearing some articles. A reader interested in a CVE that tripped Gemini's safety filter just won't see it in our feed.

The article stays in `seen_urls.json` for 60 days, so we don't reprocess and waste another Bedrock + Gemini call. After 60 days it can come back via RSS and try again. Publisher edits to the article (different `contentHash`) also trigger a fresh attempt sooner.

Revisit if: too many high-score articles disappearing (worth surfacing them somehow), or if Gemini failure rates climb such that the feed visibly thins. A "stuck articles" log line or a small status page could help track this.

---

## Cross-source duplicate detection

We don't deduplicate articles across sources by content — only by URL+contentHash via [scripts/dedupe.mjs](scripts/dedupe.mjs). So two publishers covering the same story under different URLs (or one publisher republishing under a slightly different title) both end up in `news.json`.

The plan section #5 proposed Jaccard-on-titles + 48h time guard + per-feed source priority. Roughly half a day of work, design well-understood. Open question is whether it's worth building.

Trade-off: the plan was written when HN Front Page (~29% of feed volume, lots of aggregator-same-URL cases) was still a feed. After dropping HN Front Page and curating to ~19 mostly first-party vendor blogs, cross-source coverage almost never fires — the duplicates we actually have today are within-source republishes (e.g. AWS posting "agent quality loop" and "agent performance loop" hours apart, near-identical titles). At ~1-2 cases/week, savings are ~$0.04 of avoided Bedrock+Gemini calls. Code cost: ~150 LOC + new `scripts/cluster.mjs`.

If we ever build it, two design choices to make:
- **Within-run only vs cross-day.** Within-run compares fresh items against each other. Cross-day also compares against existing news.json entries — catches "TNS publishes Wednesday after AWS announced Tuesday" but adds complexity. Within-run probably catches everything that matters at our volume.
- **Source priority — canonical or editorial.** When a cluster forms, who survives? Canonical-wins (AWS itself > TNS commentary > HN aggregator) sends readers to the source-of-truth. Editorial-wins gives them the curated take. Plan defaults to canonical.

Layer 1 of the plan ("URL match catches HN-style aggregators") is already covered by existing URL+contentHash dedupe — no extra work needed there.

Revisit when: visible duplicate clusters become a recurring pattern in the feed, OR new aggregator-style feeds are added that re-cover other publishers' stories, OR a coworker review surfaces a different feed-quality concern this would solve.

Backman ticket exists: `2df71b94-8433-4f26-be9a-e158e9a58794` (suggestion, P2).

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

# Things to Consider

Running list of design questions and trade-offs surfaced during development. Not blocked decisions — open questions to revisit when we have evidence or when they start mattering. Each entry: what the question is, current default, and the trade-off.

---

## Sort order in `news.json`

**Current default:** sort by `publishedAt` desc, with `score` as tiebreaker. Newest articles on top regardless of quality (above the 5-score filter).

**Set in:** [scripts/store.mjs](scripts/store.mjs) — the `.sort()` comparator inside `mergeAndWrite`.

**The trade-off:** pure date sort means a today's score-5 article shows above yesterday's score-9 article. If "freshness first" feels right, this is fine. If quality drift becomes visible (e.g. trivial blog posts pushing genuinely important news off the top), revisit.

**Alternatives if we change our minds:**
- **Date-bucketed**: today's articles together (sorted by score), then yesterday's (sorted by score), etc. "Freshness first, quality within freshness."
- **Composite weight**: e.g. `score - hoursOld * 0.1`. Quality bumps up, age decays. Harder to explain why a specific article landed where it did.
- **Original score-first**: revert to score desc, date as tiebreaker. Quality dominates, which feels right for a curated feed but pushes new news down.

**What would trigger a revisit:** noticing the top of the feed is dominated by score-5/6 items while genuinely important score-8+ items sit lower. Or the opposite — feed feels stale because today's items are at score 5 and we're showing yesterday's score 8 on top.

---

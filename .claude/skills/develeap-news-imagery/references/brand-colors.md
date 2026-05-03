# Brand colors — picking the lead color

The lead color drives the **background tint** of the image (Tier 3 layout intent or Tier 4 AI generation). It's the single most powerful lever for visual variety across a batch — and the single most common cause of a "page that all looks the same" when chosen lazily.

## Develeap palette (use as accent / fallback)

These are the brand-safe defaults when the article subject has no obvious brand color, or when you need an accent that won't fight the subject's color.

| Token | Hex | Use as |
|---|---|---|
| `develeap_orange` | `#D97757` | Default lead for Engineering / generic AI / mixed topics |
| `develeap_navy` | `#1A2A44` | Lead for Security or "serious institutional" topics |
| `develeap_teal` | `#4FB6A9` | Lead for Cloud / observability when no vendor color applies |
| `develeap_sand` | `#F2E8DC` | Background accent only — never lead |
| `develeap_ink` | `#0B0F19` | Type / outlines — never lead |

**Don't lead with `develeap_orange` more than ~30% of a batch.** It's the brand color, but using it everywhere defeats the variety goal.

## Subject brand colors (when the article is *about* one named brand)

Use the official brand color from the vendor's brand guidelines. If the vendor publishes both a primary and an accent, prefer the accent — primary brand colors tend to clash with logos when composited.

| Subject | Lead color | Notes |
|---|---|---|
| AWS | `#FF9900` | Use sparingly — it competes with `develeap_orange` |
| Microsoft / Azure | `#00BCF2` | Cyan, not the deeper Office blue |
| Google Cloud / GCP | `#4285F4` | The "Google blue" |
| OpenAI | `#10A37F` | The teal-green from chat.openai.com |
| Anthropic | `#D97757` | Same as develeap_orange — note the collision |
| Kubernetes | `#326CE5` | The official k8s blue |
| Docker | `#2496ED` | Sky blue |
| GitHub | `#24292F` | Near-black; pair with high-contrast accent |
| HashiCorp / Terraform | `#7B42BC` | Violet, distinctive |
| NVIDIA | `#76B900` | Vivid green |
| Linux / kernel CVEs | `#000000` | Near-black; the Tux silhouette only when relevant |
| CISA / US gov | `#003366` | Federal navy |
| EU / EU Commission | `#003399` | EU flag blue |
| Hugging Face | `#FFD21E` | Yellow — high attention, use sparingly |
| Databricks | `#FF3621` | Bright red-orange |
| Stripe | `#635BFF` | Indigo |
| Cloudflare | `#F38020` | Orange (collision with AWS, develeap) |
| Stability AI | `#7C3AED` | Purple |
| Meta / Llama | `#0866FF` | Meta blue |

If a brand isn't in this table, **look it up on the vendor's brand guidelines page** before guessing. If still ambiguous in 30 seconds, fall back to a category-appropriate Develeap color.

## Category fallback (when no brand applies)

Use these when the article is conceptual, multi-vendor, or a community/standards topic.

| Category | Default lead | Why |
|---|---|---|
| AI | `develeap_orange` (#D97757) | Warm, energetic; fits the "AI moves fast" tone |
| DevOps | `#326CE5` (k8s-style blue) | Tooling tends to live in this blue space |
| Cloud | `#4FB6A9` (`develeap_teal`) | Reads as "infrastructure" without locking to one vendor |
| Engineering | `#1A2A44` (`develeap_navy`) | Serious, code-y, neutral |
| Security | `#A4262C` (deep red) | Reads as "incident / alert" |
| Other | `develeap_sand` accent over `develeap_navy` | Editorial fallback |

## Anti-uniformity guards (read before submitting a batch ≥ 4)

When generating cover images for a page (a feed slice, a social-card batch), the lead colors across that batch will read as a *visual rhythm*. Two failure modes:

**Failure mode A — The orange page.** Every AI article got `develeap_orange`, every cloud article got `#4FB6A9`. The page looks repetitive. Reader doesn't get any color cue to distinguish stories.

**Failure mode B — The neon mosaic.** Every article got its vendor's brand color, all at full saturation. Page looks like a sponsorship reel.

**Guard rules.** When auditing a batch:
1. **No more than 35% of the batch** can share the same hex (consider colors within 20° of hue as "the same family").
2. **At least 3 distinct color families** in any batch ≥ 6.
3. **Saturation distribution.** Mix saturated brand colors with desaturated `develeap_navy` / `develeap_sand` accents. A 6-image page should have at least 1 desaturated lead.
4. **Adjacent cards shouldn't share hue.** If the layout puts cards in a grid, neighbors-by-position should differ.

If a batch fails any guard: regenerate **only the offending articles**, not the whole batch. Pick a different valid lead color (e.g., switch from primary brand to accent, or switch to a category fallback).

## Worked picking examples

| Article title | Lead color | Reason |
|---|---|---|
| "Kubernetes 1.31 ships with sidecar containers GA" | `#326CE5` | k8s primary, single named subject |
| "Stripe outage takes down checkouts globally" | `#635BFF` | Stripe primary, incident — but red/orange would fight Stripe's purple |
| "CISA Adds Linux Root Access Bug to KEV" | `#A4262C` | Security incident, red is the universal alert hue |
| "Anthropic releases Claude 4.7 with extended context" | `#D97757` (Anthropic) — but watch for develeap collision | If batch already has 2x develeap_orange, switch to `develeap_navy` accent |
| "EU AI Act enters phase two" | `#003399` | EU institutional |
| "Specsmaxxing — overcoming AI psychosis" | `develeap_navy` accent over `develeap_sand` | Conceptual, no brand, batch needs a desaturated lead |
| "HashiCorp Terraform 1.10 introduces ephemeral resources" | `#7B42BC` | HashiCorp violet, distinctive |

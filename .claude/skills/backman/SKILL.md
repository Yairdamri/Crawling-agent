---
name: backman
description: Use for any task involving Backman, an internal product-backlog tool. Trigger on mentions of "backman", "the backlog", "next version" / "scheduled features", "feature suggestions", "refused features", or product-version tags. Provides the REST surface (products → features, versions), status flow (suggestion → backlog → scheduled → done; or refused), auth, and ready-to-run curl recipes.
version: 1.0.0
disable-model-invocation: false
---

# Backman — product backlog API

Backman is an internal tool for organizing product work: feature suggestions land in **suggestion**, get promoted to **backlog**, scheduled into a **version**, and finally marked **done**. Items that won't be built get **refused** with a reason.

This skill is for programmatic access via the REST API at `$BACKMAN_BASE_URL/api/v1`. The web UI lives at the same host.

## Auth

- Bearer token, generated from the **API Tokens** menu inside a product's board.
- One token = scoped to its product. To work across products you need separate tokens.
- The skill expects three env vars:
  - `BACKMAN_BASE_URL` — base URL of the Backman instance (no trailing slash)
  - `BACKMAN_API_TOKEN` — the bearer token
  - `BACKMAN_PRODUCT_ID` — the product UUID for the current working context
- These live in the project's `.env` (already gitignored alongside other secrets like `GEMINI_API_KEY`). Load them into the shell before running curl recipes:

```bash
set -a; source .env; set +a
```

- **Never paste the token into a SKILL.md, commit message, or chat log.** If a token is exposed, rotate it from the API Tokens menu in Backman.

Default product for the news-feed pipeline: .env "BACKMAN_PRODUCT_ID"
 (ai-news-feed). Confirm before using it for any other context.

## Resource model

```
Product (provisioned out-of-band, not via this API)
 ├── Features              ← the work items
 │     status ∈ { suggestion, backlog, scheduled, done, refused }
 │     priority ∈ { 0, 1, 2, 3 }   (higher = more urgent)
 │     version_id (set when status = scheduled or done)
 │     vote_count, suggested_by, refuse_reason, refuse_datetime
 └── Versions              ← release tags features get bucketed into
       tag (e.g. "v1.4"), comment
```

Status transitions worth knowing:
- `suggestion → backlog → scheduled → done` is the happy path; use `PATCH …/status`.
- `refused` is terminal and goes through `POST …/refuse` (requires a `reason`), **not** the status PATCH — the status PATCH enum doesn't include `refused`.
- Moving to `scheduled` is what "ships in the next version" means; the feature should be linked to a `version_id` (set/managed by the server when scheduled — verify by GETting the feature after the PATCH).

## Endpoints (full surface)

Base: `$BACKMAN_BASE_URL/api/v1`. Replace `$P` with product id, `$F` with feature id, `$V` with version id.

### Features
| Verb | Path | Body | Notes |
|------|------|------|-------|
| GET | `/products/$P/features` | – | Optional `?status=backlog` (any of the enum values). Returns array. |
| POST | `/products/$P/features` | `{title*, description?, priority?}` | Creates a suggestion. |
| GET | `/products/$P/features/$F` | – | |
| PUT | `/products/$P/features/$F` | `{title?, description?, priority?}` | Edits content; does not change status. |
| PATCH | `/products/$P/features/$F/status` | `{status}` | `status ∈ {suggestion, backlog, scheduled, done}` only. |
| POST | `/products/$P/features/$F/refuse` | `{reason*}` | Sets status to `refused`, stamps `refuse_datetime`. |
| DELETE | `/products/$P/features/$F` | – | Hard delete; prefer `refuse` if you want a paper trail. |

### Versions
| Verb | Path | Body |
|------|------|------|
| GET | `/products/$P/versions` | – |
| POST | `/products/$P/versions` | `{tag*, comment?}` |
| GET | `/products/$P/versions/$V` | – |
| PUT | `/products/$P/versions/$V` | `{tag?, comment?}` |
| DELETE | `/products/$P/versions/$V` | – |

## Recipes

All examples assume `$BACKMAN_BASE_URL`, `$BACKMAN_API_TOKEN`, and `$BACKMAN_PRODUCT_ID` are set in the environment.

```bash
# Convenience header
H="Authorization: Bearer $BACKMAN_API_TOKEN"
B="$BACKMAN_BASE_URL/api/v1/products/$BACKMAN_PRODUCT_ID"

# What's in the backlog right now?
curl -sH "$H" "$B/features?status=backlog" | jq '.[] | {id, title, priority}'

# What's scheduled for the next version (and which version)?
curl -sH "$H" "$B/features?status=scheduled" | jq '.[] | {title, priority, version_id}'

# Recently completed
curl -sH "$H" "$B/features?status=done" | jq '.[] | {title, version_id, updated_at}'

# Add a new suggestion
curl -sH "$H" -H 'Content-Type: application/json' -X POST "$B/features" \
  -d '{"title":"Auto-tag articles by language","description":"Detect HE vs EN at ingest","priority":2}'

# Promote a suggestion to backlog
curl -sH "$H" -H 'Content-Type: application/json' -X PATCH "$B/features/$F/status" \
  -d '{"status":"backlog"}'

# Refuse a feature with a reason (terminal — not via /status)
curl -sH "$H" -H 'Content-Type: application/json' -X POST "$B/features/$F/refuse" \
  -d '{"reason":"Out of scope for v1; revisit after multi-tenant work."}'

# Cut a new version tag
curl -sH "$H" -H 'Content-Type: application/json' -X POST "$B/versions" \
  -d '{"tag":"v0.4","comment":"Image generation + dedupe upgrades"}'
```

## Common tasks → which call

| User asks for… | Call |
|---|---|
| "What's in the backlog?" | `GET /features?status=backlog` |
| "What's coming in the next version?" | `GET /features?status=scheduled` (group by `version_id`, then look up tags via `GET /versions`) |
| "What did we ship recently?" | `GET /features?status=done`, sort by `updated_at` desc |
| "Add this idea to the backlog" | `POST /features` (lands in `suggestion`) → `PATCH /status` to `backlog` |
| "Schedule X for the next version" | `PATCH /status` → `scheduled`. If a target version doesn't exist, `POST /versions` first. |
| "Mark X done" | `PATCH /status` → `done` |
| "Reject X because Y" | `POST /features/$F/refuse` with `{reason: "Y"}` (do **not** use `/status`) |

## Gotchas

- `/status` PATCH **cannot** set `refused` — it's only `suggestion|backlog|scheduled|done`. Refusing requires the dedicated endpoint with a reason.
- The product ID is **required** in every URL; there is no public list-products endpoint exposed via this API. Get the UUID from the URL of the product's board in the UI.
- Token is product-scoped — a 200 with `[]` may mean either "really empty" or "token is for a different product". When in doubt, GET a single feature you know exists.
- `priority` is an integer 0–3 — the API rejects strings.
- Don't hard-delete features that real users suggested. Prefer `refuse` so the rationale is preserved.

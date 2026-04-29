# AI / Tech / DevOps News Feed MVP

Automated news pipeline. GitHub Actions runs every 6 hours, fetches RSS feeds, has OpenAI summarize/tag/score each article, commits the result to `data/news.json`. A small WordPress plugin renders the JSON on your existing WP site via a `[ai_news_feed]` shortcode.

## Architecture

Visual: [docs/architecture.excalidraw](docs/architecture.excalidraw) — open in [Excalidraw](https://excalidraw.com/) (drag-and-drop the file, or use **Open** > pick file).

```
GitHub Actions (cron 6h)
    -> scripts/fetch.mjs
        -> rss-parser (config/feeds.json)
        -> dedupe via data/seen_urls.json
        -> Bedrock Claude Haiku 4.5 (batched, tool-use structured output)
        -> data/news.json (committed back to repo)

WordPress (managed host)
    -> ai-news-feed plugin
        -> shortcode [ai_news_feed]
        -> wp_remote_get(<raw GitHub URL>) with 1h transient cache
        -> renders article cards
```

Auth from Actions to AWS uses GitHub OIDC, no static keys.

## Local development

```bash
npm install
cp .env.example .env       # add your OPENAI_API_KEY
node --env-file=.env scripts/fetch.mjs
```

Inspect `data/news.json` afterwards. A second run should be near-instant (everything already in `seen_urls.json`).

## Deployment

1. Push this repo to GitHub (public).
2. In repo Settings -> Secrets and variables -> Actions, add `OPENAI_API_KEY`.
3. Trigger the workflow manually once (Actions tab -> Fetch News -> Run workflow) to seed `data/news.json`.
4. Zip `wordpress-plugin/ai-news-feed/` and install it via `wp-admin -> Plugins -> Add New -> Upload Plugin`.
5. In WP, go to **Settings -> AI News Feed** and paste your raw JSON URL:
   `https://raw.githubusercontent.com/<user>/<repo>/main/data/news.json`
6. Create a WP page with the shortcode `[ai_news_feed]`.

## Configuration

- `config/feeds.json` - list of RSS sources. Edit freely; no code changes needed.
- `scripts/openai.mjs` - prompt and schema. Tweak the system prompt to change editorial voice.
- `.github/workflows/fetch-news.yml` - cron schedule.

## Shortcode options

```
[ai_news_feed]                              full feed
[ai_news_feed limit="10"]                   first 10
[ai_news_feed category="DevOps"]            filter by category
[ai_news_feed limit="5" category="AI"]      both
```

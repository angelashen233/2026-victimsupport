# ED Wait Times Proxy

A Cloudflare Worker that polls `edwaittimes.ca`'s wait-time API every 5 minutes
(matching their own refresh cadence), caches the result in Workers KV, and
serves it to the victim-support frontend from `/api/wait-times`.

Why this exists instead of the frontend calling `edwaittimes.ca` directly:
one server-side poll every 5 minutes regardless of how many users you have,
a cached fallback if the upstream call fails, and no dependence on their CORS
policy staying permissive for browser origins.

## One-time setup

```bash
cd worker
npm install
npx wrangler login          # opens a browser to authorize your Cloudflare account
npx wrangler kv namespace create WAIT_TIMES
```

The last command prints an `id`. Paste it into `wrangler.toml` in place of
`REPLACE_WITH_KV_NAMESPACE_ID`.

Also edit the `ALLOWED_ORIGINS` var in `wrangler.toml` to match where your
frontend is actually hosted (e.g. your real `https://<username>.github.io`
origin), comma-separated with no spaces needed.

## Deploy

```bash
npm run deploy
```

This prints the Worker's URL, e.g. `https://ed-wait-times-proxy.<subdomain>.workers.dev`.
The first deploy also registers the cron trigger — it'll start populating the
KV cache within 5 minutes. Until then, the Worker falls back to a live fetch
on the first incoming request.

## Point the frontend at it

In the project root (not `worker/`), set in `.env.local`:

```
VITE_WAIT_TIMES_API_URL=https://ed-wait-times-proxy.<subdomain>.workers.dev/api/wait-times
```

Then rebuild/redeploy the frontend. If this var is unset, the frontend falls
back to calling `edwaittimes.ca` directly (the old behavior), so nothing
breaks if you haven't deployed the Worker yet.

## Local dev

```bash
npm run dev
```

Runs the Worker locally via `wrangler dev` (uses a local KV simulation).

## Debugging

```bash
npm run tail
```

Streams live logs from the deployed Worker, including any `scheduled refresh
failed` errors from the cron job.

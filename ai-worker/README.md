# AI Worker

A Cloudflare Worker that proxies chat and structured-generation requests
from the victim-support frontend to AWS Bedrock (Llama 3 8B Instruct,
called in-region in `ca-central-1` for Canadian data residency), signing
requests with an AWS access key/secret that never reaches the browser.

## Why this exists

AWS Bedrock authentication (SigV4-signed requests) can't safely be done
from a browser — unlike a rate-limited API key, a leaked AWS access
key/secret grants broad account access. This Worker holds those
credentials server-side and exposes two narrow, origin- and
rate-limited endpoints instead.

## One-time AWS setup

1. In the [Bedrock console](https://console.aws.amazon.com/bedrock/home),
   in the **ca-central-1 (Canada)** region, enable model access for
   **Llama 3 8B Instruct**. This is a one-time per-account/per-region
   grant, separate from IAM permissions.
2. Create an IAM user scoped to just `bedrock:InvokeModel` and
   `bedrock:Converse` for that model (don't reuse a broad admin key —
   this key lives in a Cloudflare Worker's secret store). Generate an
   Access Key ID + Secret Access Key for it.

## One-time Cloudflare setup

```bash
cd ai-worker
npm install
npx wrangler login
npx wrangler kv namespace create RATE_LIMIT
```

The last command prints an `id`. Paste it into `wrangler.toml` in place
of `REPLACE_WITH_KV_NAMESPACE_ID`.

Edit `ALLOWED_ORIGINS` in `wrangler.toml` to match where your frontend is
actually hosted, comma-separated with no spaces needed.

Set the AWS credentials as Worker secrets (never commit these):

```bash
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
```

## Deploy

```bash
npm run deploy
```

This prints the Worker's URL, e.g. `https://ai-worker.<subdomain>.workers.dev`.

## Point the frontend at it

In the project root (not `ai-worker/`), set in `.env.local`:

```
VITE_AI_WORKER_URL=https://ai-worker.<subdomain>.workers.dev
```

Then rebuild/redeploy the frontend.

**For the GitHub Pages deploy specifically:** `.env.local` only affects
local dev builds — it's git-ignored and never reaches CI. The
`deploy.yml` workflow instead reads `VITE_AI_WORKER_URL` from a GitHub
Actions **repository variable** (not a secret, since this is just a
public Worker URL, not sensitive). Once `ai-worker` is deployed and you
have its URL, set it at: repo **Settings → Secrets and variables →
Actions → Variables tab → New repository variable**, name
`VITE_AI_WORKER_URL`, value the Worker URL from above. Without this, the
deployed site's bundle has `VITE_AI_WORKER_URL` undefined and every
chat/report/resource call fails immediately.

## Local dev

For `wrangler dev` to reach real Bedrock locally, create `ai-worker/.dev.vars`
(gitignored, never committed) with:

```
AWS_ACCESS_KEY_ID=your-key-id
AWS_SECRET_ACCESS_KEY=your-secret-key
```

Then:

```bash
npm run dev
```

Wrangler simulates KV locally automatically, so rate limiting works
in local dev even before you've created a real KV namespace.

## Debugging

```bash
npm run tail
```

Streams live logs from the deployed Worker.

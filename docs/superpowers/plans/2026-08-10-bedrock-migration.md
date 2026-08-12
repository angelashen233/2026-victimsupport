# AWS Bedrock Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Gemini with AWS Bedrock (Llama 3 8B Instruct, in-region `ca-central-1`) for the app's text-based AI features — the four chat agents, incident-report/resource JSON generation, and the dev-only Ollama fallback target — via a new Cloudflare Worker (`ai-worker/`). Voice chat stays on Gemini, untouched.

**Architecture:** A new Cloudflare Worker (`ai-worker/`, sibling to the existing `worker/` wait-times proxy) signs and forwards requests to Bedrock's Converse API using `aws4fetch`, exposing `POST /api/chat` and `POST /api/structured`. The frontend's Gemini-calling code is replaced with `fetch` calls to this Worker; `Content`/`Part` shapes from `@google/genai` are kept as the wire format since that package remains a dependency (for voice chat) and every other part of the codebase already speaks that shape.

**Tech Stack:** Cloudflare Workers (`wrangler`), `aws4fetch` for SigV4 signing, Workers KV for rate limiting. Frontend: existing React/Vite/TypeScript stack, no new frontend dependencies.

## Global Constraints

- `AWS_REGION` must be `ca-central-1` (Bedrock in-region call, for Canadian data residency — see spec).
- `BEDROCK_MODEL_ID` must be `meta.llama3-8b-instruct-v1:0`.
- Llama 3 8B Instruct supports neither Converse tool-use nor image input. Structured JSON output uses prompt-based generation with a one-shot parse/retry (no forced tool calls). Image attachments are stripped before being sent to the model, with a text note added so the agent acknowledges it can't view the photo (see spec's "Image handling" decision).
- Voice chat (`ChatScreen.tsx`'s `startVoiceChat`, Gemini Live API) is out of scope and must not be touched. `@google/genai` stays a dependency; `GEMINI_API_KEY` stays required (now only for voice).
- No automated test framework exists in this repo (`worker/` and the frontend both have zero tests today). Verification in this plan is manual (`wrangler dev` + `curl`, then a full run of `npm run dev`), matching the project's existing convention — this is a deliberate deviation from default TDD guidance, not an oversight.
- New Worker endpoints must reject requests whose `Origin` isn't in a configured `ALLOWED_ORIGINS` list, and apply a per-IP rate limit (KV-backed, since this must work on Cloudflare's free tier).
- `Part`/`Content` types for chat messages/history keep coming from `@google/genai` — no new type definitions.

---

## File Structure

**New — `ai-worker/` (Cloudflare Worker):**
- `ai-worker/package.json` — deps: `aws4fetch`; devDeps: `wrangler`.
- `ai-worker/wrangler.toml` — Worker config, KV binding, non-secret vars.
- `ai-worker/src/index.js` — request router: CORS/origin check, rate limit, dispatch to handlers.
- `ai-worker/src/cors.js` — origin allow-list + CORS header helpers.
- `ai-worker/src/rateLimit.js` — KV-backed fixed-window per-IP rate limiter.
- `ai-worker/src/bedrock.js` — signs and calls Bedrock's Converse API.
- `ai-worker/src/chatHandler.js` — `POST /api/chat` handler.
- `ai-worker/src/structuredHandler.js` — `POST /api/structured` handler (prompt + parse/retry).
- `ai-worker/README.md` — AWS + Cloudflare setup and deploy instructions.

**New — frontend:**
- `services/parts.ts` — shared `Part[]` helpers (`partsToText`, `partsHaveImage`), extracted so both `ollamaChat.ts` and the new `bedrockChat.ts` can use them without duplicating logic.
- `services/bedrockChat.ts` — `ChatLike`-implementing wrapper that calls `ai-worker`'s `/api/chat`, replacing the Gemini `Chat` object as the production chat backend.

**Renamed — frontend:**
- `services/geminiService.ts` → `services/reportService.ts` — no longer calls Gemini; keeping the old name would be misleading.

**Modified — frontend:**
- `services/ollamaChat.ts` — extract shared helpers to `services/parts.ts`; rename the Gemini-fallback naming/comments to Bedrock.
- `services/agents.ts` — `createAgent`/`createAgentWithHistory` drop their `ai: GoogleGenAI` parameter and delegate to `services/bedrockChat.ts`.
- `App.tsx` — drop `ai` arguments from agent/report/resource calls; text-chat init no longer gates on `aiRef.current` (that ref now exists solely for voice chat).
- `.env.example` — add `VITE_AI_WORKER_URL`; clarify `GEMINI_API_KEY` is voice-only now.
- `README.md` — document the new Worker setup step.
- `.gitignore` — add `.dev.vars` (Wrangler's local-secrets file, used for testing `ai-worker/` against real AWS credentials without committing them).

---

### Task 1: Scaffold `ai-worker/` and write its setup docs

**Files:**
- Create: `ai-worker/package.json`
- Create: `ai-worker/wrangler.toml`
- Create: `ai-worker/src/index.js`
- Create: `ai-worker/README.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces: a deployable-but-empty Worker (`GET /` → `200 "ok"`) that later tasks add routes to. `env.ALLOWED_ORIGINS` (comma-separated string var), `env.AWS_REGION`, `env.BEDROCK_MODEL_ID` (non-secret vars from `wrangler.toml`), `env.AWS_ACCESS_KEY_ID` / `env.AWS_SECRET_ACCESS_KEY` (secrets, not yet used).

- [ ] **Step 1: Create `ai-worker/package.json`**

```json
{
  "name": "ai-worker",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "tail": "wrangler tail"
  },
  "devDependencies": {
    "wrangler": "^3.90.0"
  }
}
```

- [ ] **Step 2: Create `ai-worker/wrangler.toml`**

```toml
name = "ai-worker"
main = "src/index.js"
compatibility_date = "2026-07-17"

[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "REPLACE_WITH_KV_NAMESPACE_ID"

[vars]
ALLOWED_ORIGINS = "http://localhost:5174,https://YOUR_GH_USERNAME.github.io"
AWS_REGION = "ca-central-1"
BEDROCK_MODEL_ID = "meta.llama3-8b-instruct-v1:0"
```

- [ ] **Step 3: Create a minimal `ai-worker/src/index.js` stub**

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response('ok', { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  },
};
```

- [ ] **Step 4: Add `.dev.vars` to `.gitignore`**

In `.gitignore`, add this line under the existing `.wrangler` line:

```
.dev.vars
```

`.dev.vars` is Wrangler's convention for local-only secrets (used in Task 4 to test against real AWS credentials during `wrangler dev` without committing them).

- [ ] **Step 5: Write `ai-worker/README.md`**

```markdown
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
```

- [ ] **Step 6: Verify the scaffold runs**

Run: `cd ai-worker && npm install && npm run dev`
Then in another terminal: `curl http://localhost:8787/`
Expected: `ok`

- [ ] **Step 7: Commit**

```bash
git add ai-worker/package.json ai-worker/wrangler.toml ai-worker/src/index.js ai-worker/README.md .gitignore
git commit -m "Scaffold ai-worker Cloudflare Worker project"
```

---

### Task 2: CORS / origin enforcement

**Files:**
- Create: `ai-worker/src/cors.js`
- Modify: `ai-worker/src/index.js`

**Interfaces:**
- Produces: `corsHeaders(origin, allowedOrigins): Record<string,string>`, `isAllowedOrigin(origin, allowedOrigins): boolean` — both consumed by `index.js` now, and by later handler-wiring in Tasks 3, 5, 6.
- Consumes: nothing new.

- [ ] **Step 1: Create `ai-worker/src/cors.js`**

```js
export function corsHeaders(origin, allowedOrigins) {
  const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

export function isAllowedOrigin(origin, allowedOrigins) {
  return !!origin && allowedOrigins.includes(origin);
}
```

- [ ] **Step 2: Wire origin enforcement into `ai-worker/src/index.js`**

Replace the full file with:

```js
import { corsHeaders, isAllowedOrigin } from './cors.js';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    const headers = corsHeaders(origin, allowedOrigins);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    if (!isAllowedOrigin(origin, allowedOrigins)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response('ok', { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  },
};
```

- [ ] **Step 3: Verify origin enforcement**

Run: `cd ai-worker && npm run dev` (in one terminal)

Allowed origin:
Run: `curl -H "Origin: http://localhost:5174" http://localhost:8787/`
Expected: `ok`

Disallowed origin:
Run: `curl -i -H "Origin: https://evil.example" http://localhost:8787/`
Expected: HTTP 403, body `{"error":"Origin not allowed"}`

- [ ] **Step 4: Commit**

```bash
git add ai-worker/src/cors.js ai-worker/src/index.js
git commit -m "Add origin enforcement to ai-worker"
```

---

### Task 3: Per-IP rate limiting

**Files:**
- Create: `ai-worker/src/rateLimit.js`
- Modify: `ai-worker/src/index.js`

**Interfaces:**
- Produces: `checkRateLimit(env, ip): Promise<boolean>` — `true` if the request is allowed, `false` if the caller is over the limit. Consumed by `index.js` now, unaffected by later handler tasks (they run after this check).
- Consumes: `corsHeaders`/`isAllowedOrigin` from Task 2.

- [ ] **Step 1: Create `ai-worker/src/rateLimit.js`**

```js
const WINDOW_SECONDS = 60;
const MAX_REQUESTS_PER_WINDOW = 20;

// Best-effort fixed-window counter: reads then writes without atomicity,
// so concurrent requests landing in the same window can slightly
// overcount past the limit. That's an acceptable trade-off for abuse
// deterrence on a free-tier KV namespace -- not a hard guarantee.
export async function checkRateLimit(env, ip) {
  const windowStart = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  const key = `${ip}:${windowStart}`;
  const current = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
  if (current >= MAX_REQUESTS_PER_WINDOW) return false;
  await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: WINDOW_SECONDS * 2 });
  return true;
}
```

- [ ] **Step 2: Wire rate limiting into `ai-worker/src/index.js`**

Replace the full file with:

```js
import { corsHeaders, isAllowedOrigin } from './cors.js';
import { checkRateLimit } from './rateLimit.js';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    const headers = corsHeaders(origin, allowedOrigins);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    if (!isAllowedOrigin(origin, allowedOrigins)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const allowed = await checkRateLimit(env, ip);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response('ok', { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  },
};
```

- [ ] **Step 3: Verify rate limiting**

Run: `cd ai-worker && npm run dev` (in one terminal)

Run this loop (21 requests, one over the limit) in another terminal:

```bash
for i in $(seq 1 21); do curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: http://localhost:5174" http://localhost:8787/; done
```

Expected: twenty `200` lines followed by one `429`.

- [ ] **Step 4: Commit**

```bash
git add ai-worker/src/rateLimit.js ai-worker/src/index.js
git commit -m "Add per-IP rate limiting to ai-worker"
```

---

### Task 4: Bedrock Converse client

**Files:**
- Create: `ai-worker/src/bedrock.js`
- Modify: `ai-worker/package.json`

**Interfaces:**
- Produces: `converse(env, { system, messages, temperature?, maxTokens? }): Promise<string>` — throws on any non-2xx Bedrock response or missing text in the response. Consumed by `chatHandler.js` (Task 5) and `structuredHandler.js` (Task 6).
- Consumes: `env.AWS_ACCESS_KEY_ID`, `env.AWS_SECRET_ACCESS_KEY`, `env.AWS_REGION`, `env.BEDROCK_MODEL_ID`.

This task requires real AWS credentials (from Task 1's setup) to verify. If you haven't completed the "One-time AWS setup" and "One-time Cloudflare setup" sections of `ai-worker/README.md` yet, do that now — specifically, model access for Llama 3 8B Instruct must be enabled in `ca-central-1`, and you need an IAM access key/secret scoped to `bedrock:InvokeModel`/`bedrock:Converse`.

- [ ] **Step 1: Add the `aws4fetch` dependency**

Run: `cd ai-worker && npm install aws4fetch`

- [ ] **Step 2: Create `ai-worker/src/bedrock.js`**

```js
import { AwsClient } from 'aws4fetch';

export async function converse(env, { system, messages, temperature = 0.3, maxTokens = 1024 }) {
  const client = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: env.AWS_REGION,
    service: 'bedrock',
  });

  const url = `https://bedrock-runtime.${env.AWS_REGION}.amazonaws.com/model/${encodeURIComponent(env.BEDROCK_MODEL_ID)}/converse`;

  const res = await client.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system,
      messages,
      inferenceConfig: { temperature, maxTokens },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Bedrock responded ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const textBlock = data?.output?.message?.content?.find(c => typeof c.text === 'string');
  if (!textBlock) throw new Error('Bedrock response missing text content');
  return textBlock.text;
}
```

- [ ] **Step 3: Create a temporary local verification route**

This is a throwaway check, not part of the final routing (Task 5 replaces `index.js`'s routing again). Temporarily replace the body of the `if (url.pathname === '/')` block in `ai-worker/src/index.js` with:

```js
    if (url.pathname === '/') {
      try {
        const text = await converse(env, {
          system: [{ text: 'You are a helpful assistant.' }],
          messages: [{ role: 'user', content: [{ text: 'Reply with exactly the word: pong' }] }],
        });
        return new Response(text, { status: 200, headers });
      } catch (err) {
        return new Response(String(err), { status: 500, headers });
      }
    }
```

Add `import { converse } from './bedrock.js';` to the top of `index.js`.

- [ ] **Step 4: Verify against real Bedrock**

Run: `cd ai-worker && npm run dev`
Run: `curl -H "Origin: http://localhost:5174" http://localhost:8787/`
Expected: a response containing "pong" (exact wording may vary slightly since it's still a live model call). If you get a 500, the body will show the Bedrock error — most likely causes are model access not enabled in `ca-central-1`, wrong/missing `.dev.vars` credentials, or an IAM permissions gap.

- [ ] **Step 5: Revert the temporary verification route**

Remove the temporary `/` handling added in Step 3 and the `converse` import from `index.js`, restoring it to the version from Task 3's Step 2 (the `converse` function itself in `bedrock.js` stays — only the temporary wiring in `index.js` is reverted).

- [ ] **Step 6: Commit**

```bash
git add ai-worker/src/bedrock.js ai-worker/package.json ai-worker/package-lock.json
git commit -m "Add Bedrock Converse client to ai-worker"
```

---

### Task 5: `/api/chat` endpoint

**Files:**
- Create: `ai-worker/src/chatHandler.js`
- Modify: `ai-worker/src/index.js`

**Interfaces:**
- Produces: `handleChat(request, env): Promise<Response>` — expects a JSON body `{ systemInstruction: string, history: Content[], message: Part[] }` where `Content = { role: 'user'|'model', parts: Part[] }` and `Part = { text: string }` (image parts are dropped — see Global Constraints), returns `{ text: string }` on success. Consumed by `index.js`'s router.
- Consumes: `converse` from `ai-worker/src/bedrock.js` (Task 4).

- [ ] **Step 1: Create `ai-worker/src/chatHandler.js`**

```js
import { converse } from './bedrock.js';

function partToConverseContent(part) {
  if (typeof part.text === 'string') return { text: part.text };
  return null; // image parts are stripped client-side before reaching this worker
}

function contentToConverseMessage(content) {
  return {
    role: content.role === 'model' ? 'assistant' : 'user',
    content: content.parts.map(partToConverseContent).filter(Boolean),
  };
}

export async function handleChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { systemInstruction, history, message } = body;
  if (typeof systemInstruction !== 'string' || !Array.isArray(message)) {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  const messages = [
    ...(Array.isArray(history) ? history.map(contentToConverseMessage) : []),
    { role: 'user', content: message.map(partToConverseContent).filter(Boolean) },
  ];

  try {
    const text = await converse(env, {
      system: [{ text: systemInstruction }],
      messages,
      temperature: 0.3,
      maxTokens: 1024,
    });
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Bedrock request failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

- [ ] **Step 2: Wire `/api/chat` into `ai-worker/src/index.js`**

Replace the full file with:

```js
import { corsHeaders, isAllowedOrigin } from './cors.js';
import { checkRateLimit } from './rateLimit.js';
import { handleChat } from './chatHandler.js';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    const headers = corsHeaders(origin, allowedOrigins);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    if (!isAllowedOrigin(origin, allowedOrigins)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const allowed = await checkRateLimit(env, ip);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const url = new URL(request.url);
    let response;
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      response = await handleChat(request, env);
    } else {
      response = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }

    const responseHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(headers)) responseHeaders.set(k, v);
    if (!responseHeaders.has('Content-Type')) responseHeaders.set('Content-Type', 'application/json');
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  },
};
```

- [ ] **Step 3: Verify `/api/chat` against real Bedrock**

Run: `cd ai-worker && npm run dev`
Run:

```bash
curl -X POST -H "Origin: http://localhost:5174" -H "Content-Type: application/json" \
  -d '{"systemInstruction":"You are a terse assistant.","history":[],"message":[{"text":"Reply with exactly the word: pong"}]}' \
  http://localhost:8787/api/chat
```

Expected: `200` with a JSON body like `{"text":"pong"}` (or close to it).

- [ ] **Step 4: Commit**

```bash
git add ai-worker/src/chatHandler.js ai-worker/src/index.js
git commit -m "Add /api/chat endpoint to ai-worker"
```

---

### Task 6: `/api/structured` endpoint (prompt-based JSON + retry)

**Files:**
- Create: `ai-worker/src/structuredHandler.js`
- Modify: `ai-worker/src/index.js`

**Interfaces:**
- Produces: `handleStructured(request, env): Promise<Response>` — expects `{ prompt: string, schema: string }`, returns the parsed JSON object directly (not wrapped) on success. Consumed by `index.js`'s router.
- Consumes: `converse` from `ai-worker/src/bedrock.js` (Task 4).

- [ ] **Step 1: Create `ai-worker/src/structuredHandler.js`**

```js
import { converse } from './bedrock.js';

const JSON_SYSTEM_PROMPT =
  'You are a precise JSON-generation assistant. Always respond with a single valid JSON object only -- no prose, no markdown code fences, no explanation.';

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in model output');
  return JSON.parse(match[0]);
}

export async function handleStructured(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { prompt, schema } = body;
  if (typeof prompt !== 'string' || typeof schema !== 'string') {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  const firstPrompt = `${prompt}\n\nRespond with ONLY a single JSON object matching this shape, and no other text:\n${schema}`;
  const messages = [{ role: 'user', content: [{ text: firstPrompt }] }];

  try {
    const firstText = await converse(env, {
      system: [{ text: JSON_SYSTEM_PROMPT }],
      messages,
      temperature: 0.1,
      maxTokens: 2048,
    });

    try {
      const parsed = extractJson(firstText);
      return new Response(JSON.stringify(parsed), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      const retryMessages = [
        ...messages,
        { role: 'assistant', content: [{ text: firstText }] },
        {
          role: 'user',
          content: [{ text: `That was not valid JSON. Respond again with ONLY a single valid JSON object matching this shape:\n${schema}` }],
        },
      ];
      const retryText = await converse(env, {
        system: [{ text: JSON_SYSTEM_PROMPT }],
        messages: retryMessages,
        temperature: 0.1,
        maxTokens: 2048,
      });
      const parsed = extractJson(retryText);
      return new Response(JSON.stringify(parsed), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'The AI returned an invalid report format. Please try again.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
```

- [ ] **Step 2: Wire `/api/structured` into `ai-worker/src/index.js`**

Replace the full file with:

```js
import { corsHeaders, isAllowedOrigin } from './cors.js';
import { checkRateLimit } from './rateLimit.js';
import { handleChat } from './chatHandler.js';
import { handleStructured } from './structuredHandler.js';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    const headers = corsHeaders(origin, allowedOrigins);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    if (!isAllowedOrigin(origin, allowedOrigins)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const allowed = await checkRateLimit(env, ip);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const url = new URL(request.url);
    let response;
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      response = await handleChat(request, env);
    } else if (url.pathname === '/api/structured' && request.method === 'POST') {
      response = await handleStructured(request, env);
    } else {
      response = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }

    const responseHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(headers)) responseHeaders.set(k, v);
    if (!responseHeaders.has('Content-Type')) responseHeaders.set('Content-Type', 'application/json');
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  },
};
```

- [ ] **Step 3: Verify `/api/structured` against real Bedrock**

Run: `cd ai-worker && npm run dev`
Run:

```bash
curl -X POST -H "Origin: http://localhost:5174" -H "Content-Type: application/json" \
  -d '{"prompt":"Generate a JSON object describing a fictional person for a unit test.","schema":"{ \"name\": string, \"age\": number }"}' \
  http://localhost:8787/api/structured
```

Expected: `200` with a JSON body shaped like `{"name": "...", "age": ...}`.

- [ ] **Step 4: Commit**

```bash
git add ai-worker/src/structuredHandler.js ai-worker/src/index.js
git commit -m "Add /api/structured endpoint to ai-worker"
```

---

### Task 7: Extract shared `Part[]` helpers, rename Gemini references in `ollamaChat.ts`

**Files:**
- Create: `services/parts.ts`
- Modify: `services/ollamaChat.ts`

**Interfaces:**
- Produces: `partsToText(parts: Part[]): string`, `partsHaveImage(parts: Part[]): boolean` — consumed by `ollamaChat.ts` (this task) and `bedrockChat.ts` (Task 8).
- Consumes: `Part` type from `@google/genai`.

- [ ] **Step 1: Create `services/parts.ts`**

```typescript
import type { Part } from "@google/genai";

export function partsToText(parts: Part[]): string {
  return parts
    .filter((p): p is { text: string } => typeof (p as { text?: unknown }).text === "string")
    .map(p => p.text)
    .join("\n");
}

export function partsHaveImage(parts: Part[]): boolean {
  return parts.some(p => !!(p as { inlineData?: unknown }).inlineData);
}
```

- [ ] **Step 2: Update `services/ollamaChat.ts`'s imports and drop the local helper definitions**

In `services/ollamaChat.ts`, replace:

```typescript
import type { Content, Part } from "@google/genai";
import type { ChatLike } from "./agents";

// Dev-only: talk to a local Ollama server instead of Gemini, falling back to
// a real Gemini chat (built by `buildGeminiChat`) if Ollama is unreachable,
// errors, times out, or is asked to look at an image it can't handle.
// See worker/README.md-equivalent docs in README for setup — this only ever
// runs when import.meta.env.DEV is true; production always uses Gemini.

const OLLAMA_BASE_URL = "http://localhost:11434";
export const OLLAMA_MODEL = "llama3.2:1b";
const OLLAMA_REQUEST_TIMEOUT_MS = 30000;
const OLLAMA_PING_TIMEOUT_MS = 1500;

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function partsToText(parts: Part[]): string {
  return parts
    .filter((p): p is { text: string } => typeof (p as { text?: unknown }).text === "string")
    .map(p => p.text)
    .join("\n");
}

function partsHaveImage(parts: Part[]): boolean {
  return parts.some(p => !!(p as { inlineData?: unknown }).inlineData);
}
```

with:

```typescript
import type { Content, Part } from "@google/genai";
import type { ChatLike } from "./agents";
import { partsToText, partsHaveImage } from "./parts";

// Dev-only: talk to a local Ollama server instead of Bedrock, falling back
// to the real Bedrock-backed chat (built by `buildBedrockChat`) if Ollama is
// unreachable, errors, times out, or is asked to look at an image it can't
// handle. See README for setup — this only ever runs when
// import.meta.env.DEV is true; production always uses Bedrock.

const OLLAMA_BASE_URL = "http://localhost:11434";
export const OLLAMA_MODEL = "llama3.2:1b";
const OLLAMA_REQUEST_TIMEOUT_MS = 30000;
const OLLAMA_PING_TIMEOUT_MS = 1500;

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
```

- [ ] **Step 3: Rename the Gemini-fallback identifiers in `HybridChat`**

Replace:

```typescript
class HybridChat implements ChatLike {
  private history: OllamaMessage[];
  private geminiChat: ChatLike | null = null;

  constructor(
    systemInstruction: string,
    private buildGeminiChat: (history: Content[]) => ChatLike,
  ) {
    this.history = [{ role: "system", content: systemInstruction }];
  }

  private toGeminiHistory(): Content[] {
    return this.history
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  }

  private async fallbackToGemini(message: Part[]): Promise<string> {
    if (!this.geminiChat) {
      // Hand off with whatever context was already gathered locally, so switching
      // backends mid-conversation doesn't lose the thread.
      this.geminiChat = this.buildGeminiChat(this.toGeminiHistory());
    }
    const response = await this.geminiChat.sendMessage({ message });
    return response.text ?? "";
  }

  async sendMessage({ message }: { message: Part[] }): Promise<{ text: string }> {
    // Once we've fallen back for this session, stay on Gemini — Ollama history
    // and Gemini history have diverged and reconciling them isn't worth it.
    if (this.geminiChat) {
      return { text: await this.fallbackToGemini(message) };
    }

    const userText = partsToText(message);

    if (partsHaveImage(message)) {
      console.warn("Local model can't process images — using Gemini for this message.");
      return { text: await this.fallbackToGemini(message) };
    }

    const attempt = [...this.history, { role: "user" as const, content: userText }];

    try {
      const text = await ollamaChatCompletion(attempt);
      this.history = [...attempt, { role: "assistant" as const, content: text }];
      return { text };
    } catch (err) {
      console.warn("Ollama request failed, falling back to Gemini for the rest of this session:", err);
      this.history = attempt;
      return { text: await this.fallbackToGemini(message) };
    }
  }
}
```

with:

```typescript
class HybridChat implements ChatLike {
  private history: OllamaMessage[];
  private bedrockChat: ChatLike | null = null;

  constructor(
    systemInstruction: string,
    private buildBedrockChat: (history: Content[]) => ChatLike,
  ) {
    this.history = [{ role: "system", content: systemInstruction }];
  }

  private toBedrockHistory(): Content[] {
    return this.history
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  }

  private async fallbackToBedrock(message: Part[]): Promise<string> {
    if (!this.bedrockChat) {
      // Hand off with whatever context was already gathered locally, so switching
      // backends mid-conversation doesn't lose the thread.
      this.bedrockChat = this.buildBedrockChat(this.toBedrockHistory());
    }
    const response = await this.bedrockChat.sendMessage({ message });
    return response.text ?? "";
  }

  async sendMessage({ message }: { message: Part[] }): Promise<{ text: string }> {
    // Once we've fallen back for this session, stay on Bedrock — Ollama history
    // and Bedrock history have diverged and reconciling them isn't worth it.
    if (this.bedrockChat) {
      return { text: await this.fallbackToBedrock(message) };
    }

    const userText = partsToText(message);

    if (partsHaveImage(message)) {
      // Ollama's local model can't process images either way (only the text
      // portion of `message` ever reaches it below), so route straight to
      // Bedrock, which at least acknowledges the photo instead of silently
      // dropping it (see services/bedrockChat.ts).
      console.warn("Local model can't process images — using Bedrock for this message.");
      return { text: await this.fallbackToBedrock(message) };
    }

    const attempt = [...this.history, { role: "user" as const, content: userText }];

    try {
      const text = await ollamaChatCompletion(attempt);
      this.history = [...attempt, { role: "assistant" as const, content: text }];
      return { text };
    } catch (err) {
      console.warn("Ollama request failed, falling back to Bedrock for the rest of this session:", err);
      this.history = attempt;
      return { text: await this.fallbackToBedrock(message) };
    }
  }
}
```

- [ ] **Step 4: Rename the exported factory function**

Replace:

```typescript
/**
 * Builds a Chat-shaped agent that prefers a local Ollama model and transparently
 * falls back to Gemini. Only meant to be called when import.meta.env.DEV is true.
 */
export const createHybridAgent = (
  systemInstruction: string,
  buildGeminiChat: (history: Content[]) => ChatLike,
): ChatLike => new HybridChat(systemInstruction, buildGeminiChat);
```

with:

```typescript
/**
 * Builds a Chat-shaped agent that prefers a local Ollama model and transparently
 * falls back to Bedrock. Only meant to be called when import.meta.env.DEV is true.
 */
export const createHybridAgent = (
  systemInstruction: string,
  buildBedrockChat: (history: Content[]) => ChatLike,
): ChatLike => new HybridChat(systemInstruction, buildBedrockChat);
```

- [ ] **Step 5: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors from `services/parts.ts` or `services/ollamaChat.ts`. (`App.tsx` and `services/agents.ts` will still show errors referencing the old `createAgent`/`createAgentWithHistory` signatures at this point — that's expected until Tasks 9 and 11 land. If your TypeScript setup errors out entirely rather than listing per-file errors, skip this check here and rely on Task 11's full-project typecheck instead.)

- [ ] **Step 6: Commit**

```bash
git add services/parts.ts services/ollamaChat.ts
git commit -m "Extract shared Part[] helpers, rename Gemini fallback naming to Bedrock"
```

---

### Task 8: `services/bedrockChat.ts` — production chat backend

**Files:**
- Create: `services/bedrockChat.ts`

**Interfaces:**
- Produces: `createBedrockAgent(systemInstruction: string, seedHistory?: Content[]): ChatLike` — consumed by `services/agents.ts` (Task 9).
- Consumes: `ChatLike` (type-only, from `services/agents.ts` — this is a type-only import so it does not create a runtime circular dependency even though `agents.ts` will import from this file in Task 9), `partsToText`/`partsHaveImage` from `services/parts.ts` (Task 7), `import.meta.env.VITE_AI_WORKER_URL`.

- [ ] **Step 1: Create `services/bedrockChat.ts`**

```typescript
import type { Content, Part } from "@google/genai";
import type { ChatLike } from "./agents";
import { partsToText, partsHaveImage } from "./parts";

const AI_WORKER_URL = import.meta.env.VITE_AI_WORKER_URL as string | undefined;

const IMAGE_UNAVAILABLE_NOTE =
  "\n\n[The user attached a photo, but this AI can't view images. Gently ask them to describe what it shows.]";

async function chatCompletion(systemInstruction: string, history: Content[], message: Part[]): Promise<string> {
  if (!AI_WORKER_URL) throw new Error("VITE_AI_WORKER_URL is not configured");

  const res = await fetch(`${AI_WORKER_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemInstruction, history, message }),
  });
  if (!res.ok) throw new Error(`AI worker responded ${res.status}`);

  const data = await res.json();
  if (typeof data?.text !== "string") throw new Error("AI worker response missing text");
  return data.text;
}

class BedrockChat implements ChatLike {
  private history: Content[];

  constructor(private systemInstruction: string, seedHistory: Content[] = []) {
    this.history = seedHistory;
  }

  async sendMessage({ message }: { message: Part[] }): Promise<{ text: string }> {
    // Llama 3 8B Instruct is text-only — if a photo is attached, drop the
    // image data (never sent over the network) and let the model know it's
    // there so it can ask the user to describe it, rather than silently
    // responding as if no image existed.
    const outgoing: Part[] = partsHaveImage(message)
      ? [{ text: partsToText(message) + IMAGE_UNAVAILABLE_NOTE }]
      : message;

    const text = await chatCompletion(this.systemInstruction, this.history, outgoing);

    this.history = [
      ...this.history,
      { role: "user", parts: outgoing },
      { role: "model", parts: [{ text }] },
    ];

    return { text };
  }
}

export const createBedrockAgent = (systemInstruction: string, seedHistory: Content[] = []): ChatLike =>
  new BedrockChat(systemInstruction, seedHistory);
```

- [ ] **Step 2: Commit**

```bash
git add services/bedrockChat.ts
git commit -m "Add Bedrock-backed ChatLike implementation"
```

---

### Task 9: Update `services/agents.ts` to use Bedrock instead of Gemini

**Files:**
- Modify: `services/agents.ts`

**Interfaces:**
- Consumes: `createBedrockAgent` from `services/bedrockChat.ts` (Task 8).
- Produces: `createAgent(basePrompt: string, userProfile: UserProfile): ChatLike`, `createAgentWithHistory(basePrompt: string, userProfile: UserProfile, history: Content[]): ChatLike` — both drop the `ai: GoogleGenAI` parameter they had before. Consumed by `App.tsx` (Task 11).

- [ ] **Step 1: Update imports**

In `services/agents.ts`, replace:

```typescript
import { GoogleGenAI, Chat } from "@google/genai";
import type { Content, Part } from "@google/genai";
import type { UserProfile } from "../types";
```

with:

```typescript
import type { Content, Part } from "@google/genai";
import type { UserProfile } from "../types";
import { createBedrockAgent } from "./bedrockChat";
```

- [ ] **Step 2: Replace `createAgent` and `createAgentWithHistory`**

Replace:

```typescript
/**
 * Creates a new chat instance with a specific system instruction and user context.
 * @param ai The GoogleGenAI instance.
 * @param basePrompt The base prompt for the agent.
 * @param userProfile The user's profile data.
 * @returns A new Chat instance.
 */
export const createAgent = (ai: GoogleGenAI, basePrompt: string, userProfile: UserProfile): Chat => {
  const systemInstruction = buildSystemInstruction(basePrompt, userProfile);

  return ai.chats.create({
    model: "gemini-flash-lite-latest",
    config: {
      systemInstruction,
      temperature: 0.3,
    },
  });
};

/**
 * Same as createAgent, but seeds the chat with prior conversation turns.
 * Used when the local-model fallback (services/ollamaChat.ts) has to hand a
 * mid-conversation session over to Gemini and needs Gemini to have the context.
 */
export const createAgentWithHistory = (
  ai: GoogleGenAI,
  basePrompt: string,
  userProfile: UserProfile,
  history: Content[],
): Chat => {
  const systemInstruction = buildSystemInstruction(basePrompt, userProfile);

  return ai.chats.create({
    model: "gemini-flash-lite-latest",
    config: {
      systemInstruction,
      temperature: 0.3,
    },
    history,
  });
};
```

with:

```typescript
/**
 * Creates a new chat instance with a specific system instruction and user context.
 * @param basePrompt The base prompt for the agent.
 * @param userProfile The user's profile data.
 * @returns A ChatLike backed by the ai-worker Bedrock proxy.
 */
export const createAgent = (basePrompt: string, userProfile: UserProfile): ChatLike => {
  const systemInstruction = buildSystemInstruction(basePrompt, userProfile);
  return createBedrockAgent(systemInstruction);
};

/**
 * Same as createAgent, but seeds the chat with prior conversation turns.
 * Used when the local-model fallback (services/ollamaChat.ts) has to hand a
 * mid-conversation session over to Bedrock and needs it to have the context.
 */
export const createAgentWithHistory = (
  basePrompt: string,
  userProfile: UserProfile,
  history: Content[],
): ChatLike => {
  const systemInstruction = buildSystemInstruction(basePrompt, userProfile);
  return createBedrockAgent(systemInstruction, history);
};
```

- [ ] **Step 3: Verify `Part` is still used**

`Part` is still referenced by the `ChatLike` interface definition further up in the same file (`sendMessage(params: { message: Part[] }): ...`), so the import stays. No action needed — just confirm this while editing so the import isn't accidentally left unused.

- [ ] **Step 4: Commit**

```bash
git add services/agents.ts
git commit -m "Point services/agents.ts chat factories at Bedrock instead of Gemini"
```

---

### Task 10: Rename `geminiService.ts` to `reportService.ts`, call `/api/structured`

**Files:**
- Create: `services/reportService.ts` (full replacement content below)
- Delete: `services/geminiService.ts`

**Interfaces:**
- Produces: `generateReport(messages: Message[], userProfile: UserProfile): Promise<{ report: ReportData; recipients: Recipient[] }>`, `generateResources(messages: Message[], userProfile: UserProfile): Promise<{ resources: Resource[] }>` — both drop the `ai: GoogleGenAI` parameter they had before. Consumed by `App.tsx` (Task 11).
- Consumes: `import.meta.env.VITE_AI_WORKER_URL`.

- [ ] **Step 1: Create `services/reportService.ts`**

```typescript
import type { Message, ReportData, Recipient, UserProfile, Resource } from '../types';
import { MessageAuthor } from '../types';

const AI_WORKER_URL = import.meta.env.VITE_AI_WORKER_URL as string | undefined;

async function generateStructured<T>(prompt: string, schema: string): Promise<T> {
    if (!AI_WORKER_URL) throw new Error('VITE_AI_WORKER_URL is not configured');

    const res = await fetch(`${AI_WORKER_URL}/api/structured`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, schema }),
    });
    if (!res.ok) throw new Error('The AI returned an invalid report format. Please try again.');
    return res.json();
}

const REPORT_SCHEMA = `{
  "report": {
    "date": string,        // Date and approximate time of the incident. If not specified, "Not specified".
    "location": string,    // The location where the incident occurred. If not specified, "Not specified".
    "involved": string,    // Names or descriptions of individuals involved, including the user, alleged perpetrator(s), and witnesses. If not specified, "Not specified".
    "description": string, // Detailed, chronological, objective account of events as described by the user. Quote directly where possible. If not enough detail, "Not specified".
    "impact": string       // Emotional, physical, or professional impact on the individual, as described by them. If not specified, "Not specified".
  },
  "recipients": [
    { "name": string, "description": string } // 3-5 potential official/authoritative recipients, e.g. "Local Police Department", "Company HR Manager", "University Title IX Office". "description" briefly explains why this recipient might be appropriate.
  ]
}`;

const RESOURCE_SCHEMA = `{
  "resources": [
    { "name": string, "description": string, "contact": string } // 3-5 relevant local/national support resources. "name" = organization name, "description" = one-sentence description of what it does and why it's relevant, "contact" = website URL or phone number.
  ]
}`;

export const generateReport = async (messages: Message[], userProfile: UserProfile): Promise<{ report: ReportData; recipients: Recipient[] }> => {
    const chatHistory = messages
        .filter(m => m.author !== MessageAuthor.AI || !m.text.startsWith("Hello. I'm here to listen")) // Filter out initial greeting
        .map(m => `${m.author === MessageAuthor.USER ? 'Person' : 'Assistant'}: ${m.text} ${m.image ? '[User provided an image]' : ''}`)
        .join('\n');

    const prompt = `
User Profile Context:
- Location: ${userProfile.location}
- Gender: ${userProfile.gender}

Based on the following conversation, extract the relevant details and structure them into a formal incident report. The user has given their consent to create this draft. Be objective and stick strictly to the facts provided in the conversation. If a piece of information for a field is missing from the conversation, you must state 'Not specified' for that field. The report should be professional and suitable for submission to HR, legal counsel, or authorities. Also generate a list of credible or official contacts relevant to the incident's context.\n\nConversation:\n${chatHistory}`;

    return generateStructured<{ report: ReportData; recipients: Recipient[] }>(prompt, REPORT_SCHEMA);
};

export const generateResources = async (messages: Message[], userProfile: UserProfile): Promise<{ resources: Resource[] }> => {
    const chatHistory = messages
        .filter(m => m.author !== MessageAuthor.AI || !m.text.startsWith("Hello. I'm here to listen"))
        .map(m => `${m.author === MessageAuthor.USER ? 'Person' : 'Assistant'}: ${m.text}`)
        .join('\n');

    // Hardcoded Vancouver resources
    const vancouverResources: Resource[] = [
      {
        name: "VictimLinkBC",
        description: "24/7 crisis support and information for victims of crime, including sexual and domestic violence, in BC.",
        contact: "https://victimlinkbc.ca/"
      },
      {
        name: "Ending Violence BC Services Directory",
        description: "Comprehensive directory of anti-violence services and support organizations in British Columbia.",
        contact: "https://endingviolence.org/services-directory/"
      },
      {
        name: "Ending Violence Canada Sexual Assault Centres & Crisis Lines",
        description: "National directory of sexual assault centres, crisis lines, and support services across Canada.",
        contact: "https://endingviolencecanada.org/sexual-assault-centres-crisis-lines-and-support-services/"
      },
      {
        name: "Surrey Women's Centre",
        description: "Support services for women in Surrey including crisis intervention, counseling, and advocacy.",
        contact: "https://www.surreywomenscentre.ca/"
      },
      {
        name: "Vancouver Rape Relief & Women's Shelter",
        description: "Transition house and rape crisis services for women and children fleeing violence in Vancouver.",
        contact: "https://www.rapereliefshelter.bc.ca/"
      },
      {
        name: "Tri-City Transitions",
        description: "Transition house providing emergency shelter and support for women and children fleeing abuse in Coquitlam, Port Coquitlam, and Port Moody.",
        contact: "https://www.tricitytransitions.ca/"
      }
    ];

    // Check if user is in Greater Vancouver
    const locationStr = userProfile.location?.toLowerCase() || "";
    const isVancouver = locationStr.includes("vancouver") || locationStr.includes("burnaby") || locationStr.includes("richmond") || locationStr.includes("surrey") || locationStr.includes("coquitlam") || locationStr.includes("new westminster") || locationStr.includes("delta") || locationStr.includes("langley") || locationStr.includes("north vancouver") || locationStr.includes("west vancouver");

    // UBC proximity: Point Grey, UBC, Kitsilano, West Point Grey area
    const isNearUBC = locationStr.includes("ubc") || locationStr.includes("point grey") || locationStr.includes("kitsilano") || locationStr.includes("west point grey");

    // SFU proximity: Burnaby Mountain, SFU, Simon Fraser
    const isNearSFU = locationStr.includes("sfu") || locationStr.includes("simon fraser") || locationStr.includes("burnaby mountain");

    // Student-related keywords in conversation context
    const chatLower = chatHistory.toLowerCase();
    const mentionsUBC = chatLower.includes("ubc") || chatLower.includes("university of british columbia");
    const mentionsSFU = chatLower.includes("sfu") || chatLower.includes("simon fraser");
    const mentionsStudent = chatLower.includes("student") || chatLower.includes("campus") || chatLower.includes("university") || chatLower.includes("college");

    const ubcResources: Resource[] = [
      {
        name: "Salal Sexual Violence Support Centre (SVSC)",
        description: "Provides support, advocacy, and counseling for survivors of sexual violence in Greater Vancouver, including support for UBC community members.",
        contact: "https://www.salalsvsc.ca/"
      },
      {
        name: "AMS Sexual Assault Support Centre (SASC) — UBC",
        description: "Free, confidential support for UBC students affected by sexual violence. Offers crisis support, advocacy, and referrals. Run by the AMS student society.",
        contact: "https://www.ams.ubc.ca/support-services/sasc/"
      }
    ];

    const sfuResources: Resource[] = [
      {
        name: "Sexual Violence Support & Prevention Office — SFU",
        description: "Free support for SFU students affected by sexual violence or harassment. After an initial intake interview, students can access free ongoing counseling. Provides confidential advocacy and resources.",
        contact: "https://www.sfu.ca/sexual-violence-support.html"
      }
    ];

    const prompt = `
User Profile Context:
- Location: ${userProfile.location}
- Gender: ${userProfile.gender}

Based on the following conversation, please compile a list of relevant local and national support resources for the user. These could include crisis hotlines, legal aid services, counseling centers, or shelters. Focus on resources that are most applicable to the user's situation as described in the conversation and their location. Provide 3-5 distinct resources.

Conversation:
${chatHistory}`;

    const parsedJson = await generateStructured<{ resources?: Resource[] }>(prompt, RESOURCE_SCHEMA);
    let resources: Resource[] = parsedJson.resources || [];
    if (isVancouver) {
      const contextResources: Resource[] = [...vancouverResources];

      // Add UBC resources if near UBC campus or user mentions UBC/being a student
      if (isNearUBC || mentionsUBC || ((isNearSFU || mentionsSFU) === false && mentionsStudent)) {
        contextResources.push(...ubcResources);
      }

      // Add SFU resources if near SFU or user mentions SFU
      if (isNearSFU || mentionsSFU) {
        contextResources.push(...sfuResources);
      }

      // Prepend context resources, remove duplicates by name
      const allResources = [...contextResources, ...resources];
      const seen = new Set<string>();
      resources = allResources.filter(r => {
        if (seen.has(r.name)) return false;
        seen.add(r.name);
        return true;
      });
    }
    return { resources };
};
```

- [ ] **Step 2: Delete `services/geminiService.ts`**

Run: `rm services/geminiService.ts` (or `Remove-Item services/geminiService.ts` on PowerShell)

- [ ] **Step 3: Commit**

```bash
git add services/reportService.ts
git rm services/geminiService.ts
git commit -m "Rename geminiService.ts to reportService.ts, call ai-worker /api/structured"
```

---

### Task 11: Update `App.tsx`

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `createAgent(basePrompt, userProfile)`, `createAgentWithHistory(basePrompt, userProfile, history)` from Task 9; `generateReport(messages, userProfile)`, `generateResources(messages, userProfile)` from Task 10.

- [ ] **Step 1: Update the report/resource-service import**

Replace:

```typescript
import { generateReport, generateResources } from './services/geminiService';
```

with:

```typescript
import { generateReport, generateResources } from './services/reportService';
```

- [ ] **Step 2: Decouple `handleStartChat` from `aiRef.current`**

Replace:

```typescript
  // ── Start chat ─────────────────────────────────────────────
  const handleStartChat = useCallback((prompt?: string) => {
    if (!aiRef.current) {
      setError('AI service is not available. Please check your API key and refresh.');
      return;
    }
    if (prompt) setInitialPrompt(prompt);

    try {
      // hospitalData/liveContext come from the top-level derivation above and
      // are recomputed every render — but note this is still just a snapshot
      // at whatever moment handleStartChat runs. ChatScreen re-sends a fresh
      // copy of liveContext on every message, which is what actually keeps
      // the AI's hospital/resource data current through the whole session.
      const userProfileWithHospitals = { ...userProfile, hospitalData };
      const ai = aiRef.current;

      // Dev-only: route through the local Ollama model, falling back to Gemini
      // mid-session if it's unavailable or errors. See services/ollamaChat.ts.
      const makeAgent = (basePrompt: string): ChatLike => {
        if (!useLocalModelRef.current) return createAgent(ai, basePrompt, userProfileWithHospitals);
        return createHybridAgent(
          buildSystemInstruction(basePrompt, userProfileWithHospitals),
          history => createAgentWithHistory(ai, basePrompt, userProfileWithHospitals, history),
        );
      };
```

with:

```typescript
  // ── Start chat ─────────────────────────────────────────────
  const handleStartChat = useCallback((prompt?: string) => {
    if (prompt) setInitialPrompt(prompt);

    try {
      // hospitalData/liveContext come from the top-level derivation above and
      // are recomputed every render — but note this is still just a snapshot
      // at whatever moment handleStartChat runs. ChatScreen re-sends a fresh
      // copy of liveContext on every message, which is what actually keeps
      // the AI's hospital/resource data current through the whole session.
      const userProfileWithHospitals = { ...userProfile, hospitalData };

      // Dev-only: route through the local Ollama model, falling back to Bedrock
      // mid-session if it's unavailable or errors. See services/ollamaChat.ts.
      const makeAgent = (basePrompt: string): ChatLike => {
        if (!useLocalModelRef.current) return createAgent(basePrompt, userProfileWithHospitals);
        return createHybridAgent(
          buildSystemInstruction(basePrompt, userProfileWithHospitals),
          history => createAgentWithHistory(basePrompt, userProfileWithHospitals, history),
        );
      };
```

- [ ] **Step 3: Drop the `ai` argument in `handleGenerateReport`**

Replace:

```typescript
  const handleGenerateReport = useCallback(async () => {
    setIsGeneratingReport(true);
    setError(null);
    try {
      if (!aiRef.current) throw new Error('AI not initialized');
      const result = await generateReport(aiRef.current, messages, userProfile);
      setReportData(result.report);
```

with:

```typescript
  const handleGenerateReport = useCallback(async () => {
    setIsGeneratingReport(true);
    setError(null);
    try {
      const result = await generateReport(messages, userProfile);
      setReportData(result.report);
```

- [ ] **Step 4: Drop the `ai` argument in `handleGenerateResources`**

Replace:

```typescript
  const handleGenerateResources = useCallback(async () => {
    setIsGeneratingResources(true);
    setError(null);
    try {
      if (!aiRef.current) throw new Error('AI not initialized');
      const result = await generateResources(aiRef.current, messages, userProfile);
      setResources(result.resources);
```

with:

```typescript
  const handleGenerateResources = useCallback(async () => {
    setIsGeneratingResources(true);
    setError(null);
    try {
      const result = await generateResources(messages, userProfile);
      setResources(result.resources);
```

- [ ] **Step 5: Confirm `aiRef`/`GoogleGenAI` stay in place for voice chat**

No change needed here — just verify while editing that `aiRef` (declared near the top of the component, initialized in the "Init AI" `useEffect`, and passed as the `ai={aiRef.current}` prop to `ChatScreen`) is untouched. It now exists solely to support `ChatScreen`'s voice chat feature.

- [ ] **Step 6: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors. If there are errors outside `App.tsx`, `services/agents.ts`, `services/ollamaChat.ts`, `services/bedrockChat.ts`, or `services/reportService.ts`, investigate before proceeding — something outside this migration's scope may have broken.

- [ ] **Step 7: Commit**

```bash
git add App.tsx
git commit -m "Point App.tsx at Bedrock-backed agents; decouple text chat from aiRef"
```

---

### Task 12: Update `.env.example` and `README.md`

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Update `.env.example`**

Replace the full file with:

```
GEMINI_API_KEY=

# Required for voice chat only (services/ollamaChat.ts's dev fallback and
# generateReport/generateResources no longer use Gemini — see
# VITE_AI_WORKER_URL below). Voice chat (ChatScreen.tsx's startVoiceChat)
# still uses Gemini's Live API directly from the browser.

# Required. Points the app at your deployed ai-worker/ (see ai-worker/README.md),
# which proxies chat and report/resource generation to AWS Bedrock.
VITE_AI_WORKER_URL=

# Optional. Set after deploying worker/ — points the app at your own cached
# proxy instead of calling edwaittimes.ca directly. See worker/README.md.
VITE_WAIT_TIMES_API_URL=

# Optional, defaults to off. When "true", the app tries a local Ollama model
# (services/ollamaChat.ts) before Bedrock, on every build including production
# — only whoever's machine is actually running Ollama benefits; everyone else
# fails the reachability check instantly and uses Bedrock as normal. Set to
# "false" (or remove) once there's a real cloud AI backend in place.
VITE_ENABLE_LOCAL_MODEL=false
```

- [ ] **Step 2: Update `README.md`'s "Run Locally" section**

Replace:

```markdown
## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
```

with:

```markdown
## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Deploy `ai-worker/` (see [ai-worker/README.md](ai-worker/README.md)) and set
   `VITE_AI_WORKER_URL` in [.env.local](.env.local) to its URL. This powers chat,
   incident reports, and resource generation via AWS Bedrock.
3. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key —
   this is only used for voice chat.
4. Run the app:
   `npm run dev`
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "Document ai-worker setup in README and .env.example"
```

---

### Task 13: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the Worker**

Run: `cd ai-worker && npm run dev` (leave running)

- [ ] **Step 2: Point the frontend at the local Worker**

In the project root, ensure `.env.local` has:

```
VITE_AI_WORKER_URL=http://localhost:8787
GEMINI_API_KEY=<your Gemini key, for voice chat>
```

- [ ] **Step 3: Start the frontend**

Run: `npm run dev` (leave running)

- [ ] **Step 4: Walk through the app in a browser**

1. Open the app, accept the privacy screen, start a chat.
2. Send a message describing a hypothetical situation (e.g. "someone at my work has been making me uncomfortable") — confirm you get a coherent, in-character `INFO` agent reply (not an error).
3. Ask something like "where's the nearest hospital" — confirm routing switches to the `MAP`/`LOCATION` agent and a hospital-shaped reply comes back.
4. Send an off-topic message like "hi, how are you" — confirm the `OFFTOPIC` agent responds appropriately.
5. Attach a photo to a message (if the UI exposes this) and send it — confirm the reply acknowledges it can't view the photo and asks you to describe it, rather than ignoring the attachment silently or erroring.
6. Trigger report generation — confirm a report renders with populated fields (not an error banner).
7. Trigger resource generation — confirm a resource list renders, including the hardcoded Vancouver/UBC/SFU resources if your test location matches.
8. Start voice chat — confirm it still connects and works exactly as before (this path is untouched and should still be hitting Gemini directly, not `ai-worker`).

- [ ] **Step 5: Confirm the dev-only Ollama fallback still works (optional, only if you have Ollama installed)**

Set `VITE_ENABLE_LOCAL_MODEL=true` in `.env.local`, run `ollama pull llama3.2:1b` and start Ollama locally, restart `npm run dev`, and repeat a chat exchange — confirm replies come from the local model (check the console info log), and that stopping Ollama mid-session causes a fallback to the Bedrock-backed path rather than an error.

- [ ] **Step 6: No commit for this task** — it's verification only. If any step fails, go back to the relevant earlier task and fix it there (with its own commit), rather than patching ad hoc here.

---

## Addendum: context-overflow fix (Tasks 14-16)

Task 13's live verification against real Bedrock found a reproducible, high-severity bug: multi-turn chat reliably returns HTTP 502 starting with the 2nd message in a session. Root cause, confirmed via a temporary diagnostic log against real Bedrock: `App.tsx`/`ChatScreen.tsx` embed live hospital data (unfiltered — all of them, not just the nearest few) and victim-support-resource data into every outgoing chat message, on every turn, to every agent — and each chat's `BedrockChat` instance additionally re-stores that same context-laden text into its own conversation history every turn, compounding it turn over turn. Combined with the system prompts, this blows past Llama 3 8B Instruct's 8,192-token context window (Gemini's much larger window meant this never surfaced before). The human partner reviewed this finding and approved fixing it by trimming context, while keeping the `ca-central-1` / Llama 3 8B Instruct choice (data residency intact).

Numeric capping alone isn't sufficient here — the fix must also stop persisting the live-context text into conversation history, otherwise each remembered turn keeps re-embedding a full copy of it and the budget is blown again after a couple of turns regardless of how small any single turn's context is. Task 14 caps the numbers; Task 15 stops the compounding; Task 16 re-verifies against real Bedrock.

### Task 14: Cap hospital context size in App.tsx

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- No signature changes — `hospitalContext` (a plain string, already consumed by `liveContext` in `App.tsx` and passed down to `ChatScreen.tsx`) just becomes shorter.

- [ ] **Step 1: Cap `hospitalContext` to the nearest few hospitals**

In `App.tsx`, replace:

```typescript
  const hospitalContext = hospitalData.length > 0
    ? '\n---\nHOSPITALS (pre-sorted nearest first, index 0 = closest). Use index 0 as the primary recommendation:\n' + JSON.stringify(hospitalData, null, 2) + '\n---'
    : '';
```

with:

```typescript
  // Capped to the nearest few before being embedded in every outgoing chat
  // message — the full list (dozens of hospitals from the wait-times API)
  // was blowing past Bedrock's 8192-token context window within 1-2 turns.
  // MAP_PROMPT only ever needs the primary recommendation plus a couple of
  // alternates for its "other nearby hospitals" section, so this doesn't
  // lose anything the prompts actually use. `victimSupportContext` below is
  // deliberately left uncapped — it's already small (~10 entries) and is
  // safety-critical crisis/support data, unlike the much larger hospital list.
  const HOSPITAL_CONTEXT_LIMIT = 5;
  const hospitalContext = hospitalData.length > 0
    ? '\n---\nHOSPITALS (pre-sorted nearest first, index 0 = closest, showing nearest ' +
      Math.min(HOSPITAL_CONTEXT_LIMIT, hospitalData.length) + ' of ' + hospitalData.length +
      '). Use index 0 as the primary recommendation:\n' +
      JSON.stringify(hospitalData.slice(0, HOSPITAL_CONTEXT_LIMIT), null, 2) + '\n---'
    : '';
```

Note: `hospitalData` itself (the full, uncapped array) is left untouched — it's also used to build `userProfileWithHospitals` elsewhere in `App.tsx`, which isn't part of what gets sent to the model. Only the JSON embedded in `hospitalContext` (the text actually sent to Bedrock) is capped.

- [ ] **Step 2: Verify the app still builds**

Run: `npm run build`
Expected: succeeds with zero errors (same as after Task 11).

- [ ] **Step 3: Commit**

```bash
git add App.tsx
git commit -m "Cap hospital context sent to chat agents to nearest 5"
```

---

### Task 15: Stop persisting ephemeral live-context into chat history

**Files:**
- Modify: `services/agents.ts`
- Modify: `services/bedrockChat.ts`
- Modify: `services/ollamaChat.ts`
- Modify: `components/ChatScreen.tsx`

**Interfaces:**
- `ChatLike.sendMessage` gains an optional second field: `sendMessage(params: { message: Part[]; ephemeralContext?: string }): Promise<{ text?: string }>`. `ephemeralContext` must be included in the request sent to the model for the current turn, but must NOT be persisted into whatever conversation history the implementation keeps for subsequent turns.
- Consumed by: `components/ChatScreen.tsx`'s two `sendMessage` call sites (Task 15 also updates these).

- [ ] **Step 1: Widen the `ChatLike` interface in `services/agents.ts`**

Replace:

```typescript
// Minimal structural interface both the real Gemini `Chat` and the local-model
// fallback wrapper (services/ollamaChat.ts) satisfy, so callers don't need to
// know which one they got.
export interface ChatLike {
  sendMessage(params: { message: Part[] }): Promise<{ text?: string }>;
}
```

with:

```typescript
// Minimal structural interface both the Bedrock-backed chat (services/bedrockChat.ts)
// and the local-model fallback wrapper (services/ollamaChat.ts) satisfy, so callers
// don't need to know which one they got.
export interface ChatLike {
  // `ephemeralContext` carries state that must be visible to the model THIS
  // turn (live hospital/resource data, current timestamp) but must never be
  // persisted into conversation history — history is resent on every call,
  // so anything stored there compounds every turn. Implementations must
  // include it in the request sent to the model but exclude it from what
  // gets remembered for next turn.
  sendMessage(params: { message: Part[]; ephemeralContext?: string }): Promise<{ text?: string }>;
}
```

Also fix a stale comment a few lines below (still references the file Task 10 renamed away from) — replace:

```typescript
// Add new organizations here AND in services/geminiService.ts (vancouverResources,
```

with:

```typescript
// Add new organizations here AND in services/reportService.ts (vancouverResources,
```

- [ ] **Step 2: Update `services/bedrockChat.ts` to thread and exclude `ephemeralContext`**

Replace the full file with:

```typescript
import type { Content, Part } from "@google/genai";
import type { ChatLike } from "./agents";
import { partsToText, partsHaveImage } from "./parts";

const AI_WORKER_URL = import.meta.env.VITE_AI_WORKER_URL as string | undefined;

const IMAGE_UNAVAILABLE_NOTE =
  "\n\n[The user attached a photo, but this AI can't view images. Gently ask them to describe what it shows.]";

// Live hospital/resource context is resent on every turn (see ChatScreen.tsx's
// `ephemeralContext`) and would otherwise compound without bound if stored in
// history — capping to a small number of real exchanges keeps token usage
// predictable regardless of how long the conversation runs.
const MAX_HISTORY_ENTRIES = 8;

async function chatCompletion(systemInstruction: string, history: Content[], message: Part[]): Promise<string> {
  if (!AI_WORKER_URL) throw new Error("VITE_AI_WORKER_URL is not configured");

  const res = await fetch(`${AI_WORKER_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemInstruction, history, message }),
  });
  if (!res.ok) throw new Error(`AI worker responded ${res.status}`);

  const data = await res.json();
  if (typeof data?.text !== "string") throw new Error("AI worker response missing text");
  return data.text;
}

class BedrockChat implements ChatLike {
  private history: Content[];

  constructor(private systemInstruction: string, seedHistory: Content[] = []) {
    this.history = seedHistory;
  }

  async sendMessage({ message, ephemeralContext }: { message: Part[]; ephemeralContext?: string }): Promise<{ text: string }> {
    // Llama 3 8B Instruct is text-only — if a photo is attached, drop the
    // image data (never sent over the network) and let the model know it's
    // there so it can ask the user to describe it, rather than silently
    // responding as if no image existed.
    const outgoing: Part[] = partsHaveImage(message)
      ? [{ text: partsToText(message) + IMAGE_UNAVAILABLE_NOTE }]
      : message;

    // ephemeralContext (live hospital/resource data, current timestamp) is
    // appended for THIS request only — it's deliberately excluded from what
    // gets stored in `this.history` below, so it doesn't get resent (and
    // compounded) on every subsequent turn.
    const requestParts: Part[] = ephemeralContext
      ? [...outgoing, { text: ephemeralContext }]
      : outgoing;

    const text = await chatCompletion(this.systemInstruction, this.history, requestParts);

    this.history = [
      ...this.history,
      { role: "user", parts: outgoing },
      { role: "model", parts: [{ text }] },
    ].slice(-MAX_HISTORY_ENTRIES);

    return { text };
  }
}

export const createBedrockAgent = (systemInstruction: string, seedHistory: Content[] = []): ChatLike =>
  new BedrockChat(systemInstruction, seedHistory);
```

- [ ] **Step 3: Update `services/ollamaChat.ts` to thread `ephemeralContext` through, without persisting it**

Replace:

```typescript
  private async fallbackToBedrock(message: Part[]): Promise<string> {
    if (!this.bedrockChat) {
      // Hand off with whatever context was already gathered locally, so switching
      // backends mid-conversation doesn't lose the thread.
      this.bedrockChat = this.buildBedrockChat(this.toBedrockHistory());
    }
    const response = await this.bedrockChat.sendMessage({ message });
    return response.text ?? "";
  }

  async sendMessage({ message }: { message: Part[] }): Promise<{ text: string }> {
    // Once we've fallen back for this session, stay on Bedrock — Ollama history
    // and Bedrock history have diverged and reconciling them isn't worth it.
    if (this.bedrockChat) {
      return { text: await this.fallbackToBedrock(message) };
    }

    const userText = partsToText(message);

    if (partsHaveImage(message)) {
      // Ollama's local model can't process images either way (only the text
      // portion of `message` ever reaches it below), so route straight to
      // Bedrock, which at least acknowledges the photo instead of silently
      // dropping it (see services/bedrockChat.ts).
      console.warn("Local model can't process images — using Bedrock for this message.");
      return { text: await this.fallbackToBedrock(message) };
    }

    const attempt = [...this.history, { role: "user" as const, content: userText }];

    try {
      const text = await ollamaChatCompletion(attempt);
      this.history = [...attempt, { role: "assistant" as const, content: text }];
      return { text };
    } catch (err) {
      console.warn("Ollama request failed, falling back to Bedrock for the rest of this session:", err);
      this.history = attempt;
      return { text: await this.fallbackToBedrock(message) };
    }
  }
```

with:

```typescript
  private async fallbackToBedrock(message: Part[], ephemeralContext?: string): Promise<string> {
    if (!this.bedrockChat) {
      // Hand off with whatever context was already gathered locally, so switching
      // backends mid-conversation doesn't lose the thread.
      this.bedrockChat = this.buildBedrockChat(this.toBedrockHistory());
    }
    const response = await this.bedrockChat.sendMessage({ message, ephemeralContext });
    return response.text ?? "";
  }

  async sendMessage({ message, ephemeralContext }: { message: Part[]; ephemeralContext?: string }): Promise<{ text: string }> {
    // Once we've fallen back for this session, stay on Bedrock — Ollama history
    // and Bedrock history have diverged and reconciling them isn't worth it.
    if (this.bedrockChat) {
      return { text: await this.fallbackToBedrock(message, ephemeralContext) };
    }

    const userText = partsToText(message);

    if (partsHaveImage(message)) {
      // Ollama's local model can't process images either way (only the text
      // portion of `message` ever reaches it below), so route straight to
      // Bedrock, which at least acknowledges the photo instead of silently
      // dropping it (see services/bedrockChat.ts).
      console.warn("Local model can't process images — using Bedrock for this message.");
      return { text: await this.fallbackToBedrock(message, ephemeralContext) };
    }

    // ephemeralContext is appended for THIS request only, same as the Bedrock
    // path — persisted history keeps just the real message text, not the
    // live hospital/resource data resent every turn.
    const requestText = ephemeralContext ? `${userText}\n${ephemeralContext}` : userText;
    const attempt = [...this.history, { role: "user" as const, content: requestText }];

    try {
      const text = await ollamaChatCompletion(attempt);
      this.history = [...this.history, { role: "user" as const, content: userText }, { role: "assistant" as const, content: text }];
      return { text };
    } catch (err) {
      console.warn("Ollama request failed, falling back to Bedrock for the rest of this session:", err);
      this.history = [...this.history, { role: "user" as const, content: userText }];
      return { text: await this.fallbackToBedrock(message, ephemeralContext) };
    }
  }
```

Note this fixes the identical compounding-context bug for the dev-only Ollama fallback path too (it had the same flaw, just gated behind `VITE_ENABLE_LOCAL_MODEL` which defaults off) — `MAX_HISTORY_ENTRIES`-style capping for the Ollama-local history itself is deliberately NOT added here; that's out of scope for this fix (it's not the reported production bug, and local Ollama models are typically configured with much larger context windows).

- [ ] **Step 4: Update `components/ChatScreen.tsx` to pass `ephemeralContext` separately instead of bundling it into `parts`**

Replace:

```typescript
        const timeContext = `\n---\nCurrent date/time (Vancouver, PT): ${formatVancouverTimestamp()}\n---`;
        parts.push({ text: timeContext + liveContext });

        let responseText: string;

        // Always run the manager first to route every message to the right agent.
        if (!chats.manager) throw new Error("Manager agent not initialized.");
        const routerResult = await chats.manager.sendMessage({ message: parts });
        const route = (routerResult.text ?? '').trim();
```

with:

```typescript
        // Passed as `ephemeralContext` rather than folded into `parts` so
        // implementations (see services/bedrockChat.ts) can include it in
        // this request without persisting it into conversation history —
        // history is resent every turn, so anything stored there compounds
        // indefinitely and previously blew past Bedrock's context window
        // after just 1-2 turns.
        const timeContext = `\n---\nCurrent date/time (Vancouver, PT): ${formatVancouverTimestamp()}\n---`;
        const ephemeralContext = timeContext + liveContext;

        let responseText: string;

        // Always run the manager first to route every message to the right agent.
        if (!chats.manager) throw new Error("Manager agent not initialized.");
        const routerResult = await chats.manager.sendMessage({ message: parts, ephemeralContext });
        const route = (routerResult.text ?? '').trim();
```

And replace:

```typescript
        if (!nextAgentChat) throw new Error(`No agent available — all chat refs are null. Check API key and initialization.`);
        const agentResponse = await nextAgentChat.sendMessage({ message: parts });
        responseText = agentResponse.text ?? '';
```

with:

```typescript
        if (!nextAgentChat) throw new Error(`No agent available — all chat refs are null. Check API key and initialization.`);
        const agentResponse = await nextAgentChat.sendMessage({ message: parts, ephemeralContext });
        responseText = agentResponse.text ?? '';
```

- [ ] **Step 5: Verify the app builds and typechecks**

Run: `npm run build`
Expected: succeeds with zero errors.
Run: `npx tsc --noEmit`
Expected: only the pre-existing `ImportMeta.env` errors (same category/count as after Task 11/12 — not a new category), nothing related to `ChatLike`/`ephemeralContext`.

- [ ] **Step 6: Commit**

```bash
git add services/agents.ts services/bedrockChat.ts services/ollamaChat.ts components/ChatScreen.tsx
git commit -m "Stop persisting ephemeral live-context into chat history"
```

---

### Task 16: Re-verify multi-turn chat against real Bedrock

**Files:** none (verification only)

- [ ] **Step 1: Start both dev servers**

`cd ai-worker && npm run dev` (needs `ai-worker/.dev.vars` with real AWS credentials, same as Task 13), and `npm run dev` from the project root, with `.env.local` containing `VITE_AI_WORKER_URL=http://localhost:8787`.

- [ ] **Step 2: Reproduce the original failure is gone**

In a browser, start a chat and send **at least 5 consecutive messages** in the same session (a mix of INFO-agent and MAP-agent-triggering messages, e.g. repeat the scenarios from Task 13's Step 4.2-4.4). Confirm none of them return an error — specifically confirm the request that used to fail around message 2 now succeeds.

- [ ] **Step 3: Re-check the photo-attach flow**

As the 2nd or later message in a session (not the first, to specifically exercise the history-plus-context path), attach a photo and send it. Confirm the reply acknowledges it can't view the photo and asks the user to describe it (Task 13 couldn't verify this because the 502 hit first).

- [ ] **Step 4: No commit for this task** — verification only. If the 502 still reproduces, the context/history budget needs further tightening (e.g. lower `HOSPITAL_CONTEXT_LIMIT` or `MAX_HISTORY_ENTRIES` further) — treat that as a new BLOCKED finding to report, not something to silently patch further without visibility.


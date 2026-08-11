# AWS Bedrock Migration — Design

**Date:** 2026-08-10
**Status:** Approved, pending implementation plan

## Goal

Replace the app's use of Google Gemini for text-based AI features with AWS
Bedrock (Anthropic Claude Haiku 4.5), while leaving the Gemini-powered voice
chat feature untouched.

## Background

The app (`App.tsx`, `services/agents.ts`, `services/geminiService.ts`,
`services/ollamaChat.ts`) is a static React/Vite frontend that today
instantiates a `GoogleGenAI` client directly in the browser, with the Gemini
API key baked into the bundle at build time via `vite.config.ts`'s
`define`. It is used for:

1. Four chat agents (`MANAGER`, `INFO`, `MAP`/`LOCATION`, `DOCS`, plus
   `OFFTOPIC` routing) — plain, non-streaming request/response via
   `ai.chats.create` / `chat.sendMessage`.
2. Structured JSON generation for incident reports and support-resource
   lists (`services/geminiService.ts`), using Gemini's `responseSchema`
   JSON mode.
3. A dev-only local-model (Ollama) fallback (`services/ollamaChat.ts`) that
   falls back to Gemini when Ollama is unreachable, errors, times out, or is
   asked to handle an image.
4. A **voice chat** mode (`components/ChatScreen.tsx`, `startVoiceChat`)
   built on Gemini's **Live API** — a real-time, bidirectional audio
   streaming connection (`ai.live.connect`), fundamentally different from
   the request/response text agents.

## Key constraint

Unlike a Gemini API key, **AWS Bedrock authentication (SigV4-signed
requests using an AWS access key/secret, or an IAM-tied bearer token)
cannot be shipped to the browser** — anyone who downloaded the JS bundle
would get real AWS account credentials, not just a rate-limited API key.
This means Bedrock calls cannot be a like-for-like swap of the client-side
`GoogleGenAI` instantiation; they require a backend hop.

The project already has exactly this shape: `worker/` is a Cloudflare
Worker that proxies the wait-times API server-side. This design extends
that pattern with a second, independent Worker for AI calls.

## Scope decisions (confirmed with user)

- **Backend:** New Cloudflare Worker (`ai-worker/`), not AWS Lambda. Mirrors
  the existing `worker/` structure and deployment workflow.
- **Migration scope:** All text-based Gemini usage moves to Bedrock — the
  four chat agents, structured JSON report/resource generation, and the
  Ollama dev fallback's ultimate target. Nothing stays on Gemini in the
  text path.
- **Model:** Claude Haiku 4.5 on Bedrock — fast/cheap tier, appropriate for
  short turn-based support chat replies and forced-tool-call JSON output.
- **Voice chat:** Explicitly **out of scope** for this migration. It keeps
  using Gemini Live directly (`GEMINI_API_KEY` stays required client-side
  for this one feature). Bedrock has no direct equivalent to Gemini Live
  from Claude; the nearest analog (Amazon Nova Sonic, a different model
  family with a different bidirectional-streaming protocol) is a separate,
  larger effort and was deliberately deferred.
- **Abuse protection:** Beyond CORS/origin checking (which only constrains
  browsers, not scripts), the new Worker also applies a per-IP rate limit,
  since an unauthenticated LLM proxy is a materially different cost/abuse
  risk than the existing free, cached wait-times proxy.

## Architecture

```
Browser (React/Vite, static site)
  ├─ Text chat (MANAGER/INFO/MAP/DOCS agents) ──┐
  ├─ Report generation (JSON)                    ├──► ai-worker/ (new Cloudflare Worker)
  ├─ Resource generation (JSON)                   │        │ signs requests with aws4fetch
  ├─ Dev Ollama fallback target ──────────────────┘        ▼
  │                                               AWS Bedrock Runtime → Claude Haiku 4.5
  └─ Voice chat (Live API) ───────────────────► Gemini directly (unchanged)
```

`ai-worker/` signs requests to Bedrock's **Converse API** (not the raw,
model-specific `InvokeModel` body) using `aws4fetch`, a lightweight SigV4
signer that works in the Workers runtime without Node polyfills. Converse
is AWS's normalized request/response shape across model families, and it
covers everything needed here: system prompts, multi-turn history, inline
image content blocks, and forced tool-use calls for structured JSON output
(the Bedrock/Claude equivalent of Gemini's `responseSchema` mode).

### Worker endpoints

- **`POST /api/chat`** — replaces `createAgent` / `createAgentWithHistory`
  + `ChatLike.sendMessage`. Request body: `{ systemInstruction, history,
  message }`, where `message` is an array of `Part`-shaped blocks (text
  and/or inline image data, same shape already used by
  `services/ollamaChat.ts` and `services/agents.ts`). Response:
  `{ text }`.
- **`POST /api/structured`** — replaces `generateReport` /
  `generateResources`. Request body: `{ prompt, schema }`. Internally
  issues a Converse call with `toolConfig` forcing a single tool call whose
  `inputSchema` is the caller's JSON schema; Claude's tool-use response is
  parsed and returned as the structured JSON object.

Both endpoints:

- Reject requests whose `Origin` header isn't in a configured
  `ALLOWED_ORIGINS` list (same pattern as `worker/src/index.js`).
- Apply a per-IP rate limit — a KV-backed fixed-window counter keyed by the
  `CF-Connecting-IP` header (e.g. 20 requests/minute), chosen because it
  works on Cloudflare's free tier without requiring a Pro/Business plan's
  native rate-limiting rules. (Documented as upgradeable to Cloudflare's
  native rate-limiting rules later if desired.)
- On Bedrock failure (model access not enabled, throttling, AWS auth
  failure), return a 5xx/429 with a small JSON error body. Blocked-origin
  or rate-limited requests get 403/429 with no body leakage.

Secrets stored via `wrangler secret put`: `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `BEDROCK_MODEL_ID`,
`ALLOWED_ORIGINS`.

## Frontend changes

- **`services/agents.ts`**: `createAgent` / `createAgentWithHistory` drop
  their `ai: GoogleGenAI` parameter (no client SDK call needed for text
  agents anymore) and instead build a small `ChatLike`-implementing wrapper
  that POSTs to `ai-worker`'s `/api/chat`, keeping the running message
  history client-side — the same approach `services/ollamaChat.ts`
  already uses for its local history. `Part`/`Content` types continue to
  come from `@google/genai`, since that package remains a dependency for
  voice chat — no new type definitions needed.
- **`services/geminiService.ts` → renamed `services/reportService.ts`**:
  keeping the old filename would now be misleading, since it no longer
  calls Gemini. `generateReport` / `generateResources` drop the `ai`
  parameter and call `/api/structured` instead of
  `ai.models.generateContent`.
- **`services/ollamaChat.ts`**: the Gemini-fallback naming
  (`buildGeminiChat` parameter, surrounding comments) is renamed to
  reflect that the fallback target is now Bedrock (e.g.
  `buildBedrockChat`). Fallback logic (image detection, timeout, error
  handling) is unchanged.
- **`App.tsx`**: `aiRef` / `GoogleGenAI` instantiation is retained, but
  exists solely to hand a live client to `ChatScreen` for voice chat.
  Text-agent creation and report/resource generation calls no longer touch
  it.
- **`vite.config.ts`**: unchanged — still defines `GEMINI_API_KEY` for
  voice chat's client-side Gemini client. The new `VITE_AI_WORKER_URL`
  needs no `define` entry, since Vite auto-exposes `VITE_`-prefixed env
  vars via `import.meta.env`, matching the existing
  `VITE_WAIT_TIMES_API_URL` pattern.
- **`.env.example`** / **`README.md`**: add `VITE_AI_WORKER_URL`; note
  that `GEMINI_API_KEY` is now required only for voice chat; add
  `ai-worker/README.md` documenting AWS credential setup and the one-time
  manual step of enabling Claude Haiku 4.5 model access in the Bedrock
  console.

## Error handling

Worker-side failures (Bedrock unreachable, model access not granted,
throttled, AWS auth misconfigured) surface as HTTP error responses that
the frontend maps to the same user-facing error path that exists today
(`setError('Could not initialize the AI service...')`), rather than
introducing a new error-handling mechanism.

## Testing / verification

No automated test framework exists in this repo. Verification mirrors how
`worker/` was validated originally:

1. `wrangler dev` the new `ai-worker/` locally; `curl` both endpoints
   directly to confirm request signing and response shape.
2. Point `.env.local`'s `VITE_AI_WORKER_URL` at the local Worker, run
   `npm run dev`, and exercise the full app: manager routing, all four
   agent replies, report generation, resource generation.
3. Confirm the dev-only Ollama fallback still falls back correctly to the
   new Bedrock-backed path.
4. Confirm voice chat is unaffected (still uses Gemini Live as before).

## Out of scope

- Migrating voice chat to Amazon Nova Sonic or any other Bedrock
  speech-to-speech model.
- Removing `@google/genai` as a dependency (still required for voice
  chat).
- Any change to Cloudflare's `worker/` (wait-times proxy).

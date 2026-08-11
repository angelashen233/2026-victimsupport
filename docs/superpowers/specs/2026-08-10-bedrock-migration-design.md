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
- **Model & region:** Meta **Llama 3 8B Instruct**
  (`meta.llama3-8b-instruct-v1:0`) on Bedrock, called **in-region in
  `ca-central-1` (Canada)** — required for data residency. This was chosen
  over Claude after checking current AWS documentation:
  - Claude Haiku 4.5 has no in-region option in `ca-central-1` (only
    Global cross-region, which can route outside Canada).
  - Claude 3 Haiku is in-region in `ca-central-1` but is a legacy model
    with an EOL of September 10, 2026 — not viable to build on now.
  - Amazon Nova Micro/Lite are not available in `ca-central-1` at all
    (in-region, geo, or global).
  - Llama 3 8B Instruct is confirmed in-region in `ca-central-1` and is
    the most viable current option under this constraint.

  Trade-offs accepted with this choice, flagged to and confirmed by the
  user:
  - **No tool-use / structured-output support.** Unlike Claude, Nova, or
    Llama 3.1, this model's Bedrock capability table does not include
    Converse tool calling. Structured JSON (report/resource generation)
    therefore cannot use forced-tool-call output (see "Structured JSON
    output strategy" below).
  - **Materially smaller/older model** (8B params, Dec 2023 knowledge
    cutoff) than Claude Haiku 4.5, worth testing carefully against this
    app's safety-critical prompts (the exact-phrase crisis override,
    no-roleplay refusal, trauma-informed tone in `BASELINE_SAFETY_RULES`)
    since smaller models follow detailed instructions less reliably.
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
  │                                    AWS Bedrock Runtime (ca-central-1, in-region)
  │                                          → Llama 3 8B Instruct
  └─ Voice chat (Live API) ───────────────────► Gemini directly (unchanged)
```

`ai-worker/` signs requests to Bedrock's **Converse API** (not the raw,
model-specific `InvokeModel` body) using `aws4fetch`, a lightweight SigV4
signer that works in the Workers runtime without Node polyfills, targeting
the `ca-central-1` region so requests stay in-region. Converse is AWS's
normalized request/response shape across model families, and covers
system prompts, multi-turn history, and inline image content blocks. It
does **not** cover forced tool-use here, since Llama 3 8B Instruct doesn't
support Converse tool calling (see below).

### Worker endpoints

- **`POST /api/chat`** — replaces `createAgent` / `createAgentWithHistory`
  + `ChatLike.sendMessage`. Request body: `{ systemInstruction, history,
  message }`, where `message` is an array of `Part`-shaped blocks (text
  and/or inline image data, same shape already used by
  `services/ollamaChat.ts` and `services/agents.ts`). Response:
  `{ text }`.
- **`POST /api/structured`** — replaces `generateReport` /
  `generateResources`. Request body: `{ prompt, schema }`. See "Structured
  JSON output strategy" below for how this produces valid JSON without
  tool-use support.

### Structured JSON output strategy

Llama 3 8B Instruct doesn't support Bedrock's Converse tool-use/structured-
output feature, so `/api/structured` can't force schema-conformant output
the way Gemini's `responseSchema` or Claude's forced tool-call would. It
uses prompt-based JSON generation with a parse/retry loop instead:

1. The Worker embeds a description of the target JSON schema directly into
   the prompt sent to the model (field names, types, and the "Not
   specified" convention already used in `services/geminiService.ts`),
   explicitly instructing it to respond with JSON only.
2. The model's text response is parsed as JSON. On success, the parsed
   object is returned.
3. If parsing fails (malformed JSON, extra prose around it, etc.), the
   Worker retries **once** with a follow-up prompt that includes the
   invalid output and asks the model to correct it into valid JSON
   matching the schema.
4. If the retry also fails to parse, the Worker returns a 502 with an
   error body, and the frontend surfaces the same
   "The AI returned an invalid report format. Please try again." error
   path that `services/geminiService.ts` already has today.

This is inherently less reliable than tool-use-forced output, and is a
direct consequence of choosing an in-region `ca-central-1` model for data
residency. Worth re-validating empirically once implemented — if failure
rates are too high in practice, revisit the model choice.

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
`AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (`ca-central-1`), `BEDROCK_MODEL_ID`
(`meta.llama3-8b-instruct-v1:0`), `ALLOWED_ORIGINS`.

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
  manual step of enabling Llama 3 8B Instruct model access in the Bedrock
  console, in the `ca-central-1` region.

## Error handling

Worker-side failures (Bedrock unreachable, model access not granted,
throttled, AWS auth misconfigured) surface as HTTP error responses that
the frontend maps to the same user-facing error path that exists today
(`setError('Could not initialize the AI service...')`), rather than
introducing a new error-handling mechanism. `/api/structured`'s
parse/retry failure (see "Structured JSON output strategy") maps to the
existing "The AI returned an invalid report format. Please try again."
error path.

## Testing / verification

No automated test framework exists in this repo. Verification mirrors how
`worker/` was validated originally:

1. `wrangler dev` the new `ai-worker/` locally; `curl` both endpoints
   directly to confirm request signing and response shape.
2. Point `.env.local`'s `VITE_AI_WORKER_URL` at the local Worker, run
   `npm run dev`, and exercise the full app: manager routing, all four
   agent replies, report generation, resource generation.
3. Generate several reports/resource lists across varied conversations to
   gauge the real-world JSON parse-failure and retry-success rate for
   `/api/structured` (see "Structured JSON output strategy") — this is the
   main empirical unknown introduced by dropping tool-use support.
4. Confirm the dev-only Ollama fallback still falls back correctly to the
   new Bedrock-backed path.
5. Confirm voice chat is unaffected (still uses Gemini Live as before).

## Out of scope

- Migrating voice chat to Amazon Nova Sonic or any other Bedrock
  speech-to-speech model.
- Removing `@google/genai` as a dependency (still required for voice
  chat).
- Any change to Cloudflare's `worker/` (wait-times proxy).

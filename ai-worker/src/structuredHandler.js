import { converse } from './bedrock.js';
import { estimateTokens } from './tokenBudget.js';

const JSON_SYSTEM_PROMPT =
  'You are a precise JSON-generation assistant. Always respond with a single valid JSON object only -- no prose, no markdown code fences, no explanation.';

const STRUCTURED_MAX_TOKENS = 2048;
const SAFETY_MARGIN_TOKENS = 200;
// Simple guard, not a truncation -- if the estimated prompt+schema exceeds
// this, reject early with a clear reason rather than attempting a call that
// will fail with a confusing 502 partway through someone's disclosure.
const MAX_PROMPT_TOKENS = 8192 - STRUCTURED_MAX_TOKENS - SAFETY_MARGIN_TOKENS - estimateTokens(JSON_SYSTEM_PROMPT);

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

  if (typeof body !== 'object' || body === null) {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  const { prompt, schema } = body;
  if (typeof prompt !== 'string' || typeof schema !== 'string') {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  const firstPrompt = `${prompt}\n\nRespond with ONLY a single JSON object matching this shape, and no other text:\n${schema}`;

  if (estimateTokens(firstPrompt) > MAX_PROMPT_TOKENS) {
    return new Response(
      JSON.stringify({
        error: 'This conversation is too long to generate a report from all at once. Try generating it earlier, or in a shorter session.',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

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

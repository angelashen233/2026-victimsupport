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

  if (typeof body !== 'object' || body === null) {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
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

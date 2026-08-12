import { converse } from './bedrock.js';
import { trimHistoryToBudget } from './tokenBudget.js';

function partToConverseContent(part) {
  if (typeof part.text === 'string') return { text: part.text };
  return null; // image parts are stripped client-side before reaching this worker
}

function contentToConverseMessage(content) {
  const parts = Array.isArray(content.parts) ? content.parts : [];
  return {
    role: content.role === 'model' ? 'assistant' : 'user',
    content: parts.map(partToConverseContent).filter(Boolean),
  };
}

export async function handleChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  const { systemInstruction, history, message } = body;
  if (typeof systemInstruction !== 'string' || !Array.isArray(message)) {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  if (
    Array.isArray(history) &&
    !history.every(c => c && typeof c === 'object' && Array.isArray(c.parts))
  ) {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  const mappedHistory = Array.isArray(history) ? history.map(contentToConverseMessage) : [];
  const currentMessage = { role: 'user', content: message.map(partToConverseContent).filter(Boolean) };

  // Server-side backstop: trims history to fit Bedrock's real context window
  // regardless of what a client sends (client-side caps like
  // services/bedrockChat.ts's MAX_HISTORY_ENTRIES reduce how often this
  // triggers, but this public, billed endpoint can't rely on the client
  // behaving).
  const trimmedHistory = trimHistoryToBudget(systemInstruction, mappedHistory, currentMessage, 1024);
  const messages = [...trimmedHistory, currentMessage];

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

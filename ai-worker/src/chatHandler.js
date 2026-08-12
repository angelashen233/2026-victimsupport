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

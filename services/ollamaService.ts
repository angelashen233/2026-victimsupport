import type { Part } from '@google/genai';

/**
 * Minimal shape both Gemini's `Chat` and the Ollama adapter below satisfy,
 * so call sites (ChatScreen.tsx, agents.ts) don't need to know which
 * provider they're talking to.
 */
export interface AgentChat {
  sendMessage(args: { message: Part[] }): Promise<{ text?: string }>;
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const getOllamaConfig = () => ({
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  model: process.env.OLLAMA_MODEL || 'qwen2.5',
});

const partsToText = (parts: Part[]): string =>
  parts.map(p => p.text ?? '').filter(Boolean).join('\n');

async function ollamaChat(messages: OllamaMessage[], format?: object): Promise<string> {
  const { baseUrl, model } = getOllamaConfig();
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, ...(format ? { format } : {}) }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Ollama request failed (${res.status}): ${errText || res.statusText}. Is "ollama serve" running and has "${model}" been pulled?`
    );
  }

  const data = await res.json();
  return data?.message?.content ?? '';
}

export const createOllamaAgent = (systemInstruction: string): AgentChat => {
  const history: OllamaMessage[] = [{ role: 'system', content: systemInstruction }];

  return {
    async sendMessage({ message }) {
      history.push({ role: 'user', content: partsToText(message) });
      const text = await ollamaChat(history);
      history.push({ role: 'assistant', content: text });
      return { text };
    },
  };
};

export const generateJSONWithOllama = async <T>(prompt: string, jsonSchema: object): Promise<T> => {
  const text = await ollamaChat([{ role: 'user', content: prompt }], jsonSchema);
  return JSON.parse(text) as T;
};

/**
 * Converts a Gemini-style schema (Type.OBJECT / Type.STRING / Type.ARRAY enum values)
 * into a standard JSON Schema, which is what Ollama's `format` param expects.
 */
export const toJsonSchema = (geminiSchema: any): any => {
  if (!geminiSchema || typeof geminiSchema !== 'object') return geminiSchema;
  const { type, properties, items, required, description } = geminiSchema;
  const out: any = {};
  if (type) out.type = String(type).toLowerCase();
  if (description) out.description = description;
  if (properties) {
    out.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, toJsonSchema(value)])
    );
  }
  if (items) out.items = toJsonSchema(items);
  if (required) out.required = required;
  return out;
};

export const checkOllamaReachable = async (): Promise<void> => {
  const { baseUrl } = getOllamaConfig();
  let res: Response | null = null;
  try {
    res = await fetch(`${baseUrl}/api/tags`);
  } catch {
    res = null;
  }
  if (!res || !res.ok) {
    throw new Error(`Could not reach Ollama at ${baseUrl}. Is "ollama serve" running?`);
  }
};

export const getAIProvider = (): 'gemini' | 'ollama' =>
  process.env.AI_PROVIDER === 'ollama' ? 'ollama' : 'gemini';

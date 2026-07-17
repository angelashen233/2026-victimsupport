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

async function ollamaChatCompletion(messages: OllamaMessage[]): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
    const data = await res.json();
    const text = data?.message?.content;
    if (typeof text !== "string") throw new Error("Ollama response missing message content");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/** Quick reachability check so App.tsx can decide whether to even attempt local agents. */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_PING_TIMEOUT_MS);
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

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

/**
 * Builds a Chat-shaped agent that prefers a local Ollama model and transparently
 * falls back to Gemini. Only meant to be called when import.meta.env.DEV is true.
 */
export const createHybridAgent = (
  systemInstruction: string,
  buildGeminiChat: (history: Content[]) => ChatLike,
): ChatLike => new HybridChat(systemInstruction, buildGeminiChat);

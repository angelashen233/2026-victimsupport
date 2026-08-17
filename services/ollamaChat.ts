import type { ChatLike } from "./agents";
import type { Content, Part } from "./parts";
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
      // Deliberately do NOT append the just-failed user turn to this.history
      // here. fallbackToBedrock() seeds a new BedrockChat from this.history
      // via toBedrockHistory() and then immediately sends this same `message`
      // as a live request (which appends its own "user" entry) -- if we'd
      // already appended a "user" entry above, the seed history would end in
      // two consecutive "user" entries, violating Bedrock Converse's required
      // strict user/assistant alternation and breaking every subsequent turn
      // for the rest of the session. this.history should reflect only prior,
      // already-completed exchanges.
      return { text: await this.fallbackToBedrock(message, ephemeralContext) };
    }
  }
}

/**
 * Builds a Chat-shaped agent that prefers a local Ollama model and transparently
 * falls back to Bedrock. Only meant to be called when import.meta.env.DEV is true.
 */
export const createHybridAgent = (
  systemInstruction: string,
  buildBedrockChat: (history: Content[]) => ChatLike,
): ChatLike => new HybridChat(systemInstruction, buildBedrockChat);

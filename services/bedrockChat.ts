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

import type { Part } from "@google/genai";

export function partsToText(parts: Part[]): string {
  return parts
    .filter((p): p is { text: string } => typeof (p as { text?: unknown }).text === "string")
    .map(p => p.text)
    .join("\n");
}

export function partsHaveImage(parts: Part[]): boolean {
  return parts.some(p => !!(p as { inlineData?: unknown }).inlineData);
}

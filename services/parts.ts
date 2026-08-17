export interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface Content {
  role: "user" | "model";
  parts: Part[];
}

export function partsToText(parts: Part[]): string {
  return parts
    .filter((p): p is { text: string } => typeof p.text === "string")
    .map(p => p.text)
    .join("\n");
}

export function partsHaveImage(parts: Part[]): boolean {
  return parts.some(p => !!p.inlineData);
}

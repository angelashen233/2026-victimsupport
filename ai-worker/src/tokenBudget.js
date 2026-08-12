const MAX_CONTEXT_TOKENS = 8192;
const SAFETY_MARGIN_TOKENS = 200;

// Rough chars/4 estimate -- good enough for a budget guard, not exact tokenization.
export function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

function estimateMessageTokens(message) {
  return (message.content || []).reduce((sum, block) => sum + estimateTokens(block.text || ''), 0);
}

// Drops the oldest history entries (in user/assistant pairs, to preserve
// Converse's required strict alternation) until system + history + the
// current turn fit within Bedrock's context window, leaving room for the
// reserved output tokens. This is a server-side backstop -- client-side caps
// (services/bedrockChat.ts's MAX_HISTORY_ENTRIES, App.tsx's
// HOSPITAL_CONTEXT_LIMIT) reduce how often this triggers, but a public,
// billed endpoint can't rely on the client behaving.
export function trimHistoryToBudget(systemText, historyMessages, currentMessage, maxTokens) {
  const budget = MAX_CONTEXT_TOKENS - maxTokens - SAFETY_MARGIN_TOKENS - estimateTokens(systemText);
  const currentTokens = estimateMessageTokens(currentMessage);

  let trimmed = historyMessages;
  while (trimmed.length > 0) {
    const historyTokens = trimmed.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
    if (historyTokens + currentTokens <= budget) break;
    trimmed = trimmed.slice(2); // drop oldest user+assistant pair together, never split a pair
  }
  return trimmed;
}

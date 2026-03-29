
import React from 'react';
import { ChevronRightIcon } from './icons';

interface DisclaimerScreenProps {
  onAccept: () => void;
  onSelectPrompt: (prompt: string) => void;
  error?: string | null;
}

const SUGGESTED_PROMPTS = [
  "Hospital near me – still open",
  "I want to speak with a human",
  "I don't know if I was assaulted",
  "Would you save the data?",
  "Where do I get a rape kit?",
];

const DisclaimerScreen: React.FC<DisclaimerScreenProps> = ({ onAccept, onSelectPrompt, error }) => {
  return (
    <div className="flex flex-col items-end justify-end flex-1 w-full max-w-lg mx-auto px-5 pb-8 gap-5">

      {/* ── Error banner ──────────────────────────────── */}
      {error && (
        <div className="w-full px-4 py-3 text-sm text-red-300 bg-red-900/40 border border-red-700/50 rounded-xl backdrop-blur-sm text-center">
          {error}
        </div>
      )}

      {/* ── Suggested prompts ─────────────────────────── */}
      <div className="w-full space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-white/40 px-1 mb-3">
          Suggested
        </p>
        {SUGGESTED_PROMPTS.map((prompt, i) => (
          <button
            key={i}
            onClick={() => onSelectPrompt(prompt)}
            className="w-full text-left px-5 py-3 text-sm text-white/80 hover:text-white bg-white/8 hover:bg-white/14 border border-white/10 hover:border-white/25 rounded-full transition-all duration-150 backdrop-blur-sm"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* ── Main CTA ──────────────────────────────────── */}
      <div className="w-full space-y-4 text-center">
        <h1
          className="text-3xl font-light text-white leading-snug"
          style={{ textShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
        >
          Are you at a safe space to speak at this time?
        </h1>
        <button
          onClick={onAccept}
          className="inline-flex items-center justify-center gap-3 px-6 py-4 font-medium text-white transition-all duration-200 bg-black/10 border border-white/20 rounded-full group backdrop-blur-md hover:bg-black/20 hover:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        >
          <span>Unsure if your experience was abusive or an assault?</span>
          <ChevronRightIcon className="transition-transform group-hover:translate-x-1 flex-shrink-0" />
        </button>
      </div>
    </div>
  );
};

export default DisclaimerScreen;

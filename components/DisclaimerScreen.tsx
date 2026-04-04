
import React from 'react';
import { ChevronRightIcon } from './icons';

interface DisclaimerScreenProps {
  onAccept: () => void;
  onSelectPrompt: (prompt: string) => void;
  error?: string | null;
  darkMode?: boolean;
}

const SUGGESTED_PROMPTS = [
  "Hospital near me – still open",
  "I want to speak with a human",
  "I don't know if I was assaulted",
  "Would you save the data?",
  "Where do I get a rape kit?",
];

const DisclaimerScreen: React.FC<DisclaimerScreenProps> = ({ onAccept, onSelectPrompt, error, darkMode = true }) => {
  const dm = darkMode;
  return (
    <div className="flex flex-col items-end justify-end flex-1 w-full max-w-lg mx-auto px-5 pb-8 gap-5">

      {/* ── Error banner ──────────────────────────────── */}
      {error && (
        <div className={`w-full px-4 py-3 text-sm rounded-xl backdrop-blur-sm text-center border ${dm ? 'text-red-300 bg-red-900/40 border-red-700/50' : 'text-red-700 bg-red-50/80 border-red-300'}`}>
          {error}
        </div>
      )}

      {/* ── Suggested prompts ─────────────────────────── */}
      <div data-tutorial="suggested-prompts" className="w-full space-y-2">
        <p className={`text-[11px] font-semibold uppercase tracking-widest px-1 mb-3 ${dm ? 'text-white/40' : 'text-gray-700'}`}>
          Suggested
        </p>
        {SUGGESTED_PROMPTS.map((prompt, i) => (
          <button
            key={i}
            onClick={() => onSelectPrompt(prompt)}
            className={`w-full text-left px-5 py-3 text-sm rounded-full transition-all duration-150 backdrop-blur-sm border ${dm ? 'text-white/80 hover:text-white bg-white/8 hover:bg-white/14 border-white/10 hover:border-white/25' : 'text-gray-900 hover:text-gray-900 bg-black/8 hover:bg-black/12 border-gray-900/15 hover:border-gray-900/30'}`}
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* ── Main CTA ──────────────────────────────────── */}
      <div className="w-full space-y-4 text-center">
        <h1
          className={`text-3xl font-light leading-snug ${dm ? 'text-white' : 'text-gray-900'}`}
          style={{ textShadow: dm ? '0 2px 12px rgba(0,0,0,0.4)' : '0 1px 4px rgba(255,255,255,0.6)' }}
        >
          Are you at a safe space to speak at this time?
        </h1>
        <button
          onClick={onAccept}
          data-tutorial="start-chat-btn"
          className={`inline-flex items-center justify-center gap-3 px-6 py-4 font-medium transition-all duration-200 rounded-full group backdrop-blur-md focus:outline-none focus:ring-2 ${dm ? 'text-white bg-black/10 border border-white/20 hover:bg-black/20 hover:border-white/40 focus:ring-white/30' : 'text-gray-900 bg-white/30 border border-gray-900/20 hover:bg-white/50 hover:border-gray-900/40 focus:ring-gray-900/20'}`}
        >
          <span>Unsure if your experience was abusive or an assault?</span>
          <ChevronRightIcon className="transition-transform group-hover:translate-x-1 flex-shrink-0" />
        </button>
      </div>
    </div>
  );
};

export default DisclaimerScreen;

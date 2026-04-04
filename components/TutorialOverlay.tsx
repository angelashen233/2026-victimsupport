
import React, { useCallback, useEffect, useState } from 'react';

interface TutorialStep {
  title: string;
  description: string;
  targetSelector?: string;
  tooltipSide?: 'top' | 'bottom' | 'center';
}

const STEPS: TutorialStep[] = [
  {
    title: 'Welcome to Afterhour Resources',
    description:
      "This is a safe, confidential space for support. We'll walk you through the key features — you can skip at any time.",
    tooltipSide: 'center',
  },
  {
    title: 'Quick Exit',
    description:
      'Click Exit to immediately navigate away from this site. Use it any time you need to leave quickly and discreetly.',
    targetSelector: '[data-tutorial="exit-btn"]',
    tooltipSide: 'bottom',
  },
  {
    title: 'Sidebar Menu',
    description:
      'Tap here to open the menu. Inside you\'ll find nearby hospitals with live wait times, your location on a map, display settings, and more.',
    targetSelector: '[data-tutorial="menu-btn"]',
    tooltipSide: 'bottom',
  },
  {
    title: 'Quick-Start Prompts',
    description:
      'Not sure where to begin? Tap any of these to jump straight into a relevant conversation without having to type anything.',
    targetSelector: '[data-tutorial="suggested-prompts"]',
    tooltipSide: 'top',
  },
  {
    title: 'Start a Conversation',
    description:
      'Tap here to open a private chat. The assistant will listen without judgment and help connect you to the right support.',
    targetSelector: '[data-tutorial="start-chat-btn"]',
    tooltipSide: 'top',
  },
  {
    title: 'Inside the Chat',
    description:
      'While chatting you can attach photos, record a private audio note, generate a shareable incident report, or compile a resource list — all from the toolbar at the bottom.',
    tooltipSide: 'center',
  },
];

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TutorialOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  darkMode?: boolean;
}

const PAD = 10;
const TOOLTIP_W = 320;

const TutorialOverlay: React.FC<TutorialOverlayProps> = ({ isOpen, onClose, darkMode = true }) => {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<SpotlightRect | null>(null);

  const current = STEPS[step];
  const dm = darkMode;

  // Reset on open
  useEffect(() => {
    if (isOpen) setStep(0);
  }, [isOpen]);

  // Measure target element on each step
  useEffect(() => {
    if (!isOpen || !current.targetSelector) {
      setRect(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(current.targetSelector!);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step, isOpen, current.targetSelector]);

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else onClose();
  }, [step, onClose]);

  const handleBack = useCallback(() => {
    setStep(s => Math.max(0, s - 1));
  }, []);

  if (!isOpen) return null;

  const isCenter = current.tooltipSide === 'center' || !rect;

  // Spotlight geometry
  const sTop  = rect ? rect.top  - PAD : 0;
  const sLeft = rect ? rect.left - PAD : 0;
  const sW    = rect ? rect.width  + PAD * 2 : 0;
  const sH    = rect ? rect.height + PAD * 2 : 0;

  // Tooltip horizontal centre: try to centre on spotlight, clamp to viewport
  const centreX  = rect ? sLeft + sW / 2 : window.innerWidth / 2;
  const tooltipL = Math.max(12, Math.min(centreX - TOOLTIP_W / 2, window.innerWidth - TOOLTIP_W - 12));

  // Tooltip vertical positioning
  let tooltipStyle: React.CSSProperties;
  if (isCenter) {
    tooltipStyle = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  } else if (current.tooltipSide === 'bottom') {
    tooltipStyle = { position: 'fixed', top: sTop + sH + 14, left: tooltipL };
  } else {
    // 'top' — tooltip sits above the spotlight
    tooltipStyle = { position: 'fixed', bottom: window.innerHeight - sTop + 14, left: tooltipL };
  }

  return (
    <>
      {/* ── Click-blocker (z-[9988]) keeps content non-interactive ── */}
      <div className="fixed inset-0 z-[9988]" />

      {/* ── Dark overlay or spotlight box-shadow ── */}
      {isCenter ? (
        <div className="fixed inset-0 z-[9989] pointer-events-none" style={{ background: 'rgba(0,0,0,0.65)' }} />
      ) : rect ? (
        <div
          className="fixed z-[9989] pointer-events-none"
          style={{
            top: sTop,
            left: sLeft,
            width: sW,
            height: sH,
            borderRadius: 10,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)',
            border: '2px solid rgba(14,165,233,0.65)',
          }}
        />
      ) : (
        <div className="fixed inset-0 z-[9989] pointer-events-none" style={{ background: 'rgba(0,0,0,0.65)' }} />
      )}

      {/* ── Tooltip card (z-[9999]) ── */}
      <div
        className={`fixed z-[9999] rounded-2xl shadow-2xl p-5 ${dm ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-gray-200'}`}
        style={{ ...tooltipStyle, width: TOOLTIP_W }}
      >
        {/* Progress dots */}
        <div className="flex gap-1.5 mb-3">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-200 ${
                i === step
                  ? 'w-5 bg-sky-400'
                  : i < step
                  ? `w-1.5 ${dm ? 'bg-sky-800' : 'bg-sky-200'}`
                  : `w-1.5 ${dm ? 'bg-slate-600' : 'bg-gray-300'}`
              }`}
            />
          ))}
        </div>

        <h3 className={`text-[15px] font-semibold mb-1.5 ${dm ? 'text-slate-100' : 'text-gray-900'}`}>
          {current.title}
        </h3>
        <p className={`text-sm leading-relaxed ${dm ? 'text-slate-300' : 'text-gray-600'}`}>
          {current.description}
        </p>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-4">
          {step > 0 ? (
            <button
              onClick={handleBack}
              className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${dm ? 'text-slate-400 hover:text-slate-200 hover:bg-white/8' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'}`}
            >
              Back
            </button>
          ) : (
            <div />
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${dm ? 'text-slate-400 hover:text-slate-200 hover:bg-white/8' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'}`}
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              className="text-sm px-4 py-1.5 rounded-lg font-medium text-white bg-sky-500 hover:bg-sky-400 active:bg-sky-600 transition-colors"
            >
              {step === STEPS.length - 1 ? 'Done' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default TutorialOverlay;

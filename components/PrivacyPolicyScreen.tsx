import React, { useState } from 'react';

interface PrivacyPolicyScreenProps {
  onAccept: () => void;
  darkMode?: boolean;
}

const PrivacyPolicyScreen: React.FC<PrivacyPolicyScreenProps> = ({ onAccept, darkMode = true }) => {
  const dm = darkMode;
  const [checked, setChecked] = useState(false);

  const surface  = dm ? 'bg-slate-900/80 border-slate-700/60' : 'bg-white/85 border-gray-200';
  const textMain = dm ? 'text-white' : 'text-gray-900';
  const textMuted = dm ? 'text-slate-400' : 'text-gray-500';
  const textBody  = dm ? 'text-slate-300' : 'text-gray-700';
  const divider   = dm ? 'border-slate-700/50' : 'border-gray-200';
  const emergency = dm ? 'bg-red-900/40 border-red-700/50 text-red-300' : 'bg-red-50 border-red-300 text-red-700';
  const checkBg   = dm ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-400';

  return (
    <div className="flex items-center justify-center flex-1 w-full px-4 py-8">
      <div
        className={`w-full max-w-lg rounded-2xl border backdrop-blur-md shadow-2xl overflow-hidden ${surface}`}
      >
        {/* Header */}
        <div className={`px-6 pt-6 pb-4 border-b ${divider}`}>
          <p className={`text-[11px] font-semibold uppercase tracking-widest mb-1 ${dm ? 'text-sky-400' : 'text-sky-600'}`}>
            Before you begin
          </p>
          <h1 className={`text-xl font-semibold leading-snug ${textMain}`}>
            Privacy Policy &amp; Terms of Use
          </h1>
        </div>

        {/* Body */}
        <div className={`px-6 py-5 space-y-4 text-sm leading-relaxed ${textBody} max-h-[55vh] overflow-y-auto`}>

          {/* Emergency notice — always first */}
          <div className={`rounded-xl px-4 py-3 border text-sm font-medium ${emergency}`}>
            🚨 <strong>If you or someone else is in immediate life-threatening danger, call 9-1-1 now.</strong> This service is not a substitute for emergency services.
          </div>

          <section>
            <h2 className={`text-[13px] font-semibold uppercase tracking-wide mb-1.5 ${dm ? 'text-sky-400' : 'text-sky-700'}`}>
              What this service is
            </h2>
            <p>
              Afterhour Resources is a confidential, AI-assisted support tool for survivors and people who may have experienced sexual assault, harassment, or related harm in British Columbia. It is designed to help you access information, nearby resources, and a private space to document your experience at your own pace.
            </p>
          </section>

          <section>
            <h2 className={`text-[13px] font-semibold uppercase tracking-wide mb-1.5 ${dm ? 'text-sky-400' : 'text-sky-700'}`}>
              What this service is not
            </h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Not a substitute for professional medical, legal, or psychological advice</li>
              <li>Not a crisis line or emergency service</li>
              <li>Not a substitute for calling 9-1-1 in a life-threatening situation</li>
              <li>Not monitored by any human or organization in real time</li>
            </ul>
          </section>

          <section>
            <h2 className={`text-[13px] font-semibold uppercase tracking-wide mb-1.5 ${dm ? 'text-sky-400' : 'text-sky-700'}`}>
              Your privacy
            </h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Conversations are <strong>not stored on any server</strong>. They exist only in your current browser session.</li>
              <li>Any notes or documents you save stay <strong>on your device only</strong> unless you choose to export them.</li>
              <li>Starting a new session permanently deletes your conversation — nothing is retained.</li>
              <li>We do not collect, sell, or share personal data.</li>
            </ul>
          </section>

          <section>
            <h2 className={`text-[13px] font-semibold uppercase tracking-wide mb-1.5 ${dm ? 'text-sky-400' : 'text-sky-700'}`}>
              AI limitations &amp; your responsibility
            </h2>
            <p>
              This tool is powered by a large language model (Google Gemini). It can make mistakes. Always verify important information independently, particularly around legal options, medical procedures, and reporting timelines. Resources listed may change — contact organizations directly to confirm availability.
            </p>
          </section>

          <section>
            <h2 className={`text-[13px] font-semibold uppercase tracking-wide mb-1.5 ${dm ? 'text-sky-400' : 'text-sky-700'}`}>
              Usage rules
            </h2>
            <ul className="list-disc list-inside space-y-1">
              <li>This tool is intended for people seeking genuine support.</li>
              <li>Roleplay, fictional scenarios, and requests to impersonate others are not permitted and will be declined.</li>
              <li>The AI will not provide legal or medical diagnoses.</li>
            </ul>
          </section>

          <p className={`text-xs ${textMuted}`}>
            By continuing, you confirm you have read and understand these terms. These terms may be updated without notice. For questions, contact the project maintainers via the GitHub repository.
          </p>
        </div>

        {/* Footer */}
        <div className={`px-6 py-5 border-t ${divider} space-y-4`}>
          {/* Checkbox */}
          <label className={`flex items-start gap-3 cursor-pointer select-none text-sm ${textBody}`}>
            <div className="relative flex-shrink-0 mt-0.5">
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={e => setChecked(e.target.checked)}
              />
              <div
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                  checked
                    ? 'bg-sky-500 border-sky-500'
                    : checkBg
                }`}
              >
                {checked && (
                  <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                    <polyline points="1 4.5 4 7.5 10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            </div>
            <span>
              I understand this is <strong>not an emergency service</strong>. I will call <strong>9-1-1</strong> if there is an immediate threat to life. I have read and agree to the terms above.
            </span>
          </label>

          {/* CTA */}
          <button
            onClick={onAccept}
            disabled={!checked}
            className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 ${
              checked
                ? 'bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-white shadow-lg shadow-sky-500/30'
                : dm
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            I Agree — Enter Safe Space
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicyScreen;

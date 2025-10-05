
import React from 'react';
import { ChevronRightIcon } from './icons';

interface DisclaimerScreenProps {
  onAccept: () => void;
}

const DisclaimerScreen: React.FC<DisclaimerScreenProps> = ({ onAccept }) => {
  return (
    <div className="flex flex-col items-center justify-end flex-1 w-full max-w-4xl px-4 pb-20 mx-auto text-center md:pb-32">
        <h1 
            className="text-4xl font-light text-white md:text-5xl"
            style={{ textShadow: '0 2px 10px rgba(0,0,0,0.3)' }}
        >
            Are you at a safe space to speak at this time?
        </h1>
        <button
            onClick={onAccept}
            className="flex items-center justify-center gap-3 px-6 py-4 mt-8 font-medium text-white transition-colors duration-200 bg-black border rounded-full group bg-opacity-10 backdrop-blur-md border-white/20 hover:bg-opacity-20 hover:border-white/40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-400 focus:ring-offset-slate-900"
        >
            <span>Unsure if your experience was abusive or an assault?</span>
            <ChevronRightIcon className="transition-transform group-hover:translate-x-1" />
        </button>
    </div>
  );
};

export default DisclaimerScreen;
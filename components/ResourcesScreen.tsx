
import React from 'react';
import type { Resource } from '../types';
import { BackIcon, RedoIcon } from './icons';

interface ResourcesScreenProps {
  resources: Resource[] | null;
  onBackToChat: () => void;
  onStartOver: () => void;
  darkMode?: boolean;
}

const ResourcesScreen: React.FC<ResourcesScreenProps> = ({ resources, onBackToChat, onStartOver, darkMode = true }) => {
  const dm = darkMode;
  if (!resources) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <h2 className={`text-2xl font-bold ${dm ? 'text-slate-100' : 'text-gray-900'}`}>Could not compile resources.</h2>
        <p className={`mt-2 ${dm ? 'text-slate-400' : 'text-gray-600'}`}>Something went wrong. Please go back and try again.</p>
        <button
          onClick={onBackToChat}
          className="flex items-center gap-2 px-4 py-2 mt-6 text-sm font-medium text-white transition-colors duration-200 bg-sky-600 rounded-md hover:bg-sky-700"
        >
          <BackIcon />
          <span>Back to Chat</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`max-w-4xl p-4 mx-auto my-8 backdrop-blur-sm md:p-8 ${dm ? 'bg-slate-900/50' : 'bg-white/70'}`}>
        <div className={`p-8 border rounded-lg shadow-lg ${dm ? 'bg-slate-800/50 border-slate-700' : 'bg-white border-gray-200'}`}>
            <h2 className={`text-2xl font-bold ${dm ? 'text-slate-100' : 'text-gray-900'}`}>Compiled Resources</h2>
            <p className={`mt-2 text-sm ${dm ? 'text-slate-400' : 'text-gray-600'}`}>
                Based on your conversation, here are some resources that might be helpful. This is not an exhaustive list and is not a substitute for professional advice.
            </p>
            <ul className="mt-6 space-y-4">
                {resources.map((resource, index) => (
                    <li key={index} className={`p-4 border rounded-md ${dm ? 'bg-slate-700/50 border-slate-700' : 'bg-gray-50 border-gray-200'}`}>
                        <h3 className="font-semibold text-sky-500">{resource.name}</h3>
                        <p className={`mt-1 text-sm ${dm ? 'text-slate-300' : 'text-gray-700'}`}>{resource.description}</p>
                        {resource.contact && (
                            <p className={`mt-2 text-sm ${dm ? 'text-slate-400' : 'text-gray-600'}`}>
                                Contact: <a href={resource.contact.startsWith('http') ? resource.contact : `tel:${resource.contact}`} target="_blank" rel="noopener noreferrer" className={`hover:underline ${dm ? '' : 'text-sky-600'}`}>{resource.contact}</a>
                            </p>
                        )}
                    </li>
                ))}
            </ul>
        </div>

        <div className="flex flex-col gap-4 mt-8 md:flex-row">
            <button onClick={onBackToChat} className={`flex items-center justify-center w-full gap-2 px-4 py-3 font-medium text-center transition-colors duration-200 border rounded-md shadow-sm ${dm ? 'text-slate-200 bg-slate-700 border-slate-600 hover:bg-slate-600' : 'text-gray-800 bg-gray-100 border-gray-300 hover:bg-gray-200'}`}>
                <BackIcon />
                <span>Back to Chat</span>
            </button>
            <button onClick={onStartOver} className={`flex items-center justify-center w-full gap-2 px-4 py-3 font-medium text-center transition-colors duration-200 border rounded-md shadow-sm ${dm ? 'bg-red-900/40 border-red-800/60 text-red-300 hover:bg-red-900/60' : 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100'}`}>
                <RedoIcon />
                <span>Start New Session</span>
            </button>
        </div>
    </div>
  );
};

export default ResourcesScreen;
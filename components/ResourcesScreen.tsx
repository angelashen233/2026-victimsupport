
import React from 'react';
import type { Resource } from '../types';
import { BackIcon, RedoIcon } from './icons';

interface ResourcesScreenProps {
  resources: Resource[] | null;
  onBackToChat: () => void;
  onStartOver: () => void;
}

const ResourcesScreen: React.FC<ResourcesScreenProps> = ({ resources, onBackToChat, onStartOver }) => {
  if (!resources) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <h2 className="text-2xl font-bold">Could not compile resources.</h2>
        <p className="mt-2 text-slate-400">Something went wrong. Please go back and try again.</p>
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
    <div className="max-w-4xl p-4 mx-auto my-8 bg-slate-900/50 backdrop-blur-sm md:p-8">
        <div className="p-8 bg-slate-800/50 border rounded-lg shadow-lg border-slate-700">
            <h2 className="text-2xl font-bold text-slate-100">Compiled Resources</h2>
            <p className="mt-2 text-sm text-slate-400">
                Based on your conversation, here are some resources that might be helpful. This is not an exhaustive list and is not a substitute for professional advice.
            </p>
            <ul className="mt-6 space-y-4">
                {resources.map((resource, index) => (
                    <li key={index} className="p-4 border rounded-md bg-slate-700/50 border-slate-700">
                        <h3 className="font-semibold text-sky-400">{resource.name}</h3>
                        <p className="mt-1 text-sm text-slate-300">{resource.description}</p>
                        {resource.contact && (
                            <p className="mt-2 text-sm text-slate-400">
                                Contact: <a href={resource.contact.startsWith('http') ? resource.contact : `tel:${resource.contact}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{resource.contact}</a>
                            </p>
                        )}
                    </li>
                ))}
            </ul>
        </div>
        
        <div className="flex flex-col gap-4 mt-8 md:flex-row">
            <button onClick={onBackToChat} className="flex items-center justify-center w-full gap-2 px-4 py-3 font-medium text-center transition-colors duration-200 border rounded-md shadow-sm text-slate-200 bg-slate-700 border-slate-600 hover:bg-slate-600">
                <BackIcon />
                <span>Back to Chat</span>
            </button>
            <button onClick={onStartOver} className="flex items-center justify-center w-full gap-2 px-4 py-3 font-medium text-center transition-colors duration-200 bg-red-900/40 border border-red-800/60 rounded-md shadow-sm text-red-300 hover:bg-red-900/60">
                <RedoIcon />
                <span>Start New Session</span>
            </button>
        </div>
    </div>
  );
};

export default ResourcesScreen;
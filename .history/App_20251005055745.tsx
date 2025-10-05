import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, ReportData, Recipient, UserProfile, Resource } from './types';
import { MessageAuthor } from './types';
import DisclaimerScreen from './components/DisclaimerScreen';
import ChatScreen from './components/ChatScreen';
import ReportScreen from './components/ReportScreen';
import ResourcesScreen from './components/ResourcesScreen';
import { generateReport, generateResources } from './services/geminiService';
import type { Chat } from '@google/genai';
import { GoogleGenAI } from '@google/genai';
import { ResourcesIcon, MenuIcon, ExternalLinkIcon } from './components/icons';
import { createAgent, INFO_PROMPT, LOCATION_PROMPT, MANAGER_PROMPT, OFFTOPIC_PROMPT } from './services/agents';
import { initialUserProfile } from './data/userProfile';

type AppState = 'disclaimer' | 'chat' | 'report' | 'resources';
export type AgentType = 'manager' | 'info' | 'location' | 'offtopic';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('disclaimer');
  const [messages, setMessages] = useState<Message[]>([]);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isGeneratingResources, setIsGeneratingResources] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentType>('manager');
  const [userProfile, setUserProfile] = useState<UserProfile>(initialUserProfile);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [waitTimes, setWaitTimes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const aiRef = useRef<GoogleGenAI | null>(null);
  const managerChatRef = useRef<Chat | null>(null);
  const infoChatRef = useRef<Chat | null>(null);
  const locationChatRef = useRef<Chat | null>(null);
  const offTopicChatRef = useRef<Chat | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const apiKey = process.env.API_KEY;
      if (!apiKey) {
        throw new Error("API_KEY not found");
      }
      aiRef.current = new GoogleGenAI({ apiKey });
    } catch (e) {
      console.error(e);
      setError("Could not initialize the AI service. Please check your configuration.");
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
            setIsMenuOpen(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
        document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    fetch("https://edwaittimes.ca/api/wait-times")
      .then((response) => response.json())
      .then((data) => {
        setWaitTimes(data);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Error fetching wait times:", error);
        setLoading(false);
      });
  }, []);

  const handleStartChat = useCallback(() => {
    if (!aiRef.current) {
        setError("AI service is not initialized. Please refresh the page.");
        return;
    }
    try {
        // Initialize all agents with user profile context
        managerChatRef.current = createAgent(aiRef.current, MANAGER_PROMPT, userProfile);
        infoChatRef.current = createAgent(aiRef.current, INFO_PROMPT, userProfile);
        locationChatRef.current = createAgent(aiRef.current, LOCATION_PROMPT, userProfile);
        offTopicChatRef.current = createAgent(aiRef.current, OFFTOPIC_PROMPT, userProfile);

        setMessages([
            {
                author: MessageAuthor.AI,
                text: "Hello. I'm here to listen and support you in a safe and confidential space. Please feel free to share what's on your mind when you're ready. Remember, this is not a substitute for professional help."
            }
        ]);
        setActiveAgent('manager');
        setAppState('chat');
    } catch (e) {
        console.error(e);
        setError("Could not initialize the AI assistant. Please check your API key and refresh the page.");
    }
  }, [userProfile]);

  const handleGenerateReport = useCallback(async () => {
    setIsGeneratingReport(true);
    setError(null);
    try {
      if (!aiRef.current) throw new Error("AI not initialized");
      const result = await generateReport(aiRef.current, messages, userProfile);
      setReportData(result.report);
      setRecipients(result.recipients);
      setAppState('report');
    } catch (e) {
      console.error(e);
      setError("I'm sorry, I encountered an error while generating the report. Please try again or refine the conversation.");
    } finally {
      setIsGeneratingReport(false);
    }
  }, [messages, userProfile]);

  const handleGenerateResources = useCallback(async () => {
    setIsGeneratingResources(true);
    setError(null);
    try {
      if (!aiRef.current) throw new Error("AI not initialized");
      const result = await generateResources(aiRef.current, messages, userProfile);
      setResources(result.resources);
      setAppState('resources');
    } catch (e) {
      console.error(e);
      setError("I'm sorry, I encountered an error while compiling resources. Please try again or check the conversation for clarity.");
    } finally {
      setIsGeneratingResources(false);
    }
  }, [messages, userProfile]);

  const handleBackToChat = () => {
    setAppState('chat');
  };

  const handleStartOver = () => {
    setMessages([]);
    setReportData(null);
    setRecipients(null);
    setResources(null);
    setError(null);
    managerChatRef.current = null;
    infoChatRef.current = null;
    locationChatRef.current = null;
    offTopicChatRef.current = null;
    setIsMenuOpen(false);
    setAppState('disclaimer');
  };

  const renderContent = () => {
    switch (appState) {
      case 'disclaimer':
        return <DisclaimerScreen onAccept={handleStartChat} />;
      case 'chat':
        return (
          <ChatScreen
            ai={aiRef.current}
            userProfile={userProfile}
            messages={messages}
            setMessages={setMessages}
            chats={{
                manager: managerChatRef.current,
                info: infoChatRef.current,
                location: locationChatRef.current,
                offtopic: offTopicChatRef.current,
            }}
            activeAgent={activeAgent}
            setActiveAgent={setActiveAgent}
            onGenerateReport={handleGenerateReport}
            isGeneratingReport={isGeneratingReport}
            onGenerateResources={handleGenerateResources}
            isGeneratingResources={isGeneratingResources}
            error={error}
            setError={setError}
          />
        );
      case 'report':
        return (
          <ReportScreen
            reportData={reportData}
            recipients={recipients}
            onBackToChat={handleBackToChat}
            onStartOver={handleStartOver}
          />
        );
      case 'resources':
        return (
          <ResourcesScreen
            resources={resources}
            onBackToChat={handleBackToChat}
            onStartOver={handleStartOver}
          />
        );
      default:
        return <DisclaimerScreen onAccept={handleStartChat} />;
    }
  };

  const AppHeader = () => (
    <header className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-4 md:p-6">
        <a href="https://google.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 bg-black rounded-full bg-opacity-20 backdrop-blur-sm hover:bg-opacity-30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 focus:ring-offset-slate-900">
            <span>Exit</span>
            <ExternalLinkIcon />
        </a>
        
        <div className="flex items-center gap-2">
            <button className="flex items-center justify-center w-10 h-10 text-white transition-colors duration-200 bg-black rounded-full bg-opacity-20 backdrop-blur-sm hover:bg-opacity-30">
                <ResourcesIcon />
            </button>
            <div className="relative" ref={menuRef}>
                <button 
                    onClick={() => setIsMenuOpen(prev => !prev)}
                    className="flex items-center justify-center w-10 h-10 text-white transition-colors duration-200 bg-black rounded-lg bg-opacity-20 backdrop-blur-sm hover:bg-opacity-30">
                    <MenuIcon />
                </button>
                {isMenuOpen && (
                    <div className="absolute right-0 w-56 mt-2 overflow-hidden origin-top-right bg-white rounded-md shadow-lg dark:bg-slate-800 ring-1 ring-black ring-opacity-5 focus:outline-none">
                        <div className="py-1">
                            <button onClick={handleStartOver} className="block w-full px-4 py-2 text-sm text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700">New Session</button>
                            <a href="https://www.rainn.org/resources" target="_blank" rel="noopener noreferrer" className="block px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700">Emergency Resources</a>
                        </div>
                    </div>
                )}
            </div>
        </div>
    </header>
  );

  if (loading) return <div>Loading...</div>;

  return (
    <div className="relative flex flex-col h-screen font-sans text-slate-200">
      {appState !== 'chat' && <AppHeader />}
      <main className="flex flex-col flex-1">
        {renderContent()}
        <div>
          <h1>Emergency Department Wait Times</h1>
          <ul>
            {waitTimes.map((item, idx) => (
              <li key={idx}>
                {item.hospital}: {item.waitTime} minutes
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
};

export default App;
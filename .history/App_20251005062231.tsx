
import type { Chat } from '@google/genai';
import { GoogleGenAI } from '@google/genai';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ChatScreen from './components/ChatScreen';
import DisclaimerScreen from './components/DisclaimerScreen';
import { ExternalLinkIcon, ResourcesIcon } from './components/icons';
import ReportScreen from './components/ReportScreen';
import ResourcesScreen from './components/ResourcesScreen';
import { initialUserProfile } from './data/userProfile';
import { createAgent, INFO_PROMPT, LOCATION_PROMPT, MANAGER_PROMPT, OFFTOPIC_PROMPT } from './services/agents';
import { generateReport, generateResources } from './services/geminiService';
import type { Message, Recipient, ReportData, Resource, UserProfile } from './types';
import { MessageAuthor } from './types';

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
  const [isWriting, setIsWriting] = useState(false);
  const [isGeneratingResources, setIsGeneratingResources] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentType>('manager');
  const [userProfile, setUserProfile] = useState<UserProfile>(initialUserProfile);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showHospitalModal, setShowHospitalModal] = useState(false);
  const [isHospitalExpanded, setIsHospitalExpanded] = useState(false);
  const [waitTimes, setWaitTimes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const [showNearestHospital, setShowNearestHospital] = useState(false);

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

    // Sync userProfile.location with userLocation
  useEffect(() => {
    if (userLocation) {
      setUserProfile(prev => ({
        ...prev,
        location: `Lat: ${userLocation.lat}, Lng: ${userLocation.lng}`
      }));
    }
  }, [userLocation]);

  // Update userLocation on initial app load
  useEffect(() => {
    requestUserLocation();
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setIsWriting(false);
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

  const requestUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
          setShowNearestHospital(true);
        },
        (error) => {
          setError("Could not get your location.");
        }
      );
    } else {
      setError("Geolocation is not supported by your browser.");
    }
  };

  // Find the two nearest hospitals
  const nearestHospitals =
    userLocation && waitTimes.length > 0
      ? [...waitTimes]
          .map(hospital => ({
            hospital,
            dist: getDistance(
              userLocation.lat,
              userLocation.lng,
              hospital.latitude,
              hospital.longitude
            )
          }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 2)
      : [];

  const nearest = nearestHospitals[0];
  const secondNearest = nearestHospitals[1];

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
            isWriting={isWriting}
            setIsWriting={setIsWriting}
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
    <header className="absolute top-0 left-0 right-0 z-20 flex flex-col items-center p-4 md:p-6">
        <a href="https://google.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 bg-black rounded-full bg-opacity-20 backdrop-blur-sm hover:bg-opacity-30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 focus:ring-offset-slate-900" style={{ alignSelf: 'flex-start' }}>
            <span>Exit</span>
            <ExternalLinkIcon />
        </a>
        <div className="flex justify-center w-full mt-2">
            <button className="flex items-center justify-center w-10 h-10 text-white transition-colors duration-200 bg-black rounded-full bg-opacity-20 backdrop-blur-sm hover:bg-opacity-30">
                <ResourcesIcon />
            </button>
        </div>
    </header>
  );

  function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  useEffect(() => {
    // Check if any message contains the word "hospital"
    const hospitalMentioned = messages.some(
      msg => typeof msg.text === "string" && msg.text.toLowerCase().includes("hospital")
    );
    if (hospitalMentioned && !showNearestHospital) {
      requestUserLocation();
    }
  }, [messages]);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="relative flex flex-col h-screen font-sans text-slate-200">
      {appState !== 'chat' && <AppHeader />}
      {/* Floating nearest hospital component */}
      {userLocation && nearestHospitals.length > 0 && (
        <div
          style={{
            position: "fixed",
            top: "30px",
            left: "32px",
            zIndex: 50,
            background: "#0f172a",
            color: "#fff",
            padding: "0.75rem 2rem",
            borderRadius: "0 1rem 1rem 1rem",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            fontWeight: "bold",
            fontSize: "1.1rem",
            pointerEvents: "none",
            maxWidth: "350px",
            textAlign: "left"
          }}
        >
          {nearestHospitals.map((entry, idx) => {
            const waitTime = entry.hospital.waitTime?.waitTimeMinutes;
            return (
              <div key={entry.hospital.id} style={{ marginBottom: "0.5rem" }}>
                {idx === 0 ? "Nearest" : `#${idx + 1}`} Hospital: {entry.hospital.name} — Wait Time: {waitTime ?? "N/A"} minutes
              </div>
            );
          })}
        </div>
      )}
      {userLocation && (
        <div
          style={{
            position: "fixed",
            top: "70px", // 10px (hospital) + 30px (space) + 30px (height/padding)
            right: "32px",
            zIndex: 50,
            background: "#334155",
            color: "#fff",
            padding: "0.5rem 1.5rem",
            borderRadius: "0.75rem 0 0.75rem 0.75rem",
            boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
            fontSize: "0.95rem",
            marginTop: "0.5rem",
            textAlign: "right"
          }}
        >
          Your Location:<br />
          Latitude: {userLocation.lat}<br />
          Longitude: {userLocation.lng}
        </div>
      )}
      <main className="flex flex-col flex-1">
        {renderContent()}
        {/* 
        <div>
          <h1>Emergency Department Wait Times</h1>
          <ul>
            {waitTimes.map((item, idx) => (
              <li key={idx}>
                {item.name}: {item.waitTime?.waitTimeMinutes ?? "N/A"} minutes
              </li>
            ))}
          </ul>
        </div>
        */}
      </main>
      {/* <button onClick={requestUserLocation}>Show Nearest Hospital</button> */}

      {/* Hamburger Menu (moved to top right) */}
      <div style={{
        position: "fixed",
        top: "10px",
        right: "10px",
        zIndex: 100
      }}>
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          style={{
            background: "#0f172a",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            padding: "8px 12px",
            fontSize: "1.5rem",
            cursor: "pointer"
          }}
          aria-label="Open menu"
        >
          ☰
        </button>
        {isMenuOpen && (
          <div style={{
            position: "fixed",
            top: "58px",
            right: "10px",
            width: "240px",
            background: "#1e293b",
            color: "#fff",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            padding: "12px",
            zIndex: 101
          }}>
            <div
              style={{
                cursor: "pointer",
                fontWeight: "bold",
                marginBottom: "12px"
              }}
              onClick={() => setShowHospitalModal(true)}
            >
              Hospital wait time
            </div>
            <div
              style={{
                cursor: "pointer",
                fontWeight: "bold",
                marginBottom: "12px"
              }}
              onClick={() => {/* handle HUMAN CHAT navigation here */}}
            >
              HUMAN CHAT
            </div>
            <div
              style={{
                cursor: "pointer",
                fontWeight: "bold",
                marginBottom: "12px"
              }}
              onClick={handleStartOver}
            >
              New Session
            </div>
            <a
              href="https://www.rainn.org/resources"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "block",
                fontWeight: "bold",
                marginBottom: "12px",
                color: "#fff",
                textDecoration: "underline"
              }}
            >
              Emergency Resources
            </a>
          </div>
        )}
      </div>

      {/* Large Hospital Wait-Time Modal */}
      {showHospitalModal && (
        <div
          style={{
            position: "fixed",
            top: "50px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "80vw",
            height: "70vh",
            background: "#334155",
            color: "#fff",
            zIndex: 200,
            borderRadius: "16px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
            padding: "32px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column"
          }}
        >
          <button
            onClick={() => setShowHospitalModal(false)}
            style={{
              alignSelf: "flex-end",
              background: "#0f172a",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              padding: "8px 12px",
              fontSize: "1rem",
              cursor: "pointer",
              marginBottom: "16px"
            }}
          >
            Close
          </button>
          <h2 style={{ marginBottom: "24px" }}>Hospital Wait Times</h2>
          {nearestHospitals.length > 0 ? (
            nearestHospitals.map((entry, idx) => {
              const waitTime = entry.hospital.waitTime?.waitTimeMinutes;
              return (
                <div key={entry.hospital.id} style={{ marginBottom: "1rem", fontSize: "1.1rem" }}>
                  <strong>{idx === 0 ? "Nearest" : `#${idx + 1}`} Hospital: {entry.hospital.name}</strong><br />
                  Wait Time: {waitTime ?? "N/A"} minutes<br />
                  Distance: {entry.dist.toFixed(2)} km
                </div>
              );
            })
          ) : (
            <div>No hospital data available.</div>
          )}
        </div>
      )}
    </div>
  ); 
};


export default App;

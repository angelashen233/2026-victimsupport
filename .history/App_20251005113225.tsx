  // ...existing code...

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
  const [isScreenWide, setIsScreenWide] = useState(window.innerWidth >= 600);
  useEffect(() => {
    const handleResize = () => setIsScreenWide(window.innerWidth >= 600);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [showLocationModal, setShowLocationModal] = useState(false);
  // Handler to reset app to initial state
  const handleStartOver = () => {
    setAppState('disclaimer');
    setMessages([]);
    setReportData(null);
    setRecipients(null);
    setResources(null);
    setError(null);
    setIsGeneratingReport(false);
    setIsWriting(false);
    setIsGeneratingResources(false);
    setActiveAgent('manager');
    setUserProfile(initialUserProfile);
    setIsMenuOpen(false);
    setShowHospitalModal(false);
    setIsHospitalExpanded(false);
    setShowNearestHospital(false);
    setShowMap(false);
  };
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
  const [showMap, setShowMap] = useState(false);

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
    // Fetch hospital wait times
    fetch("https://edwaittimes.ca/api/wait-times")
      .then((response) => response.json())
      .then((data) => {
        setWaitTimes(data);
        setLoading(false);
        try {
          localStorage.setItem('hospital_wait_times', JSON.stringify(data));
        } catch (e) {
          console.error('Failed to save hospital wait times to localStorage:', e);
        }
      })
      .catch((error) => {
        console.error("Error fetching wait times:", error);
        setLoading(false);
      });
    // Load victim support resources from local file into localStorage
    fetch('/info-data/victim_support.json')
      .then((response) => response.json())
      .then((data) => {
        try {
          localStorage.setItem('victim_support_resources', JSON.stringify(data));
        } catch (e) {
          console.error('Failed to save victim support resources to localStorage:', e);
        }
      })
      .catch((error) => {
        console.error('Error loading victim support resources:', error);
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

  // Request user location on mount
  useEffect(() => {
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
  }, []);

  const handleStartChat = useCallback(() => {
    if (!aiRef.current) {
        setError("AI service is not initialized. Please refresh the page.");
        return;
    }
    let hospitalData = [];
    try {
      const stored = localStorage.getItem('hospital_wait_times');
      if (stored) {
        const rawData = JSON.parse(stored);
        hospitalData = rawData.map(h => ({
          name: h.name,
          address: h.address,
          latitude: h.latitude,
          longitude: h.longitude,
          waitTime: h.waitTime?.waitTimeMinutes ?? null,
          open247: !!h.open247
        }));
      }
    } catch (e) {
      console.error('Failed to load hospital data from localStorage:', e);
    }
    // Prepare a summary string for Gemini
    let hospitalSummary = '';
    if (hospitalData && hospitalData.length > 0) {
      hospitalSummary = '\n---\nHOSPITAL DATA (JSON):\n' + JSON.stringify(hospitalData, null, 2) + '\n---';
    }

    // Victim support resource filtering
    let victimResources = [];
    try {
      const stored = localStorage.getItem('victim_support_resources');
      if (stored) {
        const rawResources = JSON.parse(stored);
        // Filter by type/description match and nearest location
        if (messages.length > 0 && userLocation) {
          const lastMsg = messages[messages.length - 1].text?.toLowerCase() || '';
          // Find resources matching type/description
          const filtered = rawResources.filter(r => {
            return (
              (r.type && lastMsg.includes(r.type.toLowerCase())) ||
              (r.description && lastMsg.includes(r.description.toLowerCase()))
            );
          });
          // Sort by distance to user
          const withDistance = filtered.map(r => {
            // Try to parse coordinates from address (if available)
            // For demo, use city match only
            let dist = 99999;
            if (r.city && userProfile.location) {
              dist = r.city.toLowerCase() === userProfile.location.toLowerCase() ? 0 : 99999;
            }
            return { ...r, dist };
          });
          victimResources = withDistance.sort((a, b) => a.dist - b.dist).slice(0, 1); // Only nearest
        }
      }
    } catch (e) {
      console.error('Failed to load victim support resources from localStorage:', e);
    }
    let victimResourceSummary = '';
    if (victimResources.length > 0) {
      const r = victimResources[0];
      victimResourceSummary = `\n---\nVICTIM SUPPORT RESOURCE:\nName: ${r.name}\nDescription: ${r.description}\nWebsite: ${r.website}\nPhone: ${r.phone}\nAddress: ${r.address}\n---`;
    }
    try {
      // Add hospital data to userProfile context and system prompt
      const userProfileWithHospitals = {
        ...userProfile,
        hospitalData
      };
      const prependToPrompt = (basePrompt: string) => `${hospitalSummary}\n${basePrompt}`;
      managerChatRef.current = createAgent(aiRef.current, prependToPrompt(MANAGER_PROMPT), userProfileWithHospitals);
      infoChatRef.current = createAgent(aiRef.current, prependToPrompt(INFO_PROMPT), userProfileWithHospitals);
      locationChatRef.current = createAgent(aiRef.current, prependToPrompt(LOCATION_PROMPT), userProfileWithHospitals);
      offTopicChatRef.current = createAgent(aiRef.current, prependToPrompt(OFFTOPIC_PROMPT), userProfileWithHospitals);

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
  // ...existing code...
  // ...existing code...

  // Utility: Save hospital wait times to local file
  const saveHospitalWaitTimesSnapshot = useCallback(() => {
    try {
      // Only save if waitTimes is non-empty
      if (waitTimes && waitTimes.length > 0) {
        fetch('/data/hospital_wait_times_snapshot.json', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(waitTimes, null, 2)
        });
      }
    } catch (e) {
      console.error('Failed to save hospital wait times snapshot:', e);
    }
  }, [waitTimes]);

  // Utility: Calculate distance between two lat/lng points
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

  const [showIconInfo, setShowIconInfo] = useState(false);
  const [showImageInfo, setShowImageInfo] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const AppHeader = () => {
    // Always render icons as fixed, repositioned, and visible
    const iconStyle: React.CSSProperties = {
      position: 'fixed',
      top: appState === 'chat' ? '180px' : '32px',
      left: '32px',
      zIndex: 2000,
      display: 'flex',
      flexDirection: (appState === 'chat' ? 'column' : 'row') as 'row' | 'column',
      gap: '16px',
      alignItems: 'center',
    };
    return (
      <div style={iconStyle}>
        <button className={`flex items-center justify-center w-10 h-10 ${darkMode ? 'text-white bg-black' : 'text-blue-700 bg-white'} transition-colors duration-200 rounded-full bg-opacity-20 backdrop-blur-sm hover:bg-blue-200`} onClick={() => setShowImageInfo(true)}>
          <ResourcesIcon />
        </button>
        <button className={`flex items-center justify-center w-10 h-10 ${darkMode ? 'text-white bg-black' : 'text-blue-700 bg-white'} transition-colors duration-200 rounded-full bg-opacity-20 backdrop-blur-sm hover:bg-blue-200`} onClick={() => setDarkMode(!darkMode)} aria-label="Toggle dark mode">
          {darkMode ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v2M12 19v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42M12 7a5 5 0 100 10 5 5 0 000-10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 12.79A9 9 0 1111.21 3a7 7 0 109.79 9.79z" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          )}
        </button>
        {/* Popup for image info */}
        {showImageInfo && (
          <div style={{
            position: 'fixed',
            top: appState === 'chat' ? '240px' : '80px',
            left: '32px',
            background: '#fff',
            color: '#222',
            padding: '1rem 2rem',
            borderRadius: '1rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 2100,
            minWidth: '260px',
            textAlign: 'center'
          }}>
            <div style={{marginBottom: '0.5rem', fontWeight: 'bold'}}>Background Image Info</div>
            <div>Image source: <a href="https://unsplash.com/photos/green-northern-lights-xGltqb1ChYw" target="_blank" rel="noopener noreferrer">Unsplash: Green Northern Lights by Luke Stackpoole</a></div>
            <button style={{marginTop: '1rem', background: '#0f172a', color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 16px', cursor: 'pointer'}} onClick={() => setShowImageInfo(false)}>Close</button>
          </div>
        )}
      </div>
    );
  };

  // Set background and text color based on mode
  React.useEffect(() => {
    const body = document.body;
    if (darkMode) {
      body.style.backgroundImage = "url('https://images.unsplash.com/photo-1508402476522-c77c2fa4479d?q=80&w=2070&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D')";
      body.style.backgroundSize = "cover";
      body.style.backgroundPosition = "center";
      body.style.color = "#e2e8f0";
    } else {
      body.style.backgroundImage = "url('https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1500&q=80')";
      body.style.backgroundSize = "cover";
      body.style.backgroundPosition = "center";
      body.style.color = "#222";
    }
  }, [darkMode]);

  return (
    <div className={`relative flex flex-col h-screen font-sans ${darkMode ? 'text-slate-200' : 'text-black'}`}
      style={{background: 'transparent'}}>
      {/* Always visible exit button, top left, above hospitals */}
      <button
        style={{
          position: "fixed",
          top: "24px",
          left: "24px",
          zIndex: 2000,
          background: darkMode ? "#0f172a" : "#fff",
          color: darkMode ? "#fff" : "#222",
          border: "none",
          borderRadius: "8px",
          padding: "8px 16px",
          fontSize: "1rem",
          fontWeight: "bold",
          boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
          cursor: "pointer"
        }}
        onClick={() => window.location.href = "https://google.com"}
        aria-label="Exit"
      >
        Exit
      </button>
      {appState !== 'chat' && <AppHeader />}
      {/* Floating nearest hospital component + location identifier below */}
  {isScreenWide && userLocation && nearestHospitals.length > 0 && (
        <div style={{ position: "fixed", top: "80px", left: "32px", zIndex: 50, maxWidth: "350px" }}>
          {/* Nearest hospital info styled like location identifier, less bright */}
          <div
            style={{
              background: darkMode ? "rgba(51,65,85,0.85)" : "rgba(255,255,255,0.85)",
              color: darkMode ? "#fff" : "#222",
              padding: "0.75rem 1.5rem",
              borderRadius: "1rem",
              boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
              fontSize: "1rem",
              textAlign: "left",
              marginBottom: "0.5rem"
            }}
          >
            <div style={{fontWeight: 'bold', marginBottom: '0.5rem'}}>Nearest Hospitals</div>
            {nearestHospitals.map((entry, idx) => {
              const waitTime = entry.hospital.waitTime?.waitTimeMinutes;
              let waitStr = "N/A";
              if (typeof waitTime === "number") {
                const hr = Math.floor(waitTime / 60);
                const min = waitTime % 60;
                waitStr = hr > 0 ? `${hr} hr ${min} min` : `${min} min`;
              }
              const mapUrl = `https://www.google.com/maps/search/?api=1&query=${entry.hospital.latitude},${entry.hospital.longitude}`;
              return (
                <div key={entry.hospital.id} style={{ marginBottom: "0.5rem", display: 'flex', flexDirection: 'column' }}>
                  <a
                    href={mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontWeight: 'bold',
                      color: darkMode ? '#38bdf8' : '#0ea5e9',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      fontSize: '1.05rem',
                      marginBottom: '0.2rem',
                      width: 'fit-content'
                    }}
                  >
                    {idx === 0 ? "Nearest" : `#${idx + 1}`} Hospital: {entry.hospital.name}
                  </a>
                  <span style={{fontSize: '0.95rem'}}>Wait Time: {waitStr}</span>
                </div>
              );
            })}
          </div>
          {/* Location identifier directly below hospital info, less bright */}
          <div
            style={{
              background: darkMode ? "rgba(51,65,85,0.85)" : "rgba(255,255,255,0.85)",
              color: darkMode ? "#fff" : "#222",
              padding: "0.75rem 1.5rem",
              borderRadius: "1rem",
              boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
              fontSize: "1rem",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              cursor: "pointer"
            }}
            onClick={() => setShowMap(true)}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '0.5rem'}}><path d="M21 10.5a8.38 8.38 0 01-1.9 5.4c-1.5 2-4.1 5.1-4.1 5.1a1.38 1.38 0 01-2 0s-2.6-3.1-4.1-5.1A8.38 8.38 0 013 10.5 7.5 7.5 0 0112 3a7.5 7.5 0 019 7.5z"></path><circle cx="12" cy="10.5" r="2.5"></circle></svg>
            <div>
              <div style={{fontWeight: 'bold'}}>Your Location</div>
              <div style={{fontSize: '0.95rem'}}>Lat: {userLocation.lat}, Lng: {userLocation.lng}</div>
              <div style={{fontSize: '0.85rem', opacity: 0.7}}>Click to expand map</div>
            </div>
          </div>
        </div>
      )}

      {/* Expandable Google Map Modal */}
      {userLocation && showMap && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "80vw",
            height: "60vh",
            background: darkMode ? "#334155" : "#fff",
            color: darkMode ? "#fff" : "#222",
            zIndex: 200,
            borderRadius: "16px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center"
          }}
        >
        {isScreenWide && userLocation && (
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
      </main>
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
            background: darkMode ? "#0f172a" : "#fff",
            color: darkMode ? "#fff" : "#222",
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
            background: darkMode ? "#1e293b" : "#fff",
            color: darkMode ? "#fff" : "#222",
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
              onClick={() => setShowLocationModal(true)}
            >
              Your Location
            </div>
            <a
              href="https://www.rainn.org/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "block",
                fontWeight: "bold",
                marginBottom: "12px",
                color: darkMode ? "#fff" : "#222",
                textDecoration: "underline"
              }}
            >
              RAINN.org (Support Chat)
            </a>
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
            {/* Emergency Resources link removed as requested */}
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
            background: darkMode ? "#334155" : "#fff",
            color: darkMode ? "#fff" : "#222",
            zIndex: 200,
            borderRadius: "16px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
            padding: "32px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column"
          }}
        >
          {/* Hospital modal content should go here, e.g. hospital list rendering */}
          {userProfile.hospitalData && userProfile.hospitalData.length > 0 ? (
            userProfile.hospitalData.map((entry, idx) => {
              const waitTime = entry.waitTime;
              return (
                <div key={entry.name} style={{ marginBottom: "1rem", fontSize: "1.1rem" }}>
                  <strong>{idx === 0 ? "Nearest" : `#${idx + 1}`} Hospital: {entry.name}</strong><br />
                  Wait Time: {waitTime ?? "N/A"} minutes<br />
                  Address: {entry.address}<br />
                  {entry.latitude && entry.longitude && (
                    <a href={`https://www.google.com/maps/search/?api=1&query=${entry.latitude},${entry.longitude}`} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>Open in Google Maps</a>
                  )}
                  {entry.open247 && <span style={{ marginLeft: '8px', color: '#16a34a' }}>(24/7)</span>}
                </div>
              );
            })
          ) : (
            <div>No hospital data available.</div>
          )}
        </div>
      )}
      {/* Location Modal */}
      {showLocationModal && (
        <div
          style={{
            position: "fixed",
            top: "50px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "400px",
            background: darkMode ? "#334155" : "#fff",
            color: darkMode ? "#fff" : "#222",
            zIndex: 200,
            borderRadius: "16px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.25)",
            padding: "32px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center"
          }}
        >
          <button
            onClick={() => setShowLocationModal(false)}
            style={{
              alignSelf: "flex-end",
              background: darkMode ? "#0f172a" : "#fff",
              color: darkMode ? "#fff" : "#222",
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
          <h2 style={{ marginBottom: "16px" }}>Your Location</h2>
          {userLocation ? (
            <div style={{ fontSize: "1.1rem", textAlign: "center" }}>
              <div><strong>Latitude:</strong> {userLocation.lat}</div>
              <div><strong>Longitude:</strong> {userLocation.lng}</div>
            </div>
          ) : (
            <div>Location not available.</div>
          )}
        </div>
      )}
    </div>
  );
};


export default App;

import type { Chat } from '@google/genai';
import { GoogleGenAI } from '@google/genai';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ChatScreen from './components/ChatScreen';
import DisclaimerScreen from './components/DisclaimerScreen';
import { ExternalLinkIcon } from './components/icons';
import ReportScreen from './components/ReportScreen';
import ResourcesScreen from './components/ResourcesScreen';
import TutorialOverlay from './components/TutorialOverlay';
import WaitTimeMenu from './components/WaitTimeMenu';
import { initialUserProfile } from './data/userProfile';
import { createAgent, INFO_PROMPT, LOCATION_PROMPT, MANAGER_PROMPT, OFFTOPIC_PROMPT } from './services/agents';
import { generateReport, generateResources } from './services/geminiService';
import type { Message, Recipient, ReportData, Resource, UserProfile } from './types';
import { MessageAuthor } from './types';

type AppState = 'disclaimer' | 'chat' | 'report' | 'resources';
export type AgentType = 'manager' | 'info' | 'location' | 'offtopic';

// ── Shared close icon ──────────────────────────────────────────────────────
const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// ── App ────────────────────────────────────────────────────────────────────
const App: React.FC = () => {
  // ── State ────────────────────────────────────────────────
  const [appState, setAppState]                     = useState<AppState>('disclaimer');
  const [messages, setMessages]                     = useState<Message[]>([]);
  const [reportData, setReportData]                 = useState<ReportData | null>(null);
  const [recipients, setRecipients]                 = useState<Recipient[] | null>(null);
  const [resources, setResources]                   = useState<Resource[] | null>(null);
  const [error, setError]                           = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isWriting, setIsWriting]                   = useState(false);
  const [isGeneratingResources, setIsGeneratingResources] = useState(false);
  const [activeAgent, setActiveAgent]               = useState<AgentType>('manager');
  const [userProfile, setUserProfile]               = useState<UserProfile>(initialUserProfile);
  const [isMenuOpen, setIsMenuOpen]                 = useState(false);
  const [showHospitalModal, setShowHospitalModal]   = useState(false);
  const [waitTimes, setWaitTimes]                   = useState<any[]>([]);
  const [userLocation, setUserLocation]             = useState<{ lat: number; lng: number } | null>(null);
  const [showMap, setShowMap]                       = useState(false);
  const [darkMode, setDarkMode]                     = useState(true);
  const [initialPrompt, setInitialPrompt]           = useState<string | null>(null);
  const [showTutorial, setShowTutorial]             = useState(false);

  // ── Refs ─────────────────────────────────────────────────
  const aiRef           = useRef<GoogleGenAI | null>(null);
  const managerChatRef  = useRef<Chat | null>(null);
  const infoChatRef     = useRef<Chat | null>(null);
  const locationChatRef = useRef<Chat | null>(null);
  const offTopicChatRef = useRef<Chat | null>(null);

  // ── Reset ─────────────────────────────────────────────────
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
    setShowMap(false);
    setInitialPrompt(null);
  };

  // ── Init AI ───────────────────────────────────────────────
  useEffect(() => {
    try {
      const apiKey = process.env.API_KEY;
      if (!apiKey) throw new Error('API_KEY not found');
      aiRef.current = new GoogleGenAI({ apiKey });
    } catch (e) {
      console.error(e);
      setError('Could not initialize the AI service. Please check your configuration.');
    }
  }, []);

  // ── Fetch hospital data + resources ───────────────────────
  useEffect(() => {
    fetch('https://edwaittimes.ca/api/wait-times')
      .then(r => r.json())
      .then(data => {
        setWaitTimes(data);
        try { localStorage.setItem('hospital_wait_times', JSON.stringify(data)); } catch {}
      })
      .catch(e => console.error('Error fetching wait times:', e));

    fetch('/info-data/victim_support.json')
      .then(r => r.json())
      .then(data => {
        try { localStorage.setItem('victim_support_resources', JSON.stringify(data)); } catch {}
      })
      .catch(e => console.error('Error loading victim support resources:', e));
  }, []);

  // ── Sync location → profile ────────────────────────────────
  useEffect(() => {
    if (userLocation) {
      setUserProfile(prev => ({
        ...prev,
        location: `Lat: ${userLocation.lat}, Lng: ${userLocation.lng}`,
      }));
    }
  }, [userLocation]);

  // ── Request geolocation ────────────────────────────────────
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setError('Could not get your location.'),
      );
    }
  }, []);

  // ── Auto-show tutorial on first visit ─────────────────────
  useEffect(() => {
    try {
      if (!localStorage.getItem('tutorial_seen')) setShowTutorial(true);
    } catch {}
  }, []);

  const handleCloseTutorial = () => {
    setShowTutorial(false);
    try { localStorage.setItem('tutorial_seen', '1'); } catch {}
  };

  // ── Background image per mode ──────────────────────────────
  useEffect(() => {
    const body = document.body;
    body.style.backgroundImage = darkMode
      ? "url('https://images.unsplash.com/photo-1508402476522-c77c2fa4479d?q=80&w=2070&auto=format&fit=crop')"
      : "url('https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1500&q=80')";
    body.style.backgroundSize     = 'cover';
    body.style.backgroundPosition = 'center';
    body.style.color              = darkMode ? '#e2e8f0' : '#222';
  }, [darkMode]);

  // ── Utility: Haversine distance ────────────────────────────
  function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Nearest hospitals (used by sidebar AND injected into chat) ────────────
  const allHospitalsSorted = userLocation && waitTimes.length > 0
    ? [...waitTimes]
        .map(h => ({ hospital: h, dist: parseFloat(getDistance(userLocation.lat, userLocation.lng, h.latitude, h.longitude).toFixed(2)) }))
        .sort((a, b) => a.dist - b.dist)
    : [];

  const nearestHospitals = allHospitalsSorted.slice(0, 2);

  // ── Start chat ─────────────────────────────────────────────
  const handleStartChat = useCallback((prompt?: string) => {
    if (!aiRef.current) {
      setError('AI service is not available. Please check your API key and refresh.');
      return;
    }
    if (prompt) setInitialPrompt(prompt);
    // Use the already-computed sorted hospital list from the sidebar — no re-sorting needed
    const hospitalData = allHospitalsSorted.map(({ hospital: h, dist }) => ({
      name: h.name,
      address: h.address,
      phone: h.phone ?? null,
      website: h.website ?? null,
      distanceKm: dist,
      waitTimeMinutes: h.waitTime?.waitTimeMinutes ?? null,
      open247: !!h.open247,
    }));

    let victimSupportData: any[] = [];
    try {
      const stored = localStorage.getItem('victim_support_resources');
      if (stored) victimSupportData = JSON.parse(stored);
    } catch (e) { console.error('Failed to load victim support data:', e); }

    // Pre-sort victim support resources by distance (province-wide resources with null lat go last)
    if (userLocation && victimSupportData.length > 0) {
      victimSupportData = victimSupportData
        .map((r: any) => ({
          ...r,
          distanceKm: (r.lat != null && r.lng != null)
            ? parseFloat(getDistance(userLocation.lat, userLocation.lng, r.lat, r.lng).toFixed(2))
            : null,
        }))
        .sort((a: any, b: any) => {
          if (a.distanceKm === null) return 1;
          if (b.distanceKm === null) return -1;
          return a.distanceKm - b.distanceKm;
        });
    }

    const hospitalSummary = hospitalData.length > 0
      ? '\n---\nHOSPITALS (pre-sorted nearest first, index 0 = closest). Use index 0 as the primary recommendation:\n' + JSON.stringify(hospitalData, null, 2) + '\n---'
      : '';

    const victimSupportSummary = victimSupportData.length > 0
      ? '\n---\nVICTIM SUPPORT RESOURCES (pre-sorted nearest first, distanceKm=null means province-wide):\n' + JSON.stringify(victimSupportData, null, 2) + '\n---'
      : '';

    try {
      const userProfileWithHospitals = { ...userProfile, hospitalData };
      const prepend = (base: string) => `${hospitalSummary}${victimSupportSummary}\n${base}`;
      managerChatRef.current  = createAgent(aiRef.current, prepend(MANAGER_PROMPT),  userProfileWithHospitals);
      infoChatRef.current     = createAgent(aiRef.current, prepend(INFO_PROMPT),     userProfileWithHospitals);
      locationChatRef.current = createAgent(aiRef.current, prepend(LOCATION_PROMPT), userProfileWithHospitals);
      offTopicChatRef.current = createAgent(aiRef.current, prepend(OFFTOPIC_PROMPT), userProfileWithHospitals);

      setMessages([{
        author: MessageAuthor.AI,
        text: "Hello. I'm here to listen and support you in a safe and confidential space. Please feel free to share what's on your mind when you're ready. Remember, this is not a substitute for professional help.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
      setActiveAgent('manager');
      setAppState('chat');
      setIsWriting(false);
    } catch (e) {
      console.error(e);
      setError('Could not initialize the AI assistant. Please check your API key and refresh the page.');
    }
  }, [userProfile, allHospitalsSorted, userLocation]);

  // ── Generate report ────────────────────────────────────────
  const handleGenerateReport = useCallback(async () => {
    setIsGeneratingReport(true);
    setError(null);
    try {
      if (!aiRef.current) throw new Error('AI not initialized');
      const result = await generateReport(aiRef.current, messages, userProfile);
      setReportData(result.report);
      setRecipients(result.recipients);
      setAppState('report');
    } catch (e) {
      console.error(e);
      setError("I'm sorry, I encountered an error while generating the report. Please try again.");
    } finally {
      setIsGeneratingReport(false);
    }
  }, [messages, userProfile]);

  // ── Generate resources ─────────────────────────────────────
  const handleGenerateResources = useCallback(async () => {
    setIsGeneratingResources(true);
    setError(null);
    try {
      if (!aiRef.current) throw new Error('AI not initialized');
      const result = await generateResources(aiRef.current, messages, userProfile);
      setResources(result.resources);
      setAppState('resources');
    } catch (e) {
      console.error(e);
      setError("I'm sorry, I encountered an error while compiling resources. Please try again.");
    } finally {
      setIsGeneratingResources(false);
    }
  }, [messages, userProfile]);

  const handleBackToChat = () => setAppState('chat');

  // ── Hospital wait time formatter ───────────────────────────
  const formatHospitalForMenu = (h: any) => {
    let waitTimeStr = 'N/A';
    if (h.waitTime && typeof h.waitTime.waitTimeMinutes === 'number') {
      const mins = h.waitTime.waitTimeMinutes;
      const hPart = Math.floor(mins / 60);
      const mPart = mins % 60;
      waitTimeStr = `${hPart > 0 ? hPart + 'h ' : ''}${mPart}m`;
    }
    return {
      name: h.name,
      address: h.address,
      city: h.city || h.region || '',
      waitTime: waitTimeStr,
      updated: h.waitTime?.createdAt
        ? `Updated ${new Date(h.waitTime.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : 'Updated just now',
      note: h.notes || h.openStatus || h.description || '',
      distance: userLocation
        ? getDistance(userLocation.lat, userLocation.lng, h.latitude, h.longitude).toFixed(2) + ' km'
        : undefined,
    };
  };

  // ── Screen content ─────────────────────────────────────────
  const renderContent = () => {
    switch (appState) {
      case 'disclaimer':
        return (
          <DisclaimerScreen
            onAccept={() => handleStartChat()}
            onSelectPrompt={(prompt) => handleStartChat(prompt)}
            error={error}
            darkMode={darkMode}
          />
        );
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
            initialPrompt={initialPrompt}
            onInitialPromptSent={() => setInitialPrompt(null)}
            darkMode={darkMode}
          />
        );
      case 'report':
        return (
          <div className="flex-1 overflow-y-auto">
            <ReportScreen
              reportData={reportData}
              recipients={recipients}
              onBackToChat={handleBackToChat}
              onStartOver={handleStartOver}
              darkMode={darkMode}
            />
          </div>
        );
      case 'resources':
        return (
          <div className="flex-1 overflow-y-auto">
            <ResourcesScreen
              resources={resources}
              onBackToChat={handleBackToChat}
              onStartOver={handleStartOver}
              darkMode={darkMode}
            />
          </div>
        );
      default:
        return (
          <DisclaimerScreen
            onAccept={() => handleStartChat()}
            onSelectPrompt={(prompt) => handleStartChat(prompt)}
            error={error}
            darkMode={darkMode}
          />
        );
    }
  };

  // ── Tailwind helpers (mode-aware) ──────────────────────────
  const dm = darkMode;
  const surface   = dm ? 'bg-slate-900'  : 'bg-white';
  const surface2  = dm ? 'bg-slate-800'  : 'bg-gray-50';
  const border    = dm ? 'border-slate-700/60' : 'border-gray-200';
  const textMain  = dm ? 'text-slate-100' : 'text-gray-900';
  const textMuted = dm ? 'text-slate-500' : 'text-gray-400';
  const rowHover  = dm ? 'hover:bg-white/6' : 'hover:bg-black/4';

  // ── Render ─────────────────────────────────────────────────
  return (
    <div
      className={`flex flex-col overflow-hidden font-sans ${dm ? 'text-slate-200' : 'text-gray-900'}`}
      style={{ height: '100dvh' }}
    >

      {/* ══════════════════════════════════════════════════════
          NAVBAR
      ══════════════════════════════════════════════════════ */}
      <nav
        className={`flex-shrink-0 flex items-center justify-between px-3 sm:px-4 z-30 border-b backdrop-blur-md ${surface}/80 ${border}`}
        style={{ height: '56px' }}
      >
        {/* Hamburger → X */}
        <button
          onClick={() => setIsMenuOpen(prev => !prev)}
          data-tutorial="menu-btn"
          className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors duration-150 ${dm ? 'text-slate-300 hover:bg-white/8' : 'text-gray-600 hover:bg-black/5'}`}
          aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {/* Top bar → rotates to form top of X */}
            <line
              x1="3" y1="6" x2="21" y2="6"
              style={{
                transformOrigin: '12px 12px',
                transform: isMenuOpen ? 'translateY(6px) rotate(45deg)' : 'translateY(0) rotate(0deg)',
                transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
              }}
            />
            {/* Middle bar → fades out */}
            <line
              x1="3" y1="12" x2="21" y2="12"
              style={{
                transformOrigin: '12px 12px',
                opacity: isMenuOpen ? 0 : 1,
                transform: isMenuOpen ? 'scaleX(0.3)' : 'scaleX(1)',
                transition: 'opacity 0.18s ease, transform 0.22s cubic-bezier(0.4,0,0.2,1)',
              }}
            />
            {/* Bottom bar → rotates to form bottom of X */}
            <line
              x1="3" y1="18" x2="21" y2="18"
              style={{
                transformOrigin: '12px 12px',
                transform: isMenuOpen ? 'translateY(-6px) rotate(-45deg)' : 'translateY(0) rotate(0deg)',
                transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
              }}
            />
          </svg>
        </button>

        {/* Title */}
        <span className={`font-semibold text-[15px] tracking-tight select-none ${textMain}`}>
          Afterhour Resources
        </span>

        {/* Exit */}
        <button
          onClick={() => window.location.href = 'https://google.com'}
          data-tutorial="exit-btn"
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-lg transition-colors duration-150 shadow-sm"
          aria-label="Exit to safety"
        >
          Exit
        </button>
      </nav>


      {/* ══════════════════════════════════════════════════════
          SIDEBAR OVERLAY
      ══════════════════════════════════════════════════════ */}
      <div
        className="fixed inset-0 z-40 bg-black/50 modal-overlay"
        style={{
          opacity: isMenuOpen ? 1 : 0,
          pointerEvents: isMenuOpen ? 'auto' : 'none',
        }}
        onClick={() => setIsMenuOpen(false)}
        aria-hidden="true"
      />


      {/* ══════════════════════════════════════════════════════
          SIDEBAR DRAWER
      ══════════════════════════════════════════════════════ */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col shadow-2xl sidebar-drawer ${isMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ width: '288px', background: dm ? '#0f172a' : '#fff' }}
      >
        {/* ── Branded header ─────────────────────────────── */}
        <div
          className="relative flex-shrink-0 px-5 pt-5 pb-4 overflow-hidden"
          style={{
            background: dm
              ? 'linear-gradient(135deg, #0c4a6e 0%, #1e293b 60%)'
              : 'linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 60%)',
          }}
        >
          {/* Decorative circle */}
          <div
            className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-20"
            style={{ background: dm ? '#38bdf8' : '#0ea5e9' }}
          />
          <div className="flex items-start justify-between relative">
            <div>
              <p className={`text-[11px] font-semibold uppercase tracking-widest mb-0.5 ${dm ? 'text-sky-400' : 'text-sky-600'}`}>
                Safe Space
              </p>
              <h2 className={`text-lg font-bold leading-tight ${dm ? 'text-white' : 'text-sky-900'}`}>
                Afterhour<br />Resources
              </h2>
              <p className={`text-xs mt-1.5 leading-snug ${dm ? 'text-sky-200/60' : 'text-sky-700/70'}`}>
                Confidential · Judgment-free
              </p>
            </div>
            <button
              onClick={() => setIsMenuOpen(false)}
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${dm ? 'text-white/50 hover:bg-white/10 hover:text-white' : 'text-sky-700/50 hover:bg-sky-900/10 hover:text-sky-900'}`}
              aria-label="Close menu"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* ── Scroll area ────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">

          {/* ── Nearby section ─────────────────────────────── */}
          {(nearestHospitals.length > 0 || userLocation) && (
            <div>
              <p className={`px-1 mb-1.5 text-[10px] font-bold uppercase tracking-widest ${textMuted}`}>Nearby</p>
              <div className={`rounded-2xl overflow-hidden border ${dm ? 'bg-slate-800/70 border-slate-700/50' : 'bg-gray-50 border-gray-200'}`}>

                {/* Hospital rows */}
                {nearestHospitals.map((entry, idx) => {
                  const waitMins = entry.hospital.waitTime?.waitTimeMinutes;
                  let waitStr = 'N/A';
                  let waitBadge = dm ? 'bg-slate-700 text-slate-400' : 'bg-gray-200 text-gray-500';
                  if (typeof waitMins === 'number') {
                    const hr  = Math.floor(waitMins / 60);
                    const min = waitMins % 60;
                    waitStr   = hr > 0 ? `${hr}h ${min}m` : `${min}m`;
                    waitBadge = waitMins < 60
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-yellow-500/20 text-yellow-400';
                  }
                  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${entry.hospital.latitude},${entry.hospital.longitude}`;
                  return (
                    <a
                      key={idx}
                      href={mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${idx > 0 ? `border-t ${border}` : ''} ${dm ? 'hover:bg-white/5' : 'hover:bg-black/3'}`}
                    >
                      <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-rose-500/15 flex items-center justify-center">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-rose-400">
                          <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium leading-snug truncate ${dm ? 'text-slate-200' : 'text-gray-800'}`}>{entry.hospital.name}</p>
                        <p className={`text-xs mt-0.5 ${textMuted}`}>{entry.dist.toFixed(1)} km away</p>
                      </div>
                      <span className={`flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${waitBadge}`}>{waitStr}</span>
                    </a>
                  );
                })}

                {/* View all */}
                {nearestHospitals.length > 0 && (
                  <button
                    onClick={() => { setShowHospitalModal(true); setIsMenuOpen(false); }}
                    className={`w-full px-3 py-2 text-left text-xs font-semibold border-t transition-colors ${border} ${dm ? 'text-sky-400 hover:bg-white/5' : 'text-sky-600 hover:bg-sky-50'}`}
                  >
                    View all hospitals →
                  </button>
                )}

                {/* Your location */}
                {userLocation && (
                  <button
                    onClick={() => { setShowMap(true); setIsMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors ${nearestHospitals.length > 0 ? `border-t ${border}` : ''} ${dm ? 'hover:bg-white/5' : 'hover:bg-black/3'}`}
                  >
                    <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-sky-500/15 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400">
                        <path d="M21 10.5a8.38 8.38 0 01-1.9 5.4c-1.5 2-4.1 5.1-4.1 5.1a1.38 1.38 0 01-2 0s-2.6-3.1-4.1-5.1A8.38 8.38 0 013 10.5 7.5 7.5 0 0112 3a7.5 7.5 0 019 7.5z"/>
                        <circle cx="12" cy="10.5" r="2.5"/>
                      </svg>
                    </div>
                    <div className="text-left min-w-0">
                      <p className={`text-sm font-medium ${dm ? 'text-slate-200' : 'text-gray-800'}`}>Your Location</p>
                      <p className={`text-xs mt-0.5 truncate ${textMuted}`}>{userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}</p>
                    </div>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Support section ────────────────────────────── */}
          <div>
            <p className={`px-1 mb-1.5 text-[10px] font-bold uppercase tracking-widest ${textMuted}`}>Support</p>
            <div className={`rounded-2xl overflow-hidden border ${dm ? 'bg-slate-800/70 border-slate-700/50' : 'bg-gray-50 border-gray-200'}`}>
              <a
                href="https://www.rainn.org/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${dm ? 'hover:bg-white/5' : 'hover:bg-black/3'}`}
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-violet-500/15 flex items-center justify-center">
                  <ExternalLinkIcon className="text-violet-400" />
                </div>
                <div className="text-left">
                  <p className={`text-sm font-medium ${dm ? 'text-slate-200' : 'text-gray-800'}`}>RAINN.org</p>
                  <p className={`text-xs ${textMuted}`}>24/7 online support chat</p>
                </div>
              </a>

              <button
                onClick={() => { setShowTutorial(true); setIsMenuOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors border-t ${border} ${dm ? 'hover:bg-white/5' : 'hover:bg-black/3'}`}
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-indigo-500/15 flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <div className="text-left">
                  <p className={`text-sm font-medium ${dm ? 'text-slate-200' : 'text-gray-800'}`}>Take a Tour</p>
                  <p className={`text-xs ${textMuted}`}>See how this app works</p>
                </div>
              </button>
            </div>
          </div>

          {/* ── Preferences section ────────────────────────── */}
          <div>
            <p className={`px-1 mb-1.5 text-[10px] font-bold uppercase tracking-widest ${textMuted}`}>Preferences</p>
            <div className={`rounded-2xl border ${dm ? 'bg-slate-800/70 border-slate-700/50' : 'bg-gray-50 border-gray-200'}`}>
              <button
                onClick={() => setDarkMode(!dm)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors rounded-2xl ${dm ? 'hover:bg-white/5' : 'hover:bg-black/3'}`}
              >
                <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${dm ? 'bg-amber-500/15' : 'bg-slate-500/10'}`}>
                  {dm ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                      <circle cx="12" cy="12" r="5"/>
                      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
                      <path d="M21 12.79A9 9 0 1111.21 3a7 7 0 109.79 9.79z"/>
                    </svg>
                  )}
                </div>
                <p className={`flex-1 text-sm font-medium text-left ${dm ? 'text-slate-200' : 'text-gray-800'}`}>
                  {dm ? 'Light Mode' : 'Dark Mode'}
                </p>
                {/* Pill toggle */}
                <div className={`relative flex-shrink-0 w-10 h-5.5 rounded-full transition-colors duration-200 ${dm ? 'bg-sky-500' : 'bg-gray-300'}`} style={{ height: '22px', width: '40px' }}>
                  <div
                    className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200"
                    style={{ transform: dm ? 'translateX(20px)' : 'translateX(2px)' }}
                  />
                </div>
              </button>
            </div>
          </div>

          {/* ── New Session ────────────────────────────────── */}
          <button
            onClick={() => { handleStartOver(); setIsMenuOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl border text-left transition-colors ${dm ? 'bg-red-950/40 border-red-900/40 hover:bg-red-900/50' : 'bg-red-50 border-red-200 hover:bg-red-100'}`}
          >
            <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-red-500/20 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
              </svg>
            </div>
            <div>
              <p className={`text-sm font-semibold ${dm ? 'text-red-400' : 'text-red-600'}`}>New Session</p>
              <p className={`text-xs mt-0.5 ${dm ? 'text-red-500/70' : 'text-red-400'}`}>Clears all chat history</p>
            </div>
          </button>

        </div>
      </aside>


      {/* ══════════════════════════════════════════════════════
          MAIN CONTENT
      ══════════════════════════════════════════════════════ */}
      <main className="flex flex-col flex-1 overflow-hidden">
        {renderContent()}
      </main>


      {/* ══════════════════════════════════════════════════════
          MAP MODAL
      ══════════════════════════════════════════════════════ */}
      {userLocation && showMap && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm modal-overlay opacity-100"
          onClick={() => setShowMap(false)}
        >
          <div
            className="modal-panel relative w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl"
            style={{ height: '60vh' }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setShowMap(false)}
              className={`absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full shadow-lg transition-colors duration-150 ${dm ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
              aria-label="Close map"
            >
              <CloseIcon />
            </button>
            <iframe
              title="Your Location Map"
              width="100%"
              height="100%"
              style={{ border: 0, display: 'block' }}
              src={`https://www.google.com/maps?q=${userLocation.lat},${userLocation.lng}&z=15&output=embed`}
              allowFullScreen
              loading="lazy"
            />
          </div>
        </div>
      )}


      {/* ══════════════════════════════════════════════════════
          HOSPITAL WAIT TIMES MODAL
      ══════════════════════════════════════════════════════ */}
      {/* ══════════════════════════════════════════════════════
          TUTORIAL OVERLAY
      ══════════════════════════════════════════════════════ */}
      <TutorialOverlay
        isOpen={showTutorial}
        onClose={handleCloseTutorial}
        darkMode={darkMode}
      />


      {showHospitalModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm modal-overlay opacity-100"
          onClick={() => setShowHospitalModal(false)}
        >
          <div
            className={`modal-panel relative w-full max-w-3xl flex flex-col rounded-2xl shadow-2xl overflow-hidden ${dm ? 'bg-slate-800' : 'bg-white'}`}
            style={{ maxHeight: '80vh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className={`flex items-center justify-between px-6 py-4 border-b flex-shrink-0 ${border}`}>
              <h2 className={`text-lg font-semibold ${textMain}`}>Hospital Wait Times</h2>
              <button
                onClick={() => setShowHospitalModal(false)}
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors duration-150 ${dm ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-black/5 text-gray-400'}`}
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>
            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-4">
              <WaitTimeMenu
                hospitals={waitTimes.map(formatHospitalForMenu)}
                onGetDirections={hospital => {
                  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hospital.address + ' ' + hospital.city)}`);
                }}
                darkMode={darkMode}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

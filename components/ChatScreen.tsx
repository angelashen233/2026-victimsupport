
import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Message, UserProfile } from '../types';
import { MessageAuthor } from '../types';
// FIX: Removed 'LiveSession' which is not an exported member, and aliased 'Blob' to 'GenAIBlob' to avoid conflict with the native DOM Blob type.
import type { Chat, Part, LiveServerMessage, Blob as GenAIBlob, GoogleGenAI } from '@google/genai';
import { Modality } from '@google/genai';
import { GenerateReportIcon, SendIcon, UserIcon, BotIcon, AttachmentIcon, CameraIcon, AudioIcon, ResourcesIcon, MoreVertIcon, MicrophoneIcon, DownloadIcon } from './icons';
import type { AgentType } from '../App';
import { VOICE_PROMPT } from '../services/agents';

// Voice Chat Audio Helpers
function decode(base64: string) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

async function decodeAudioData(
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number,
    numChannels: number,
): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}

function encode(bytes: Uint8Array) {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// FIX: Use GenAIBlob type alias for the return type.
function createBlob(data: Float32Array): GenAIBlob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
}


interface ChatScreenProps {
    ai: GoogleGenAI | null;
    userProfile: UserProfile;
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    chats: {
        manager: Chat | null;
        info: Chat | null;
        location: Chat | null;
        offtopic: Chat | null;
    };
    activeAgent: AgentType;
    setActiveAgent: React.Dispatch<React.SetStateAction<AgentType>>;
    onGenerateReport: () => void;
    isGeneratingReport: boolean;
    onGenerateResources: () => void;
    isGeneratingResources: boolean;
    error: string | null;
    setError: React.Dispatch<React.SetStateAction<string | null>>;
    isWriting: boolean;
    setIsWriting: React.Dispatch<React.SetStateAction<boolean>>;
    initialPrompt?: string | null;
    onInitialPromptSent?: () => void;
    darkMode?: boolean;
}

// Helper for formatting standard text (bold, links, phone numbers)
const formatRegularText = (text: string): React.ReactNode[] => {
  if (!text) return [text];

  // Split by bold, markdown links, and phone numbers
  const regex = /(\*.*?\*)|(\[.*?\]\(.*?\))|((?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}|1-\d{3}-\d{3}-\d{4}|\d{3}-\d{4})/g;
  const parts = text.split(regex).filter(part => part);

  return parts.map((part, index) => {
    // Bold: *text*
    if (part.startsWith('*') && part.endsWith('*')) {
      return <strong key={index}>{part.slice(1, -1)}</strong>;
    }
    // Markdown link: [text](url)
    if (part.startsWith('[') && part.includes('](') && part.endsWith(')')) {
      const linkTextMatch = part.match(/\[(.*?)\]/);
      const urlMatch = part.match(/\((.*?)\)/);
      if (linkTextMatch && urlMatch) {
        return (
          <a key={index} href={urlMatch[1]} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
            {linkTextMatch[1]}
          </a>
        );
      }
    }
    // Phone number — render as a callable button
    if (/^(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}$|^1-\d{3}-\d{3}-\d{4}$|^\d{3}-\d{4}$/.test(part.trim())) {
      const digits = part.replace(/\D/g, '');
      const tel = digits.length === 7 ? `+1604${digits}` : `+${digits.length === 10 ? '1' : ''}${digits}`;
      return (
        <a
          key={index}
          href={`tel:${tel}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 rounded-full text-xs font-semibold bg-sky-700/50 text-sky-300 hover:bg-sky-600/60 border border-sky-600/50 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/>
          </svg>
          {part.trim()}
        </a>
      );
    }
    return part;
  });
};


// Helper function to format message text, now handling collapsible sections and map embeds
const formatMessageText = (text: string): React.ReactNode => {
    if (!text) {
      return text;
    }
    // Strip any [QUICK_REPLIES: ...] tags that weren't removed during parsing
    text = text.replace(/\[QUICK_REPLIES:\s*.*?\]/gs, '').trim();
    const segmentRegex = /(\[MAP_EMBED:[^\]]+\]|\[COLLAPSIBLE_START\][\s\S]*?\[COLLAPSIBLE_END\])/g;
    const parts = text.split(segmentRegex).filter(part => part);

    return parts.map((part, index) => {
        if (part.startsWith('[MAP_EMBED:')) {
            const query = part.replace('[MAP_EMBED:', '').replace(']', '').trim();
            const src = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
            return (
                <div key={index} className="my-3 rounded-lg overflow-hidden border border-slate-600">
                    <iframe
                        src={src}
                        width="100%"
                        height="220"
                        style={{ border: 0 }}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        title={`Map: ${query}`}
                    />
                    <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block px-3 py-1.5 text-xs text-sky-400 hover:text-sky-300 bg-slate-800 text-center"
                    >
                        Open in Google Maps ↗
                    </a>
                </div>
            );
        } else if (part.startsWith('[COLLAPSIBLE_START]')) {
            const content = part.replace('[COLLAPSIBLE_START]', '').replace('[COLLAPSIBLE_END]', '').trim();
            const lines = content.split('\n');
            const title = lines.shift() || 'View Resources';
            const body = lines.join('\n');

            return (
                <details key={index} className="chat-collapsible my-2 p-3 border rounded-lg">
                    <summary className="cursor-pointer font-semibold text-sky-400">{title}</summary>
                    <div className="mt-2 pt-2 border-t whitespace-pre-wrap chat-collapsible-body">
                        {formatRegularText(body)}
                    </div>
                </details>
            );
        } else {
            return formatRegularText(part);
        }
    });
};


const ChatScreen: React.FC<ChatScreenProps> = ({
    ai,
    userProfile,
    messages,
    setMessages,
    chats,
    activeAgent,
    setActiveAgent,
    onGenerateReport,
    isGeneratingReport,
    onGenerateResources,
    isGeneratingResources,
    error,
    setError,
    isWriting,
    setIsWriting,
    initialPrompt,
    onInitialPromptSent,
    darkMode = true,
}) => {
  const dm = darkMode;

  // Mode-aware class helpers
  const msgBubbleAI   = dm ? 'bg-slate-700 text-slate-200 border border-slate-600' : 'bg-white text-gray-900 border border-gray-200';
  const msgBubbleUser = 'bg-sky-600 text-white';
  const surfacePanel  = dm ? 'bg-slate-800' : 'bg-white';
  const surfaceInput  = dm ? 'bg-slate-700/80 border-slate-600/80 text-slate-200 placeholder-slate-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400';
  const surfaceMenu   = dm ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200';
  const menuItem      = dm ? 'text-slate-200 hover:bg-slate-600' : 'text-gray-800 hover:bg-gray-100';
  const iconBtn       = dm ? 'text-slate-300 bg-slate-700 hover:bg-slate-600' : 'text-gray-600 bg-gray-100 hover:bg-gray-200';
  const avatarAI      = dm ? 'bg-sky-900 text-sky-400' : 'bg-sky-100 text-sky-600';
  const avatarUser    = dm ? 'bg-slate-600 text-slate-300' : 'bg-gray-200 text-gray-600';
  const errorBar      = 'bg-red-900/60 text-red-300 border border-red-700/50';
  const collapsible   = dm ? 'bg-slate-800/50 border-slate-600 text-slate-200' : 'bg-gray-50 border-gray-300 text-gray-900';
  const collapsibleDivider = dm ? 'border-slate-500' : 'border-gray-300';
  const quickReplyBtn = dm ? 'bg-slate-700/60 text-slate-300 hover:bg-slate-600/70 border-slate-500/50' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300';

  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [quickRepliesExpanded, setQuickRepliesExpanded] = useState(false);
  const [pinnedResource, setPinnedResource] = useState<{ name: string; phone: string; website?: string } | null>(null);

  const handleDownloadConversation = () => {
    const now = new Date();
    const header = `Afterhour Resources Conversation\nExported: ${now.toLocaleString()}\n${'─'.repeat(40)}\n\n`;
    const text = header + messages
      .map(m => {
        const speaker = m.author === MessageAuthor.USER ? 'You' : 'Afterhour Resources';
        const ts = m.timestamp ? ` [${m.timestamp}]` : '';
        return `${speaker}${ts}:\n${m.text}`;
      })
      .join('\n\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const [showCamera, setShowCamera] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [recordingStatus, setRecordingStatus] = useState<'idle' | 'recording' | 'recorded'>('idle');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  
  // Voice chat refs and state
  const [voiceConnectionStatus, setVoiceConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  // FIX: Changed LiveSession to 'any' as it's not an exported type.
  const liveSessionRef = useRef<Promise<any> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const [streamingInput, setStreamingInput] = useState('');
  const [streamingOutput, setStreamingOutput] = useState('');
  const [micVolume, setMicVolume] = useState(0);
  const animationFrameRef = useRef<number | null>(null);


  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages, streamingInput, streamingOutput]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) {
            setShowActionMenu(false);
        }
        if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
            setShowExportMenu(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
        document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
  
  // Voice Chat Cleanup
  useEffect(() => {
    return () => {
        if (voiceConnectionStatus === 'connected') {
            stopVoiceChat();
        }
    };
  }, [voiceConnectionStatus]);

    const sendMessageToAI = useCallback(async (userMessage: Message) => {
        setIsThinking(true);
        setIsWriting(true);
        setError(null);

    try {
        const parts: Part[] = [{ text: userMessage.text }];
        if (userMessage.image) {
            parts.push({
            inlineData: {
                mimeType: 'image/jpeg',
                data: userMessage.image.split(',')[1] // remove data:image/jpeg;base64,
            }
            });
        }
      
        let responseText: string;

        // Always run the manager first to route every message to the right agent.
        if (!chats.manager) throw new Error("Manager agent not initialized.");
        const routerResult = await chats.manager.sendMessage({ message: parts });
        const route = (routerResult.text ?? '').trim();

        let nextAgent: AgentType = 'info';
        let nextAgentChat: Chat | null = chats.info;

        if (route.includes('[MAP]') || route.includes('[LOCATION]')) {
            nextAgent = 'location';
            nextAgentChat = chats.location ?? chats.info;
        } else if (route.includes('[OFFTOPIC]')) {
            nextAgent = 'offtopic';
            nextAgentChat = chats.offtopic ?? chats.info;
        }
        // [INFO], [DOCS], and anything unrecognized all go to info

        setActiveAgent(nextAgent);

        if (!nextAgentChat) throw new Error(`No agent available — all chat refs are null. Check API key and initialization.`);
        const agentResponse = await nextAgentChat.sendMessage({ message: parts });
        responseText = agentResponse.text ?? '';
      
        // Parse for quick replies
        const quickReplyRegex = /\[QUICK_REPLIES:\s*(.*?)\]/s;
        const match = responseText.match(quickReplyRegex);
        let quickReplies: string[] = [];
        let cleanText = responseText;

        if (match && match[1]) {
            cleanText = responseText.replace(quickReplyRegex, '').trim();
            try {
                quickReplies = JSON.parse(`[${match[1]}]`);
            } catch (e) {
                console.error("Failed to parse quick replies:", e);
            }
        }

        // Parse for pinned resource
        const pinRegex = /\[PIN_RESOURCE:\s*({.*?})\]/s;
        const pinMatch = cleanText.match(pinRegex);
        if (pinMatch) {
            try {
                const pinData = JSON.parse(pinMatch[1]);
                if (pinData.name && pinData.phone) setPinnedResource(pinData);
            } catch {}
            cleanText = cleanText.replace(pinRegex, '').trim();
        }
        
        const aiMessage: Message = { author: MessageAuthor.AI, text: cleanText, quickReplies, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
        setMessages(prev => [...prev, aiMessage]);
    } catch (e: any) {
        console.error("sendMessageToAI error:", e);
        setError(`Error: ${e?.message ?? String(e)}`);
    } finally {
        setIsThinking(false);
        setIsWriting(false);
    }
  }, [activeAgent, chats, setActiveAgent, setError, setMessages]);

  // Auto-send a prompt that was selected on the disclaimer screen
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (initialPrompt && chats.manager && !autoSentRef.current) {
      autoSentRef.current = true;
      const userMessage: Message = { author: MessageAuthor.USER, text: initialPrompt, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
      setMessages(prev => [...prev, userMessage]);
      sendMessageToAI(userMessage);
      onInitialPromptSent?.();
    }
  }, [initialPrompt, chats.manager]);


  const handleSend = async () => {
    if ((!input.trim() && !attachedImage) || isThinking) return;
    const userMessage: Message = { author: MessageAuthor.USER, text: input, image: attachedImage, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setAttachedImage(null);
    await sendMessageToAI(userMessage);
  };
  
  const handleQuickReplyClick = async (replyText: string) => {
      if (isThinking) return;
      const userMessage: Message = { author: MessageAuthor.USER, text: replyText, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
      setMessages(prev => [...prev, userMessage]);
      await sendMessageToAI(userMessage);
  };

  const startVoiceChat = async () => {
    if (!ai) {
        setError("AI not initialized.");
        return;
    }
    setVoiceConnectionStatus('connecting');
    setError(null);

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;

        // FIX: Cast window to 'any' to allow access to vendor-prefixed 'webkitAudioContext' without TypeScript errors.
        inputAudioContextRef.current = new ((window as any).AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        // FIX: Cast window to 'any' to allow access to vendor-prefixed 'webkitAudioContext' without TypeScript errors.
        outputAudioContextRef.current = new ((window as any).AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

        const systemInstruction = `
---
USER CONTEXT:
Location: ${userProfile.location}
Gender: ${userProfile.gender}
---
${VOICE_PROMPT}
        `.trim();

        const sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
                onopen: () => {
                    setVoiceConnectionStatus('connected');
                    audioSourceNodeRef.current = inputAudioContextRef.current!.createMediaStreamSource(stream);
                    audioProcessorNodeRef.current = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);

                    audioProcessorNodeRef.current.onaudioprocess = (audioProcessingEvent) => {
                        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);

                        // Calculate volume and update UI
                        let sum = 0.0;
                        for (let i = 0; i < inputData.length; i++) {
                            sum += inputData[i] * inputData[i];
                        }
                        const rms = Math.sqrt(sum / inputData.length);
                        
                        if (animationFrameRef.current === null) {
                            animationFrameRef.current = requestAnimationFrame(() => {
                                setMicVolume(rms);
                                animationFrameRef.current = null;
                            });
                        }

                        const pcmBlob = createBlob(inputData);
                        liveSessionRef.current?.then((session) => {
                            session.sendRealtimeInput({ media: pcmBlob });
                        });
                    };

                    audioSourceNodeRef.current.connect(audioProcessorNodeRef.current);
                    audioProcessorNodeRef.current.connect(inputAudioContextRef.current!.destination);
                },
                onmessage: async (message: LiveServerMessage) => {
                    if (message.serverContent?.outputTranscription) {
                        setStreamingOutput(prev => prev + message.serverContent.outputTranscription.text);
                    }
                    if (message.serverContent?.inputTranscription) {
                        setStreamingInput(prev => prev + message.serverContent.inputTranscription.text);
                    }
                    if (message.serverContent?.turnComplete) {
                        const newMessages: Message[] = [];
                        const finalInput = streamingInput.trim();
                        const finalOutput = streamingOutput.trim();

                        if (finalInput) {
                            newMessages.push({ author: MessageAuthor.USER, text: finalInput });
                        }
                        if (finalOutput) {
                            newMessages.push({ author: MessageAuthor.AI, text: finalOutput });
                        }
                        if (newMessages.length > 0) {
                            setMessages(prev => [...prev, ...newMessages]);
                        }
                        setStreamingInput('');
                        setStreamingOutput('');
                    }

                    const base64EncodedAudioString = message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
                    if (base64EncodedAudioString) {
                        const outCtx = outputAudioContextRef.current!;
                        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
                        const audioBuffer = await decodeAudioData(decode(base64EncodedAudioString), outCtx, 24000, 1);
                        const source = outCtx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(outCtx.destination);
                        source.addEventListener('ended', () => {
                            outputSourcesRef.current.delete(source);
                        });

                        source.start(nextStartTimeRef.current);
                        nextStartTimeRef.current = nextStartTimeRef.current + audioBuffer.duration;
                        outputSourcesRef.current.add(source);
                    }
                },
                onerror: (e: ErrorEvent) => {
                    console.error('Voice chat error:', e);
                    setError("Voice chat connection error. Please try again.");
                    setVoiceConnectionStatus('error');
                    stopVoiceChat();
                },
                onclose: (_e: CloseEvent) => {
                    stopVoiceChat();
                },
            },
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
                },
                systemInstruction: systemInstruction,
                inputAudioTranscription: {},
                outputAudioTranscription: {},
            },
        });
        liveSessionRef.current = sessionPromise;

    } catch (err) {
        console.error("Failed to start voice chat:", err);
        setError("Could not access microphone. Please check permissions and try again.");
        setVoiceConnectionStatus('error');
    }
  };

  const stopVoiceChat = () => {
    liveSessionRef.current?.then(session => session.close());
    liveSessionRef.current = null;
    
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;

    audioSourceNodeRef.current?.disconnect();
    audioProcessorNodeRef.current?.disconnect();
    audioSourceNodeRef.current = null;
    audioProcessorNodeRef.current = null;
    
    inputAudioContextRef.current?.close();
    outputAudioContextRef.current?.close();
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    
    outputSourcesRef.current.forEach(source => source.stop());
    outputSourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
    }
    setMicVolume(0);
    setStreamingInput('');
    setStreamingOutput('');

    setVoiceConnectionStatus('idle');
  };
  
  const handleToggleVoiceChat = () => {
    if (voiceConnectionStatus === 'connected') {
        stopVoiceChat();
    } else if (voiceConnectionStatus === 'idle' || voiceConnectionStatus === 'error') {
        startVoiceChat();
    }
    // Do nothing if 'connecting'
  };


  const openCamera = async () => {
    setShowActionMenu(false);
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        setShowCamera(true);
        // We need a timeout to let the modal render before accessing videoRef
        setTimeout(() => {
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        }, 100);
      } catch (err) {
        console.error("Error accessing camera: ", err);
        setError("Could not access the camera. Please check permissions.");
      }
    }
  };

  const closeCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    setShowCamera(false);
  };

  const takePicture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setAttachedImage(dataUrl);
        closeCamera();
      }
    }
  };

  const startRecording = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorderRef.current = new MediaRecorder(stream);
        mediaRecorderRef.current.ondataavailable = (event) => {
            audioChunksRef.current.push(event.data);
        };
        mediaRecorderRef.current.onstop = () => {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            const url = URL.createObjectURL(audioBlob);
            setAudioUrl(url);
            setRecordingStatus('recorded');
            audioChunksRef.current = [];
            stream.getTracks().forEach(track => track.stop());
        };
        mediaRecorderRef.current.start();
        setRecordingStatus('recording');
    } catch (err) {
        console.error("Error accessing microphone:", err);
        setError("Could not access the microphone. Please check permissions.");
    }
  };

  const stopRecording = () => {
      if (mediaRecorderRef.current) {
          mediaRecorderRef.current.stop();
      }
  };

  const resetRecorder = () => {
      setAudioUrl(null);
      setRecordingStatus('idle');
  };

  const CameraModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="p-4 bg-slate-800 rounded-lg">
        <video ref={videoRef} autoPlay playsInline className="w-full max-w-md rounded"></video>
        <canvas ref={canvasRef} className="hidden"></canvas>
        <div className="flex justify-center gap-4 mt-4">
          <button onClick={takePicture} className="px-4 py-2 text-white rounded-md bg-sky-600 hover:bg-sky-700">Capture</button>
          <button onClick={closeCamera} className="px-4 py-2 bg-gray-600 rounded-md">Cancel</button>
        </div>
      </div>
    </div>
  );

    const RecorderModal = () => (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
            <div className="p-8 space-y-4 rounded-lg w-96 bg-slate-800">
                <h3 className="text-lg font-medium text-center">Record Audio Memo</h3>
                <p className="text-sm text-center text-slate-400">Record a private audio note to help you remember details. This recording stays on your device and is not sent to the AI.</p>
                {recordingStatus === 'idle' && (
                    <button onClick={startRecording} className="w-full px-4 py-2 text-white rounded-md bg-sky-600 hover:bg-sky-700">Start Recording</button>
                )}
                {recordingStatus === 'recording' && (
                    <div className="flex flex-col items-center gap-4">
                        <div className="flex items-center gap-2 font-mono text-red-500">
                           <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span> Recording...
                        </div>
                        <button onClick={stopRecording} className="w-full px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700">Stop Recording</button>
                    </div>
                )}
                {recordingStatus === 'recorded' && audioUrl && (
                    <div className='space-y-4'>
                        <audio src={audioUrl} controls className="w-full"></audio>
                        <button onClick={resetRecorder} className="w-full px-4 py-2 rounded-md bg-gray-600">Record Again</button>
                    </div>
                )}
                 <button onClick={() => setShowRecorder(false)} className="w-full px-4 py-2 mt-2 bg-transparent border rounded-md border-slate-600">Close</button>
            </div>
        </div>
    );

    const ResourcesModal = () => (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
            <div className="p-8 space-y-4 rounded-lg w-96 bg-slate-800">
                <h3 className="text-lg font-medium">Resources</h3>
                <ul className='space-y-3'>
                    <li><a href="https://www.rainn.org" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">RAINN National Sexual Assault Hotline</a></li>
                    <li><a href="https://www.thehotline.org" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">National Domestic Violence Hotline</a></li>
                    <li><a href="https://988lifeline.org" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">988 Suicide & Crisis Lifeline</a></li>
                </ul>
                <button onClick={() => setShowResources(false)} className="w-full px-4 py-2 mt-4 rounded-md bg-gray-600">Close</button>
            </div>
        </div>
    );

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const quickReplies = lastMessage?.author === MessageAuthor.AI && lastMessage.quickReplies && lastMessage.quickReplies.length > 0 ? lastMessage.quickReplies : null;

  return (
    <div
      data-theme={dm ? 'dark' : 'light'}
      className={`flex flex-col h-full max-w-3xl mx-auto backdrop-blur-sm w-full ${dm ? 'bg-slate-900/60' : 'bg-white/80'}`}
    >
      <style>{`
        [data-theme="light"] .chat-collapsible {
          background: rgba(249,250,251,1);
          border-color: #d1d5db;
          color: #111827;
        }
        [data-theme="light"] .chat-collapsible-body {
          border-color: #d1d5db;
          color: #111827;
        }
        [data-theme="dark"] .chat-collapsible {
          background: rgba(30,41,59,0.5);
          border-color: #475569;
          color: #e2e8f0;
        }
        [data-theme="dark"] .chat-collapsible-body {
          border-color: #64748b;
          color: #e2e8f0;
        }
      `}</style>
      {showCamera && <CameraModal />}
      {showRecorder && <RecorderModal />}
      {showResources && <ResourcesModal />}

      <div className="flex-1 p-4 overflow-y-auto space-y-6">
        {messages.map((msg, index) => (
          <div key={index} className={`flex items-start gap-3 ${msg.author === MessageAuthor.USER ? 'justify-end' : 'justify-start'}`}>
            {msg.author === MessageAuthor.AI && (
              <div className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full ${avatarAI}`}>
                <BotIcon />
              </div>
            )}
            <div className={`max-w-xl px-4 py-3 rounded-2xl ${msg.author === MessageAuthor.USER
                ? `${msgBubbleUser} rounded-br-none`
                : `${msgBubbleAI} rounded-bl-none`}`}>
              {msg.image && <img src={msg.image} alt="User upload" className="object-cover w-full mb-2 rounded-lg max-h-64" />}
              {msg.text && <div className="whitespace-pre-wrap">{formatMessageText(msg.text)}</div>}
            </div>
             {msg.author === MessageAuthor.USER && (
                <div className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full ${avatarUser}`}>
                    <UserIcon />
                </div>
            )}
          </div>
        ))}
        {streamingInput && (
            <div className="flex items-start gap-3 justify-end">
                <div className={`max-w-xl px-4 py-3 rounded-2xl bg-sky-600 text-white rounded-br-none`}>
                    <div className="whitespace-pre-wrap">{streamingInput}</div>
                </div>
                <div className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full ${avatarUser}`}>
                    <UserIcon />
                </div>
            </div>
        )}
        {streamingOutput && (
            <div className="flex items-start gap-3 justify-start">
                <div className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full ${avatarAI}`}>
                    <BotIcon />
                </div>
                <div className={`max-w-xl px-4 py-3 rounded-2xl rounded-bl-none ${msgBubbleAI}`}>
                    <div className="whitespace-pre-wrap">{streamingOutput}</div>
                </div>
            </div>
        )}
                {(isThinking || isWriting) && (
                    <div className="flex items-start gap-3 justify-start">
                        <div className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full ${avatarAI}`}>
                                <BotIcon />
                        </div>
                        <div className={`flex items-center space-x-1 max-w-xl px-4 py-3 rounded-2xl rounded-bl-none ${msgBubbleAI}`}>
                            <span className={`w-2 h-2 rounded-full animate-pulse [animation-delay:-0.3s] ${dm ? 'bg-slate-400' : 'bg-gray-400'}`}></span>
                            <span className={`w-2 h-2 rounded-full animate-pulse [animation-delay:-0.15s] ${dm ? 'bg-slate-400' : 'bg-gray-400'}`}></span>
                            <span className={`w-2 h-2 rounded-full animate-pulse ${dm ? 'bg-slate-400' : 'bg-gray-400'}`}></span>
                        </div>
                    </div>
                )}
        <div ref={messagesEndRef} />
      </div>

      {pinnedResource && (
        <div className="mx-4 mb-2 px-4 py-3 rounded-xl bg-sky-900/60 border border-sky-600/60 backdrop-blur-sm flex items-start gap-3 shadow-lg">
          <div className="flex-shrink-0 mt-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-sky-400">
              <path d="M12 2a7 7 0 017 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 017-7z"/>
              <circle cx="12" cy="9" r="2.5" fill="white"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-sky-300 uppercase tracking-wide mb-0.5">Top Resource</p>
            <p className="text-sm font-medium text-white truncate">{pinnedResource.name}</p>
            <div className="flex flex-wrap gap-2 mt-1.5">
              <a
                href={`tel:${pinnedResource.phone.replace(/\D/g, '')}`}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-700/60 text-sky-200 hover:bg-sky-600/70 border border-sky-500/50 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/>
                </svg>
                {pinnedResource.phone}
              </a>
              {pinnedResource.website && (
                <a
                  href={pinnedResource.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-700/60 text-slate-300 hover:bg-slate-600/70 border border-slate-500/50 transition-colors"
                >
                  Website ↗
                </a>
              )}
            </div>
          </div>
          <button
            onClick={() => setPinnedResource(null)}
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Dismiss"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}

      {error && (
        <div className={`px-4 py-2 mx-4 mb-2 text-sm text-center rounded-md ${errorBar}`}>
          {error}
        </div>
      )}

      <div className={`px-4 pt-3 pb-4 border-t backdrop-blur-sm ${dm ? 'bg-slate-800/90 border-slate-700/70' : 'bg-white/90 border-gray-200'}`}>
         {quickReplies && !streamingInput && !streamingOutput && (
            <div className={`pb-3 mb-3 border-b ${dm ? 'border-slate-700' : 'border-gray-200'}`}>
                <button
                    onClick={() => setQuickRepliesExpanded(prev => !prev)}
                    className={`flex items-center gap-1 mb-2 text-xs font-medium sm:hidden ${dm ? 'text-slate-400 hover:text-slate-200' : 'text-gray-500 hover:text-gray-800'}`}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: quickRepliesExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                        <polyline points="6 9 12 15 18 9" />
                    </svg>
                    {quickRepliesExpanded ? 'Hide suggestions' : 'Show suggestions'}
                </button>
                <div className={`flex flex-wrap items-center gap-2 ${quickRepliesExpanded ? 'flex' : 'hidden'} sm:flex`}>
                    {quickReplies.map((reply, index) => (
                        <button
                            key={index}
                            onClick={() => handleQuickReplyClick(reply)}
                            disabled={isThinking}
                            className={`px-4 py-2 text-sm font-medium transition-colors duration-200 border rounded-full disabled:opacity-50 disabled:cursor-not-allowed ${dm ? 'text-sky-300 bg-sky-900/50 border-sky-800 hover:bg-sky-900' : 'text-blue-900 bg-white border-blue-800 hover:bg-blue-50'}`}
                        >
                            {reply}
                        </button>
                    ))}
                </div>
            </div>
        )}
        {attachedImage && (
            <div className='relative w-24 h-24 p-1 mb-2 border rounded border-slate-600'>
                <img src={attachedImage} alt="Attached preview" className='object-cover w-full h-full rounded' />
                <button onClick={() => setAttachedImage(null)} className='absolute top-0 right-0 flex items-center justify-center w-6 h-6 text-white translate-x-1/2 -translate-y-1/2 bg-gray-800 rounded-full bg-opacity-70 hover:bg-opacity-100'>&times;</button>
            </div>
        )}
        <div className="flex items-center gap-2">
            <div className="relative">
                <button 
                onClick={() => setShowExportMenu(prev => !prev)}
                disabled={isGeneratingReport || isGeneratingResources || messages.length < 2}
                className={`flex items-center justify-center flex-shrink-0 w-12 h-12 rounded-full disabled:opacity-50 disabled:cursor-not-allowed ${iconBtn}`}
                title="Actions Menu"
                >
                {(isGeneratingReport || isGeneratingResources) ? (
                    <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                ) : (
                    <MoreVertIcon />
                )}
                </button>
                {showExportMenu && (
                    <div ref={exportMenuRef} className={`absolute bottom-full left-0 z-10 w-64 mb-2 overflow-hidden border rounded-lg shadow-lg ${surfaceMenu}`}>
                        <button onClick={() => { setShowExportMenu(false); onGenerateReport(); }} className={`flex items-center w-full gap-3 px-4 py-3 text-sm font-medium text-left ${menuItem}`}><GenerateReportIcon /> File an Incident Report</button>
                        <button onClick={() => { setShowExportMenu(false); onGenerateResources(); }} className={`flex items-center w-full gap-3 px-4 py-3 text-sm font-medium text-left ${menuItem}`}><ResourcesIcon /> Compile Resources</button>
                        <button onClick={() => { setShowExportMenu(false); handleDownloadConversation(); }} className={`flex items-center w-full gap-3 px-4 py-3 text-sm font-medium text-left ${menuItem}`}><DownloadIcon /> Save Conversation</button>
                    </div>
                )}
            </div>
          
          <div className="relative flex-1">
             <div className="relative">
                <button onClick={() => setShowActionMenu(prev => !prev)} className="absolute inset-y-0 left-0 flex items-center justify-center w-12 h-12 text-slate-400 hover:text-sky-400">
                    <AttachmentIcon />
                </button>
                {showActionMenu && (
                     <div ref={actionMenuRef} className={`absolute bottom-full left-0 mb-2 w-48 border rounded-lg shadow-lg overflow-hidden ${surfaceMenu}`}>
                        <button onClick={() => { setShowActionMenu(false); setShowResources(true); }} className={`flex items-center w-full gap-3 px-4 py-2 text-left ${menuItem}`}><ResourcesIcon /> Resources</button>
                        <button onClick={openCamera} className={`flex items-center w-full gap-3 px-4 py-2 text-left ${menuItem}`}><CameraIcon /> Take Photo</button>
                        <button onClick={() => { setShowActionMenu(false); setShowRecorder(true); }} className={`flex items-center w-full gap-3 px-4 py-2 text-left ${menuItem}`}><AudioIcon /> Record Audio</button>
                    </div>
                )}
            </div>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Message Afterhour Resources..."
              rows={1}
              className={`w-full px-12 py-3 pr-24 text-sm transition-colors duration-150 border rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-sky-500/70 focus:border-sky-500/50 ${surfaceInput}`}
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-1">
                <button
                    onClick={handleToggleVoiceChat}
                    disabled={!ai || voiceConnectionStatus === 'connecting'}
                    title={voiceConnectionStatus === 'connected' ? 'Stop Voice Chat' : 'Start Voice Chat'}
                    className="flex items-center justify-center w-12 h-12 text-slate-400 hover:text-sky-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <div
                        style={{
                            transform: `scale(${voiceConnectionStatus === 'connected' ? 1 + micVolume * 5 : 1})`,
                            transition: 'transform 75ms linear',
                        }}
                    >
                        <MicrophoneIcon className={`${
                            voiceConnectionStatus === 'connected' ? 'text-red-500' : ''
                        } ${
                            voiceConnectionStatus === 'connecting' ? 'animate-pulse text-sky-500' : ''
                        }`} />
                    </div>
                </button>
                                <button
                                    onClick={handleSend}
                                    disabled={(!input.trim() && !attachedImage) || isThinking}
                                    className="flex items-center justify-center w-10 h-10 text-white transition-colors duration-150 rounded-full bg-sky-500 hover:bg-sky-400 disabled:bg-sky-900 disabled:text-sky-700 disabled:cursor-not-allowed shadow-sm"
                                >
                                    <SendIcon />
                                </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatScreen;

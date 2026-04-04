
import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Message, UserProfile } from '../types';
import { MessageAuthor } from '../types';
// FIX: Removed 'LiveSession' which is not an exported member, and aliased 'Blob' to 'GenAIBlob' to avoid conflict with the native DOM Blob type.
import type { Chat, Part, LiveServerMessage, Blob as GenAIBlob, GoogleGenAI } from '@google/genai';
import { Modality } from '@google/genai';
import { GenerateReportIcon, SendIcon, UserIcon, BotIcon, AttachmentIcon, CameraIcon, AudioIcon, ResourcesIcon, CompileIcon, MicrophoneIcon, DownloadIcon } from './icons';
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
  const [quickRepliesExpanded, setQuickRepliesExpanded] = useState(false);
  const [mobileActionsExpanded, setMobileActionsExpanded] = useState(false);
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [recordingStatus, setRecordingStatus] = useState<'idle' | 'recording' | 'recorded'>('idle');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  
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

    const RESOURCE_CATEGORIES = [
      {
        label: 'Immediate Crisis & Safety',
        color: 'text-red-400',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/></svg>
        ),
        items: [
          { name: 'VictimLink BC (24/7, multilingual)', phone: '1-800-563-0808', url: 'https://victimlinkbc.ca/', note: 'Also text 604-836-6381' },
          { name: 'BC Crisis Centre', phone: '1-800-784-2433', url: 'https://crisiscentre.bc.ca/' },
          { name: 'National Suicide Crisis Helpline (24/7)', phone: '9-8-8', url: null },
          { name: 'Emergency Services', phone: '9-1-1', url: null, note: 'If in immediate danger' },
        ],
      },
      {
        label: 'Medical Care',
        color: 'text-sky-400',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        ),
        items: [
          { name: 'SANE Program — Surrey Memorial Hospital', phone: '604-585-5688', url: 'https://www.fraserhealth.ca/Service-Directory/Services/Hospital-Services/forensic-nursing-service', note: 'Evidence exam within 72 hrs — no police report needed' },
          { name: 'SANE Program — Abbotsford Regional', phone: '604-854-2116', url: null },
          { name: 'BC Gov: Medical care after sexual assault', phone: null, url: 'https://www2.gov.bc.ca/gov/content/safety/public-safety/victim-safety-for-crime-victims/types-of-crime/sexual-assault' },
        ],
      },
      {
        label: 'Counselling & Emotional Support',
        color: 'text-purple-400',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
        ),
        items: [
          { name: 'Salal Sexual Violence Support Centre', phone: '604-255-6344', url: 'https://www.salalsvsc.ca/', note: '24/7 crisis line; toll-free 1-877-392-7583' },
          { name: 'Battered Women\'s Support Services (BWSS)', phone: '604-687-1867', url: 'https://bwss.org/', note: 'Mon–Fri 10am–5pm; crisis line 24/7' },
          { name: 'Vancouver Rape Relief & Women\'s Shelter', phone: '604-872-8212', url: 'https://rapereliefshelter.bc.ca/', note: '24/7 crisis line' },
          { name: 'Ending Violence Association of BC', phone: '604-633-2506', url: 'https://endingviolence.org/services-directory/' },
          { name: 'BC Mental Health & Substance Use Services', phone: '1-888-300-3088', url: 'https://bcmhsus.ca/' },
          { name: 'RAINN Online Hotline (24/7)', phone: null, url: 'https://www.rainn.org/get-help', note: 'Chat available 24/7' },
        ],
      },
      {
        label: 'Legal & Reporting Options',
        color: 'text-yellow-400',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        ),
        items: [
          { name: 'BC Human Rights Tribunal', phone: null, url: 'https://www.bchrt.bc.ca/whocanhelp/sexual-assault/', note: 'Workplace/institution harassment' },
          { name: 'Legal Aid BC', phone: '604-408-2172', url: 'https://legalaid.bc.ca/', note: 'Free legal advice' },
          { name: 'Access Pro Bono BC', phone: null, url: 'https://accessprobono.ca/' },
          { name: 'BC Gov: Reporting options', phone: null, url: 'https://www2.gov.bc.ca/gov/content/safety/public-safety/victim-safety-for-crime-victims/types-of-crime/sexual-assault', note: 'Reporting to police is NOT required for support' },
        ],
      },
      {
        label: 'Financial Assistance',
        color: 'text-green-400',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
        ),
        items: [
          { name: 'Crime Victim Assistance Program (CVAP)', phone: '1-866-660-3888', url: 'https://www2.gov.bc.ca/gov/content/justice/criminal-justice/bcs-criminal-justice-system/after-a-crime/victim-of-crime/financial-assistance-for-victims-of-crime', note: 'Covers medical, counselling, lost wages — no police report required in some cases' },
          { name: 'VictimLink BC referrals', phone: '1-800-563-0808', url: 'https://victimlinkbc.ca/' },
        ],
      },
      {
        label: 'Housing & Emergency Shelter',
        color: 'text-orange-400',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        ),
        items: [
          { name: 'BC Housing Emergency Line', phone: '604-433-2218', url: 'https://www.bchousing.org/' },
          { name: 'BWSS Safe Housing Support', phone: '604-687-1867', url: 'https://bwss.org/' },
          { name: 'Tri-City Transitions (Coquitlam area)', phone: null, url: 'https://www.tricitytransitions.ca/' },
        ],
      },
      {
        label: 'Campus Support',
        color: 'text-indigo-400',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
        ),
        items: [
          { name: 'UBC Sexual Violence Prevention & Response (SVPRO)', phone: '604-822-1588', url: 'https://svpro.ubc.ca/', note: 'Mon–Fri 8:30am–4:30pm' },
          { name: 'UBC AMS Sexual Assault Support Centre (SASC)', phone: null, url: 'https://www.ams.ubc.ca/support-services/sasc/' },
          { name: 'SFU Sexual Violence Support & Prevention', phone: null, url: 'https://www.sfu.ca/sexual-violence-support.html', note: 'Free counselling after intake' },
        ],
      },
    ];

    const ResourcesModal = () => (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowResources(false)}>
        <div
          className={`w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden ${dm ? 'bg-slate-900 border border-slate-700' : 'bg-white border border-gray-200'}`}
          style={{ maxHeight: '85vh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className={`flex items-center justify-between px-5 py-4 border-b flex-shrink-0 ${dm ? 'border-slate-700' : 'border-gray-200'}`}>
            <div>
              <h3 className={`text-base font-semibold ${dm ? 'text-slate-100' : 'text-gray-900'}`}>BC Resources for Sexual Assault Survivors</h3>
              <a
                href="https://www2.gov.bc.ca/gov/content/safety/public-safety/victim-safety-for-crime-victims/types-of-crime/sexual-assault"
                target="_blank" rel="noopener noreferrer"
                className="text-xs text-sky-400 hover:underline"
              >
                gov.bc.ca ↗
              </a>
            </div>
            <button
              onClick={() => setShowResources(false)}
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${dm ? 'text-slate-400 hover:bg-white/10' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {RESOURCE_CATEGORIES.map((cat, ci) => (
              <details key={ci} open={ci === 0} className="group">
                <summary className={`flex items-center gap-2 cursor-pointer list-none py-2 font-semibold text-sm ${cat.color}`}>
                  <span className="flex-shrink-0">{cat.icon}</span>
                  {cat.label}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="ml-auto transition-transform group-open:rotate-180"><polyline points="6 9 12 15 18 9"/></svg>
                </summary>
                <ul className={`mt-1 ml-5 space-y-2 pb-2 border-l pl-3 ${dm ? 'border-slate-700' : 'border-gray-200'}`}>
                  {cat.items.map((item, ii) => (
                    <li key={ii} className="text-sm">
                      <div className={`font-medium ${dm ? 'text-slate-200' : 'text-gray-900'}`}>
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{item.name}</a>
                        ) : item.name}
                      </div>
                      {item.phone && (
                        <a href={`tel:${item.phone.replace(/\D/g,'')}`} className="inline-flex items-center gap-1 mt-0.5 text-xs text-sky-400 hover:underline">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/></svg>
                          {item.phone}
                        </a>
                      )}
                      {item.note && <p className={`text-xs mt-0.5 ${dm ? 'text-slate-500' : 'text-gray-400'}`}>{item.note}</p>}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
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

      {/* ── Desktop-only top action bar ────────────────────────
          Visible on sm+ screens. Sits above the message scroll
          area so "Save Conversation" is always easy to find.  */}
      {messages.length >= 2 && (
        <div className={`hidden sm:flex items-center gap-2 px-4 py-2 border-b flex-shrink-0 ${dm ? 'bg-slate-900/80 border-slate-700/60' : 'bg-white/90 border-gray-200'}`}>
          {/* Save conversation – desktop */}
          <button
            onClick={handleDownloadConversation}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${dm ? 'border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
          >
            <DownloadIcon />
            Save conversation
          </button>
          {/* Local-only note */}
          <span className={`flex items-center gap-1 text-[10px] ${dm ? 'text-slate-600' : 'text-gray-400'}`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            Saved to your device only — never uploaded
          </span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Report */}
          <button
            onClick={onGenerateReport}
            disabled={isGeneratingReport || isGeneratingResources}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border disabled:opacity-40 disabled:cursor-not-allowed ${dm ? 'border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
          >
            {isGeneratingReport
              ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              : <GenerateReportIcon />}
            File incident report
          </button>

          {/* Compile resources */}
          <button
            onClick={onGenerateResources}
            disabled={isGeneratingReport || isGeneratingResources}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border disabled:opacity-40 disabled:cursor-not-allowed ${dm ? 'border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
          >
            {isGeneratingResources
              ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              : <ResourcesIcon />}
            Compile resources
          </button>
        </div>
      )}

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
            <p className={`text-sm font-medium truncate ${dm ? 'text-white' : 'text-gray-900'}`}>{pinnedResource.name}</p>
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
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors border ${dm ? 'bg-slate-700/60 text-slate-300 hover:bg-slate-600/70 border-slate-500/50' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300'}`}
                >
                  Website ↗
                </a>
              )}
            </div>
          </div>
          <button
            onClick={() => setPinnedResource(null)}
            className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors ${dm ? 'text-slate-400 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-gray-700 hover:bg-black/8'}`}
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
            <div className="mb-2">
              {/* Toggle pill — always visible, collapsed by default */}
              <button
                onClick={() => setQuickRepliesExpanded(prev => !prev)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors mb-1.5 ${
                  quickRepliesExpanded
                    ? dm ? 'bg-slate-700 text-slate-300' : 'bg-gray-200 text-gray-700'
                    : dm ? 'bg-slate-800 text-slate-500 hover:text-slate-300 border border-slate-700' : 'bg-gray-100 text-gray-400 hover:text-gray-600 border border-gray-200'
                }`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: quickRepliesExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
                {quickRepliesExpanded ? 'Hide suggestions' : `${quickReplies.length} suggestion${quickReplies.length !== 1 ? 's' : ''}`}
              </button>
              {/* Chips — only shown when expanded */}
              {quickRepliesExpanded && (
                <div className="flex flex-wrap gap-2">
                  {quickReplies.map((reply, index) => (
                    <button
                      key={index}
                      onClick={() => { handleQuickReplyClick(reply); setQuickRepliesExpanded(false); }}
                      disabled={isThinking}
                      className={`px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 border rounded-full disabled:opacity-50 disabled:cursor-not-allowed ${dm ? 'text-sky-300 bg-sky-900/50 border-sky-800 hover:bg-sky-900' : 'text-blue-800 bg-blue-50 border-blue-200 hover:bg-blue-100'}`}
                    >
                      {reply}
                    </button>
                  ))}
                </div>
              )}
            </div>
        )}
        {/* Attached image preview */}
        {attachedImage && (
          <div className='relative w-20 h-20 mb-2'>
            <img src={attachedImage} alt="Attached preview" className='object-cover w-full h-full rounded-xl border border-sky-500/40' />
            <button
              onClick={() => setAttachedImage(null)}
              className='absolute -top-1.5 -right-1.5 flex items-center justify-center w-5 h-5 text-white bg-gray-800 rounded-full hover:bg-gray-700 shadow'
              aria-label="Remove image"
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        )}

        {/* Media toolbar — icon-only to keep the area light */}
        <div className={`flex items-center gap-1 mb-2 ${dm ? 'text-slate-500' : 'text-gray-400'}`}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => setAttachedImage(ev.target?.result as string);
              reader.readAsDataURL(file);
              e.target.value = '';
            }}
          />
          <button onClick={() => fileInputRef.current?.click()} title="Attach photo from device"
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${dm ? 'hover:bg-slate-700 hover:text-slate-300' : 'hover:bg-gray-100 hover:text-gray-600'}`}>
            <AttachmentIcon />
          </button>
          <button onClick={openCamera} title="Take a photo"
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${dm ? 'hover:bg-slate-700 hover:text-slate-300' : 'hover:bg-gray-100 hover:text-gray-600'}`}>
            <CameraIcon />
          </button>
          <button onClick={() => setShowRecorder(true)} title="Record a private audio memo"
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${dm ? 'hover:bg-slate-700 hover:text-slate-300' : 'hover:bg-gray-100 hover:text-gray-600'}`}>
            <AudioIcon />
          </button>

          {/* ··· more actions toggle — mobile only */}
          {messages.length >= 2 && (
            <button
              onClick={() => setMobileActionsExpanded(prev => !prev)}
              title="More actions"
              className={`sm:hidden ml-1 w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                mobileActionsExpanded
                  ? dm ? 'bg-slate-700 text-slate-200' : 'bg-gray-200 text-gray-700'
                  : dm ? 'hover:bg-slate-700 hover:text-slate-300' : 'hover:bg-gray-100 hover:text-gray-600'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
              </svg>
            </button>
          )}
        </div>

        {/* ── Mobile action grid (hidden on sm+, collapsed by default) */}
        {messages.length >= 2 && mobileActionsExpanded && (
          <div className={`sm:hidden grid grid-cols-2 gap-1.5 pb-2 mb-2 border-b ${dm ? 'border-slate-700/60' : 'border-gray-200'}`}>
            {/* Save */}
            <button
              onClick={() => { handleDownloadConversation(); setMobileActionsExpanded(false); }}
              className={`flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl text-xs font-medium transition-colors border ${dm ? 'border-slate-700 text-slate-300 hover:bg-slate-700/60' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}`}
            >
              <DownloadIcon />
              <span>Save chat</span>
              <span className={`flex items-center gap-0.5 text-[9px] font-normal ${dm ? 'text-slate-600' : 'text-gray-400'}`}>
                <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                device only
              </span>
            </button>

            {/* File report */}
            <button
              onClick={() => { onGenerateReport(); setMobileActionsExpanded(false); }}
              disabled={isGeneratingReport || isGeneratingResources}
              className={`flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl text-xs font-medium transition-colors border disabled:opacity-40 disabled:cursor-not-allowed ${dm ? 'border-slate-700 text-slate-300 hover:bg-slate-700/60' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}`}
            >
              {isGeneratingReport
                ? <div className="w-4 h-4 border border-current border-t-transparent rounded-full animate-spin" />
                : <GenerateReportIcon />}
              <span>File report</span>
            </button>

            {/* Compile resources */}
            <button
              onClick={() => { onGenerateResources(); setMobileActionsExpanded(false); }}
              disabled={isGeneratingReport || isGeneratingResources}
              className={`flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl text-xs font-medium transition-colors border disabled:opacity-40 disabled:cursor-not-allowed ${dm ? 'border-slate-700 text-slate-300 hover:bg-slate-700/60' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}`}
            >
              {isGeneratingResources
                ? <div className="w-4 h-4 border border-current border-t-transparent rounded-full animate-spin" />
                : <CompileIcon />}
              <span>Compile list</span>
            </button>

            {/* BC resources drawer */}
            <button
              onClick={() => { setShowResources(true); setMobileActionsExpanded(false); }}
              className={`flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl text-xs font-medium transition-colors border ${dm ? 'border-sky-800/70 text-sky-400 hover:bg-sky-900/40' : 'border-sky-200 text-sky-600 hover:bg-sky-50'}`}
            >
              <ResourcesIcon />
              <span>BC resources</span>
            </button>
          </div>
        )}

        {/* Textarea + send */}
        <div className="relative flex-1">
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
                className={`w-full px-4 py-3 pr-24 text-sm transition-colors duration-150 border rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-sky-500/70 focus:border-sky-500/50 ${surfaceInput}`}
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-1">
                <button
                  onClick={handleToggleVoiceChat}
                  disabled={!ai || voiceConnectionStatus === 'connecting'}
                  title={voiceConnectionStatus === 'connected' ? 'Stop Voice Chat' : 'Start Voice Chat'}
                  className="flex items-center justify-center w-10 h-10 text-slate-400 hover:text-sky-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div style={{ transform: `scale(${voiceConnectionStatus === 'connected' ? 1 + micVolume * 5 : 1})`, transition: 'transform 75ms linear' }}>
                    <MicrophoneIcon className={`${voiceConnectionStatus === 'connected' ? 'text-red-500' : ''} ${voiceConnectionStatus === 'connecting' ? 'animate-pulse text-sky-500' : ''}`} />
                  </div>
                </button>
                <button
                  onClick={handleSend}
                  disabled={(!input.trim() && !attachedImage) || isThinking}
                  className="flex items-center justify-center w-10 h-10 text-white transition-all duration-150 rounded-full bg-sky-500 hover:bg-sky-400 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-sky-500/40"
                >
                  <SendIcon />
                </button>
              </div>
        </div>
      </div>
    </div>
  );
};

export default ChatScreen;


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
}

// Helper for formatting standard text (bold, links)
const formatRegularText = (text: string): React.ReactNode[] => {
  if (!text) {
    return [text];
  }

  // Regex to split by markdown-like bold (*text*) and links ([text](url))
  const regex = /(\*.*?\*)|(\[.*?\]\(.*?\))/g;
  const parts = text.split(regex).filter(part => part);

  return parts.map((part, index) => {
    // Check for bold text: *text*
    if (part.startsWith('*') && part.endsWith('*')) {
      return <strong key={index}>{part.slice(1, -1)}</strong>;
    }
    // Check for links: [text](url)
    if (part.startsWith('[') && part.includes('](') && part.endsWith(')')) {
      const linkTextMatch = part.match(/\[(.*?)\]/);
      const urlMatch = part.match(/\((.*?)\)/);

      if (linkTextMatch && urlMatch) {
        const linkText = linkTextMatch[1];
        const url = urlMatch[1];
        return (
          <a
            key={index}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-400 hover:underline"
          >
            {linkText}
          </a>
        );
      }
    }
    // Plain text
    return part;
  });
};


// Helper function to format message text, now handling collapsible sections
const formatMessageText = (text: string): React.ReactNode => {
    if (!text) {
      return text;
    }
    const collapsibleRegex = /(\[COLLAPSIBLE_START\][\s\S]*?\[COLLAPSIBLE_END\])/g;
    const parts = text.split(collapsibleRegex).filter(part => part);

    return parts.map((part, index) => {
        if (part.startsWith('[COLLAPSIBLE_START]')) {
            const content = part.replace('[COLLAPSIBLE_START]', '').replace('[COLLAPSIBLE_END]', '').trim();
            const lines = content.split('\n');
            const title = lines.shift() || 'View Resources';
            const body = lines.join('\n');

            return (
                <details key={index} className="my-2 p-3 border rounded-lg bg-slate-800/50 border-slate-600">
                    <summary className="cursor-pointer font-semibold text-sky-400">{title}</summary>
                    <div className="mt-2 pt-2 border-t border-slate-500 whitespace-pre-wrap">
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
}) => {
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [quickRepliesExpanded, setQuickRepliesExpanded] = useState(false);

  const handleDownloadConversation = () => {
    const now = new Date();
    const header = `Safe Harbor Conversation\nExported: ${now.toLocaleString()}\n${'─'.repeat(40)}\n\n`;
    const text = header + messages
      .map(m => {
        const speaker = m.author === MessageAuthor.USER ? 'You' : 'Safe Harbor';
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

        // The manager agent only runs if it's currently the active agent.
        // Subsequent turns are handled by the agent the manager delegated to.
        if (activeAgent === 'manager') {
            if (!chats.manager) throw new Error("Manager agent not initialized.");
            const routerResult = await chats.manager.sendMessage({ message: parts });
            const route = routerResult.text.trim();

            let nextAgent: AgentType = 'offtopic';
            let nextAgentChat: Chat | null = chats.offtopic;

            if (route.includes('[INFO]')) {
                nextAgent = 'info';
                nextAgentChat = chats.info;
            } else if (route.includes('[LOCATION]')) {
                nextAgent = 'location';
                nextAgentChat = chats.location;
            }
            
            setActiveAgent(nextAgent);

            if (!nextAgentChat) throw new Error(`${nextAgent} agent not initialized.`);
            const agentResponse = await nextAgentChat.sendMessage({ message: parts });
            responseText = agentResponse.text;
        } else {
            // Use the currently active agent for the conversation
            const currentChat = chats[activeAgent];
            if (!currentChat) throw new Error(`Active agent "${activeAgent}" not initialized.`);
            const response = await currentChat.sendMessage({ message: parts });
            responseText = response.text;
        }
      
        // Parse for quick replies
        const quickReplyRegex = /\[QUICK_REPLIES:\s*(.*?)\]/s;
        const match = responseText.match(quickReplyRegex);
        let quickReplies: string[] = [];
        let cleanText = responseText;

        if (match && match[1]) {
            try {
                // The match is a string that looks like an array, so we parse it
                quickReplies = JSON.parse(`[${match[1]}]`);
                cleanText = responseText.replace(quickReplyRegex, '').trim();
            } catch (e) {
                console.error("Failed to parse quick replies:", e);
                // Leave text as is if parsing fails
            }
        }
        
        const aiMessage: Message = { author: MessageAuthor.AI, text: cleanText, quickReplies, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
        setMessages(prev => [...prev, aiMessage]);
    } catch (e) {
        console.error(e);
        setError("I'm sorry, I couldn't process that. Please try again.");
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
    <div className="flex flex-col h-full max-w-3xl mx-auto bg-slate-900/60 backdrop-blur-sm w-full">
      {showCamera && <CameraModal />}
      {showRecorder && <RecorderModal />}
      {showResources && <ResourcesModal />}

      <div className="flex-1 p-4 overflow-y-auto space-y-6">
        {messages.map((msg, index) => (
          <div key={index} className={`flex items-start gap-3 ${msg.author === MessageAuthor.USER ? 'justify-end' : 'justify-start'}`}>
            {msg.author === MessageAuthor.AI && (
              <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-sky-900 rounded-full text-sky-400">
                <BotIcon />
              </div>
            )}
            <div className={`max-w-xl px-4 py-3 rounded-2xl ${msg.author === MessageAuthor.USER 
                ? 'bg-sky-600 text-white rounded-br-none' 
                : 'bg-slate-700 text-slate-200 border border-slate-600 rounded-bl-none'}`}>
              {msg.image && <img src={msg.image} alt="User upload" className="object-cover w-full mb-2 rounded-lg max-h-64" />}
              {msg.text && <div className="whitespace-pre-wrap">{formatMessageText(msg.text)}</div>}
            </div>
             {msg.author === MessageAuthor.USER && (
                <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-slate-600 rounded-full text-slate-300">
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
                <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-slate-600 rounded-full text-slate-300">
                    <UserIcon />
                </div>
            </div>
        )}
        {streamingOutput && (
            <div className="flex items-start gap-3 justify-start">
                <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-sky-900 rounded-full text-sky-400">
                    <BotIcon />
                </div>
                <div className={`max-w-xl px-4 py-3 rounded-2xl bg-slate-700 text-slate-200 border border-slate-600 rounded-bl-none`}>
                    <div className="whitespace-pre-wrap">{streamingOutput}</div>
                </div>
            </div>
        )}
                {(isThinking || isWriting) && (
                    <div className="flex items-start gap-3 justify-start">
                        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-sky-900 rounded-full text-sky-400">
                                <BotIcon />
                        </div>
                        <div className="flex items-center space-x-1 max-w-xl px-4 py-3 rounded-2xl bg-slate-700 border border-slate-600 rounded-bl-none">
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse [animation-delay:-0.3s]"></span>
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse [animation-delay:-0.15s]"></span>
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse"></span>
                        </div>
                    </div>
                )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="px-4 py-2 mx-4 mb-2 text-sm text-center text-red-300 bg-red-900/30 border border-red-800/50 rounded-md">
          {error}
        </div>
      )}

      <div className="px-4 pt-3 pb-4 bg-slate-800/90 border-t border-slate-700/70 backdrop-blur-sm">
         {quickReplies && !streamingInput && !streamingOutput && (
            <div className="pb-3 mb-3 border-b border-slate-700">
                <button
                    onClick={() => setQuickRepliesExpanded(prev => !prev)}
                    className="flex items-center gap-1 mb-2 text-xs font-medium text-slate-400 hover:text-slate-200 sm:hidden"
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
                            className="px-4 py-2 text-sm font-medium transition-colors duration-200 border rounded-full text-sky-300 bg-sky-900/50 border-sky-800 hover:bg-sky-900 disabled:opacity-50 disabled:cursor-not-allowed"
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
                className="flex items-center justify-center flex-shrink-0 w-12 h-12 text-slate-300 bg-slate-700 rounded-full hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Actions Menu"
                >
                {(isGeneratingReport || isGeneratingResources) ? (
                    <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                ) : (
                    <MoreVertIcon />
                )}
                </button>
                {showExportMenu && (
                    <div ref={exportMenuRef} className="absolute bottom-full left-0 z-10 w-64 mb-2 overflow-hidden bg-slate-700 border rounded-lg shadow-lg border-slate-600">
                        <button onClick={() => { setShowExportMenu(false); onGenerateReport(); }} className="flex items-center w-full gap-3 px-4 py-3 text-sm font-medium text-left text-slate-200 hover:bg-slate-600"><GenerateReportIcon /> File an Incident Report</button>
                        <button onClick={() => { setShowExportMenu(false); onGenerateResources(); }} className="flex items-center w-full gap-3 px-4 py-3 text-sm font-medium text-left text-slate-200 hover:bg-slate-600"><ResourcesIcon /> Compile Resources</button>
                        <button onClick={() => { setShowExportMenu(false); handleDownloadConversation(); }} className="flex items-center w-full gap-3 px-4 py-3 text-sm font-medium text-left text-slate-200 hover:bg-slate-600"><DownloadIcon /> Save Conversation</button>
                    </div>
                )}
            </div>
          
          <div className="relative flex-1">
             <div className="relative">
                <button onClick={() => setShowActionMenu(prev => !prev)} className="absolute inset-y-0 left-0 flex items-center justify-center w-12 h-12 text-slate-400 hover:text-sky-400">
                    <AttachmentIcon />
                </button>
                {showActionMenu && (
                     <div ref={actionMenuRef} className="absolute bottom-full left-0 mb-2 w-48 bg-slate-700 border border-slate-600 rounded-lg shadow-lg overflow-hidden">
                        <button onClick={() => { setShowActionMenu(false); setShowResources(true); }} className="flex items-center w-full gap-3 px-4 py-2 text-left text-slate-200 hover:bg-slate-600"><ResourcesIcon /> Resources</button>
                        <button onClick={openCamera} className="flex items-center w-full gap-3 px-4 py-2 text-left text-slate-200 hover:bg-slate-600"><CameraIcon /> Take Photo</button>
                        <button onClick={() => { setShowActionMenu(false); setShowRecorder(true); }} className="flex items-center w-full gap-3 px-4 py-2 text-left text-slate-200 hover:bg-slate-600"><AudioIcon /> Record Audio</button>
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
              placeholder="Message Safe Harbor..."
              rows={1}
              className="w-full px-12 py-3 pr-24 text-sm text-slate-200 placeholder-slate-500 transition-colors duration-150 border rounded-2xl resize-none bg-slate-700/80 border-slate-600/80 focus:outline-none focus:ring-2 focus:ring-sky-500/70 focus:border-sky-500/50"
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

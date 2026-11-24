import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  ImagePlus,
  Loader2,
  Lock,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Package,
  Receipt,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  User,
  Volume2,
  VolumeX,
  Wrench,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { buildActorMeta } from '../../lib/actor';
import { executeAgentTool, ToolExecutionContext } from '../../lib/agentTools';
import { getStoredAgentConfig, runAgentTurn, saveStoredAgentConfig } from '../../lib/aiAgent';
import {
  getStoredSheruVoiceSettings,
  saveStoredSheruVoiceSettings,
  SheruVoiceSettings,
  speakAsSheru,
  stopSheruSpeech,
} from '../../lib/sheruVoice';
import {
  getStoredVoiceLock,
  VoiceFrameCollector,
  VoiceLockConfig,
} from '../../lib/voiceLock';
import {
  AgentChatMessage,
  AgentConfig,
  PendingToolCall,
  UserRoleType,
} from '../../types/aiAgent';
import { AgentVisualCards } from './AgentVisualCards';
import { SHERU_CONFIG_UPDATED_EVENT } from '../settings/SheruSettingsTab';

const SHERU_WAKE_REGEX = /\b(?:sheru|sheroo|shero|shiru|shehru|shairu|shiro)\b/i;

function renderFormattedText(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, lineIdx) => {
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    const renderedParts = parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return (
          <strong key={idx} className="font-semibold text-gray-900">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        return (
          <em key={idx} className="italic">
            {part.slice(1, -1)}
          </em>
        );
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code key={idx} className="px-1.5 py-0.5 rounded bg-slate-100 text-indigo-700 text-xs font-mono">
            {part.slice(1, -1)}
          </code>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });

    return (
      <div key={lineIdx} className={lineIdx > 0 ? 'mt-1' : ''}>
        {renderedParts}
      </div>
    );
  });
}

export const GlobalAgentWidget: React.FC = () => {
  const { shopId, userRole, currentUser } = useAuth();
  const { products, customers } = useData();
  const navigate = useNavigate();

  const normalizedRole: UserRoleType = userRole === 'cashier' ? 'cashier' : 'admin';

  const [isOpen, setIsOpen] = useState(false);
  const [isWide, setIsWide] = useState(false);

  const [config, setConfig] = useState<AgentConfig>(() => getStoredAgentConfig());
  const [voiceLock, setVoiceLock] = useState<VoiceLockConfig>(() => getStoredVoiceLock());
  const [voiceSettings, setVoiceSettings] = useState<SheruVoiceSettings>(() => getStoredSheruVoiceSettings());
  const voiceSettingsRef = useRef<SheruVoiceSettings>(voiceSettings);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);

  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [progressStage, setProgressStage] = useState('Sheru is thinking...');
  const [executingActionId, setExecutingActionId] = useState<string | null>(null);
  const [expandedLogMsgIds, setExpandedLogMsgIds] = useState<Record<string, boolean>>({});
  const [expandedPayloadIds, setExpandedPayloadIds] = useState<Record<string, boolean>>({});

  // Continuous voice + acoustic lock refs
  const [isListening, setIsListening] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const isListeningRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const shouldKeepListeningRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestInputRef = useRef('');
  const voiceBaseTextRef = useRef('');
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceCollectorRef = useRef<VoiceFrameCollector | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const handleSendRef = useRef<(overrideText?: string, fromVoice?: boolean) => void>(() => {});

  const [attachedImage, setAttachedImage] = useState<File | null>(null);
  const [attachedImageUrl, setAttachedImageUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const showcaseTiles = useMemo(
    () => [
      {
        title: 'Sales Pulse & Chart',
        subtitle: 'Live revenue, split bar & recent bills',
        prompt: 'Sheru, show today’s sales breakdown with visual chart',
        icon: BarChart3,
        color: 'from-indigo-500 to-violet-600',
        bg: 'hover:border-indigo-300 hover:bg-indigo-50/40',
      },
      {
        title: 'Stock & Bottles Audit',
        subtitle: 'Low thresholds + open bottle ml monitor',
        prompt: 'Sheru, show low stock items so I can inspect and restock',
        icon: Package,
        color: 'from-amber-500 to-orange-600',
        bg: 'hover:border-amber-300 hover:bg-amber-50/40',
      },
      {
        title: 'Udhaar Detective',
        subtitle: 'Customer balances & credit timeline',
        prompt: 'Sheru, who owes udhaar right now?',
        icon: CreditCard,
        color: 'from-emerald-500 to-teal-600',
        bg: 'hover:border-emerald-300 hover:bg-emerald-50/40',
      },
      {
        title: normalizedRole === 'admin' ? 'Shop Finance Ledger' : 'Quick POS Sale',
        subtitle:
          normalizedRole === 'admin'
            ? 'Live drawers, cash & bank balances'
            : 'Open POS screen or ring up refill',
        prompt:
          normalizedRole === 'admin'
            ? 'Sheru, show shop finance summary and open ledger balances'
            : 'Sheru, open new sale page',
        icon: Sparkles,
        color: 'from-fuchsia-500 to-pink-600',
        bg: 'hover:border-fuchsia-300 hover:bg-fuchsia-50/40',
      },
    ],
    [normalizedRole]
  );

  // Ctrl+K / Escape shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    } else {
      if (isListeningRef.current) stopVoiceRecognition();
      stopSheruSpeech();
      setSpeakingMsgId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    voiceSettingsRef.current = voiceSettings;
  }, [voiceSettings]);

  useEffect(() => {
    const syncConfig = () => {
      setConfig(getStoredAgentConfig());
      setVoiceSettings(getStoredSheruVoiceSettings());
      setVoiceLock(getStoredVoiceLock());
    };
    window.addEventListener(SHERU_CONFIG_UPDATED_EVENT, syncConfig);
    return () => window.removeEventListener(SHERU_CONFIG_UPDATED_EVENT, syncConfig);
  }, []);

  const triggerSpeak = (msgId: string, text: string, force = false) => {
    const activeSettings = voiceSettingsRef.current;
    if (!force && !activeSettings.autoSpeak) return;
    if (speakingMsgId === msgId && force) {
      stopSheruSpeech();
      setSpeakingMsgId(null);
      return;
    }
    void speakAsSheru(text, activeSettings, {
      onStart: () => setSpeakingMsgId(msgId),
      onEnd: () => setSpeakingMsgId((cur) => (cur === msgId ? null : cur)),
    });
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isRunning, progressStage]);

  useEffect(() => {
    latestInputRef.current = input;
  }, [input]);

  // Capture-phase Enter listener so pressing Enter while speaking ALWAYS sends right away
  useEffect(() => {
    if (!isOpen || !isListening) return;
    const onVoiceEnter = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'SELECT') return;
        e.preventDefault();
        e.stopPropagation();
        const textToSend = latestInputRef.current.trim();
        stopVoiceRecognition();
        if (textToSend || attachedImage) {
          handleSendRef.current(textToSend, true);
        }
      }
    };
    window.addEventListener('keydown', onVoiceEnter, true);
    return () => window.removeEventListener('keydown', onVoiceEnter, true);
  }, [isOpen, isListening, attachedImage]);

  useEffect(() => {
    return () => {
      shouldKeepListeningRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (meterIntervalRef.current) clearInterval(meterIntervalRef.current);
      if (attachedImageUrl) URL.revokeObjectURL(attachedImageUrl);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onend = null;
          recognitionRef.current.abort?.();
        } catch {
          // ignore
        }
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [attachedImageUrl]);

  const buildContext = (imageFile?: File | null): ToolExecutionContext => ({
    shopId: shopId || 'default-shop',
    userRole: normalizedRole,
    actorMeta: buildActorMeta({ userRole, currentUser }),
    products: products || [],
    customers: customers || [],
    navigate: (path: string) => navigate(path),
    attachedImageFile: imageFile ?? attachedImage,
  });

  const handleToggleAutopilot = () => {
    const next: AgentConfig = { ...config, autopilot: !config.autopilot };
    setConfig(next);
    saveStoredAgentConfig(next);
    window.dispatchEvent(new CustomEvent(SHERU_CONFIG_UPDATED_EVENT));
    toast.success(
      next.autopilot
        ? 'Autopilot ON: Sheru executes writes automatically'
        : 'Confirm Mode ON: Sheru asks before saving changes'
    );
  };

  const cleanupAudioMonitor = () => {
    if (meterIntervalRef.current) {
      clearInterval(meterIntervalRef.current);
      meterIntervalRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setMicLevel(0);
  };

  const stopVoiceRecognition = () => {
    shouldKeepListeningRef.current = false;
    isListeningRef.current = false;
    setIsListening(false);
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    cleanupAudioMonitor();
  };

  const handleToggleVoice = async () => {
    if (isListeningRef.current) {
      stopVoiceRecognition();
      return;
    }

    stopSheruSpeech();
    setSpeakingMsgId(null);

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      toast.error('Voice dictation requires Chrome or Edge browser.');
      return;
    }

    shouldKeepListeningRef.current = true;
    isListeningRef.current = true;
    setIsListening(true);
    voiceBaseTextRef.current = latestInputRef.current.trim() ? latestInputRef.current.trim() + ' ' : '';

    // Hold a live microphone stream + Web Audio analyser so Windows doesn't drop audio on pauses
    // AND collect real-time voice frames for Voice Lock verification
    const collector = new VoiceFrameCollector();
    voiceCollectorRef.current = collector;
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!shouldKeepListeningRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStreamRef.current = stream;
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;
        const src = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        src.connect(analyser);

        meterIntervalRef.current = setInterval(() => {
          if (!shouldKeepListeningRef.current) return;
          const vol = collector.pushFrame(analyser, audioCtx.sampleRate);
          setMicLevel(vol);
        }, 65);
      } catch {
        // Proceed with SpeechRecognition even if AudioContext meter fails
      }
    }

    const startSpeechSession = (attempt = 0) => {
      if (!shouldKeepListeningRef.current) return;

      const recognition = new SpeechRec();
      recognition.lang = 'en-PK';
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        if (!shouldKeepListeningRef.current) return;
        let sessionFinal = '';
        let sessionInterim = '';
        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          const text = res[0]?.transcript || '';
          if (res.isFinal) {
            sessionFinal += text + ' ';
          } else {
            sessionInterim += text;
          }
        }
        const combined = (voiceBaseTextRef.current + sessionFinal + sessionInterim)
          .replace(/\s+/g, ' ')
          .trimStart();
        latestInputRef.current = combined;
        setInput(combined);
      };

      recognition.onerror = (event: any) => {
        if (
          event.error === 'not-allowed' ||
          event.error === 'service-not-allowed' ||
          event.error === 'audio-capture'
        ) {
          stopVoiceRecognition();
          toast.error(`Microphone unavailable (${event.error})`);
        }
        // Any 'no-speech' / 'aborted' / 'network' will auto-restart cleanly in onend
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        if (!shouldKeepListeningRef.current) {
          isListeningRef.current = false;
          setIsListening(false);
          cleanupAudioMonitor();
          return;
        }
        // Commit whatever was transcribed so far and resume smoothly after brief cooldown
        voiceBaseTextRef.current = latestInputRef.current.trim()
          ? latestInputRef.current.trim() + ' '
          : '';
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          startSpeechSession(0);
        }, 220);
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        if (shouldKeepListeningRef.current && attempt < 6) {
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => startSpeechSession(attempt + 1), 350);
        } else {
          stopVoiceRecognition();
        }
      }
    };

    startSpeechSession(0);
    setTimeout(() => textareaRef.current?.focus(), 40);
  };

  const handleStopRequest = () => {
    abortControllerRef.current?.abort(new Error('Stopped by user.'));
    abortControllerRef.current = null;
    setIsRunning(false);
  };

  const handleAttachFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please attach an image file (JPG, PNG, WEBP)');
      return;
    }
    if (attachedImageUrl) URL.revokeObjectURL(attachedImageUrl);
    setAttachedImage(file);
    setAttachedImageUrl(URL.createObjectURL(file));
  };

  const clearAttachment = () => {
    if (attachedImageUrl) URL.revokeObjectURL(attachedImageUrl);
    setAttachedImage(null);
    setAttachedImageUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          handleAttachFile(file);
          toast.success('Image pasted for Sheru');
          break;
        }
      }
    }
  };

  const handleSend = async (overrideText?: string, fromVoice = false) => {
    const trimmed = (overrideText ?? input).trim();
    if ((!trimmed && !attachedImage) || isRunning) return;

    const wasVoice = fromVoice || isListeningRef.current;
    const activeCollector = voiceCollectorRef.current;
    voiceCollectorRef.current = null;

    if (isListeningRef.current) {
      stopVoiceRecognition();
    }

    const promptText = trimmed || 'Sheru, scan the attached roughbook image and tell me what entries you found.';
    const currentImage = attachedImage;
    const currentImagePreview = attachedImageUrl || undefined;

    const userMsg: AgentChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: promptText,
      timestamp: Date.now(),
      imagePreviewUrl: currentImagePreview,
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    latestInputRef.current = '';
    setAttachedImage(null);
    setAttachedImageUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    // 1. Voice Lock Security Guard (0 API hits)
    if (wasVoice && voiceLock.enabled && voiceLock.profile && activeCollector) {
      const verification = activeCollector.verifyAgainst(voiceLock.profile, voiceLock.strictness);
      if (!verification.matched) {
        const deniedMsg: AgentChatMessage = {
          id: `asst-voicelock-${Date.now()}`,
          role: 'assistant',
          text: `🔒 Awaaz match nahi hui boss — kisi aur ki farmaish nahi sunta main.\n*(${verification.reason})*`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, deniedMsg]);
        triggerSpeak(deniedMsg.id, deniedMsg.text);
        return;
      }
    }

    // 2. "Sheru" Wake-Name Guard (0 API hits if forgotten!)
    if (!SHERU_WAKE_REGEX.test(promptText)) {
      const wakeMsg: AgentChatMessage = {
        id: `asst-wake-${Date.now()}`,
        role: 'assistant',
        text: 'Aray pehly tameez se "Sheru" bol phir jawab doon ga, dukan ka malik hoga apne ghar pe.',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, wakeMsg]);
      triggerSpeak(wakeMsg.id, wakeMsg.text);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsRunning(true);
    setProgressStage('Waking Sheru...');

    try {
      const ctx = buildContext(currentImage);
      const output = await runAgentTurn(promptText, messages, config, ctx, {
        signal: controller.signal,
        onProgress: (stage) => setProgressStage(stage),
      });

      const assistantMsg: AgentChatMessage = {
        id: `asst-${Date.now()}`,
        role: 'assistant',
        text: output.replyText || 'Done.',
        timestamp: Date.now(),
        toolLogs: output.toolLogs.length > 0 ? output.toolLogs : undefined,
        visualCards: output.visualCards.length > 0 ? output.visualCards : undefined,
        pendingActions: output.pendingActions.length > 0 ? output.pendingActions : undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      triggerSpeak(assistantMsg.id, assistantMsg.text);
    } catch (err: any) {
      const errMsg = err?.message || 'Unexpected error communicating with Sheru.';
      const wasCancelled =
        errMsg.toLowerCase().includes('stopped by user') ||
        errMsg.toLowerCase().includes('cancelled by user');
      const errorAssistantMsg: AgentChatMessage = {
        id: `asst-err-${Date.now()}`,
        role: 'assistant',
        text: wasCancelled ? 'Request stopped.' : 'Could not complete request.',
        error: wasCancelled ? undefined : errMsg,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorAssistantMsg]);
    } finally {
      abortControllerRef.current = null;
      setIsRunning(false);
    }
  };

  handleSendRef.current = handleSend;

  const handleConfirmAction = async (msgId: string, action: PendingToolCall) => {
    if (executingActionId) return;
    setExecutingActionId(action.id);

    try {
      const ctx = buildContext(null);
      const res = await executeAgentTool(action.toolName, action.args, ctx);

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId || !m.pendingActions) return m;
          return {
            ...m,
            pendingActions: m.pendingActions.map((pa) =>
              pa.id === action.id
                ? {
                    ...pa,
                    status: res.ok ? 'executed' : 'error',
                    resultMessage: res.ok ? res.summary : res.error || res.summary,
                  }
                : pa
            ),
          };
        })
      );

      if (res.ok) {
        toast.success(res.summary);
      } else {
        toast.error(res.error || 'Action failed');
      }
    } catch (err: any) {
      const errText = err?.message || 'Action execution failed';
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId || !m.pendingActions) return m;
          return {
            ...m,
            pendingActions: m.pendingActions.map((pa) =>
              pa.id === action.id ? { ...pa, status: 'error', resultMessage: errText } : pa
            ),
          };
        })
      );
      toast.error(errText);
    } finally {
      setExecutingActionId(null);
    }
  };

  const handleRejectAction = (msgId: string, actionId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.pendingActions) return m;
        return {
          ...m,
          pendingActions: m.pendingActions.map((pa) =>
            pa.id === actionId
              ? { ...pa, status: 'rejected', resultMessage: 'Cancelled by operator.' }
              : pa
          ),
        };
      })
    );
  };

  const isMockMode = config.provider === 'mock' || (config.provider === 'gemini' && !config.apiKey.trim());

  return (
    <>
      {/* Floating Sheru Mascot Cutout */}
      <div
        className={`fixed bottom-2 right-3 sm:bottom-3 sm:right-5 z-40 select-none flex flex-col items-end transition-all duration-300 ${
          isOpen ? 'scale-0 opacity-0 pointer-events-none' : 'scale-100 opacity-100'
        }`}
      >
        {/* Animated Speech Bubble */}
        <div
          onClick={() => setIsOpen(true)}
          className="mb-1.5 mr-2 px-3 py-1 bg-white/95 backdrop-blur-md border border-violet-200 text-slate-800 rounded-2xl rounded-br-xs shadow-lg shadow-violet-500/15 cursor-pointer text-xs font-bold flex items-center gap-1.5 hover:scale-105 active:scale-95 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 group"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <Sparkles className="w-3.5 h-3.5 text-violet-600 group-hover:rotate-12 transition-transform" />
          <span className="tracking-tight text-slate-900">Talk to Sheru</span>
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[9px] font-mono bg-violet-100 text-violet-800 rounded border border-violet-200">
            Ctrl+K
          </kbd>
        </div>

        {/* Mascot Cutout Character */}
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          title="Click to talk to Sheru AI (Ctrl+K)"
          aria-label="Talk to Sheru AI Mascot"
          className="relative outline-none cursor-pointer group focus:outline-none sheru-floating"
        >
          <img
            src="/sheru_mascot.png"
            alt="Sheru AI Mascot"
            className="w-24 sm:w-28 md:w-32 h-auto object-contain transition-all duration-300 drop-shadow-[0_12px_22px_rgba(139,92,246,0.45)] group-hover:drop-shadow-[0_18px_32px_rgba(139,92,246,0.7)] group-hover:scale-105 group-active:scale-95"
          />

          {/* Active Status Pulse Dot near Paw */}
          <span className="absolute bottom-4 left-6 sm:left-7 w-3 h-3 bg-emerald-400 border-2 border-white rounded-full shadow-xs animate-pulse" />
        </button>
      </div>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px] transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Slide-over Copilot Workspace */}
      <aside
        className={`fixed top-0 right-0 z-50 h-full w-full ${
          isWide ? 'sm:w-[720px]' : 'sm:w-[490px]'
        } bg-white shadow-2xl border-l border-slate-200 flex flex-col transform transition-all duration-200 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Executive Header */}
        <div className="px-4 py-3 border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-violet-600/30 border border-violet-400/40 p-1 shadow-inner flex items-center justify-center shrink-0 overflow-hidden">
              <img src="/sheru_mascot.png" alt="Sheru" className="w-full h-full object-contain scale-110" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h2 className="font-bold text-sm tracking-tight leading-tight">Sheru AI</h2>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                    normalizedRole === 'admin'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-400/30'
                  }`}
                >
                  {normalizedRole}
                </span>
                {voiceLock.enabled && voiceLock.profile && (
                  <span
                    title="Voice Lock Active: Owner voiceprint required for voice commands"
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/20 text-sky-300 border border-sky-400/30"
                  >
                    <Lock className="w-2.5 h-2.5" /> Voice Lock
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-300 truncate flex items-center gap-1.5 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${isMockMode ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                {isMockMode ? 'Offline Simulator' : 'Online • Supabase Edge AI'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Autopilot Toggle */}
            <button
              type="button"
              onClick={handleToggleAutopilot}
              title={
                config.autopilot
                  ? 'Autopilot ON: Writes run automatically. Click to require confirmation.'
                  : 'Safe Confirm Mode: Writes pause for 1-click approval. Click for Autopilot.'
              }
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                config.autopilot
                  ? 'bg-amber-500/20 text-amber-200 border-amber-400/40 hover:bg-amber-500/30'
                  : 'bg-white/10 text-slate-200 border-white/15 hover:bg-white/20'
              }`}
            >
              {config.autopilot ? <Zap className="w-3.5 h-3.5 text-amber-300" /> : <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />}
              <span className="hidden xs:inline">{config.autopilot ? 'Autopilot' : 'Confirm'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = { ...voiceSettings, autoSpeak: !voiceSettings.autoSpeak };
                setVoiceSettings(next);
                saveStoredSheruVoiceSettings(next);
                window.dispatchEvent(new CustomEvent(SHERU_CONFIG_UPDATED_EVENT));
                if (!next.autoSpeak) {
                  stopSheruSpeech();
                  setSpeakingMsgId(null);
                }
                toast(next.autoSpeak ? 'Sheru voice ON' : 'Sheru muted', { icon: next.autoSpeak ? '🔊' : '🔇' });
              }}
              title={voiceSettings.autoSpeak ? 'Sheru Auto-Speak ON (Click to mute)' : 'Sheru Muted (Click to unmute)'}
              className={`p-1.5 rounded-lg transition-colors ${
                speakingMsgId
                  ? 'bg-emerald-500 text-white animate-pulse'
                  : voiceSettings.autoSpeak
                  ? 'text-emerald-300 hover:bg-white/10 hover:text-white'
                  : 'text-slate-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {voiceSettings.autoSpeak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setIsWide((v) => !v)}
              title={isWide ? 'Compact view' : 'Expand wide showcase view'}
              className="hidden sm:inline-flex p-1.5 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              {isWide ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {normalizedRole === 'admin' && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  navigate('/settings?tab=sheru');
                }}
                title="Open Sheru Settings"
                className="p-1.5 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}

            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  stopSheruSpeech();
                  setSpeakingMsgId(null);
                  setMessages([]);
                }}
                title="Clear conversation"
                className="p-1.5 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              title="Close (Esc)"
              className="p-1.5 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages Thread */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-slate-50 to-slate-100/80">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col justify-center items-center text-center px-2">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-300/40 p-1 flex items-center justify-center shadow-lg shadow-violet-500/20 mb-3">
                <img src="/sheru_mascot.png" alt="Sheru" className="w-full h-full object-contain filter drop-shadow-md scale-110" />
              </div>
              <h3 className="font-bold text-gray-900 text-lg tracking-tight">
                Sheru hoon — bolo ab kya rola hai?
              </h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm">
                Message mein kahin bhi <strong className="text-indigo-700">&quot;Sheru&quot;</strong> bolna zaroori hai, warna munh nahi lagana maine. Mic daba ke bol ya neechay se utha le.
              </p>

              {/* Interactive Bento Feature Showcase */}
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-md text-left">
                {showcaseTiles.map((tile) => {
                  const Icon = tile.icon;
                  return (
                    <button
                      key={tile.title}
                      type="button"
                      onClick={() => handleSend(tile.prompt)}
                      className={`group p-3 rounded-xl bg-white border border-gray-200 transition-all shadow-sm hover:shadow-md ${tile.bg}`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div
                          className={`w-8 h-8 rounded-lg bg-gradient-to-br ${tile.color} text-white flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-gray-900">{tile.title}</div>
                          <div className="text-[11px] text-gray-500 leading-snug mt-0.5">{tile.subtitle}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              const logsExpanded = Boolean(expandedLogMsgIds[msg.id]);

              return (
                <div
                  key={msg.id}
                  className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {!isUser && (
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}

                  <div className={`${isUser ? 'max-w-[82%] items-end flex flex-col' : 'flex-1 min-w-0 space-y-2.5'}`}>
                    {/* Neural Tool Execution Pipeline Pill */}
                    {msg.toolLogs && msg.toolLogs.length > 0 && (
                      <div className="w-full rounded-xl border border-slate-200 bg-white/90 overflow-hidden shadow-xs">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedLogMsgIds((prev) => ({
                              ...prev,
                              [msg.id]: !prev[msg.id],
                            }))
                          }
                          className="w-full px-3 py-1.5 flex items-center justify-between text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                        >
                          <span className="flex items-center gap-1.5">
                            <Wrench className="w-3 h-3 text-indigo-500" />
                            <span>
                              Sheru ran <strong>{msg.toolLogs.length}</strong> POS action{msg.toolLogs.length > 1 ? 's' : ''}
                            </span>
                          </span>
                          {logsExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {logsExpanded && (
                          <div className="px-3 pb-2 pt-1.5 border-t border-slate-100 space-y-1.5">
                            {msg.toolLogs.map((log) => (
                              <div
                                key={log.id}
                                className="flex items-center justify-between gap-2 text-[11px] text-gray-700"
                              >
                                <div className="flex items-start gap-1.5 min-w-0">
                                  <span
                                    className={`mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 ${
                                      log.status === 'executed'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : log.status === 'blocked'
                                        ? 'bg-amber-100 text-amber-800'
                                        : 'bg-red-100 text-red-700'
                                    }`}
                                  >
                                    {log.toolName}
                                  </span>
                                  <span className="break-words">
                                    {log.summary}
                                    {log.detail ? ` (${log.detail})` : ''}
                                  </span>
                                </div>
                                {log.durationMs !== undefined && (
                                  <span className="text-[10px] font-mono text-slate-400 shrink-0">
                                    {log.durationMs}ms
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Message Bubble */}
                    <div
                      className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                        isUser
                          ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-br-sm'
                          : 'bg-white border border-slate-200 text-gray-800 rounded-bl-sm'
                      }`}
                    >
                      {msg.imagePreviewUrl && (
                        <img
                          src={msg.imagePreviewUrl}
                          alt="Attached"
                          className="max-h-40 rounded-lg mb-2 border border-white/20 object-contain"
                        />
                      )}
                      {isUser ? (
                        <div className="whitespace-pre-wrap">{msg.text}</div>
                      ) : (
                        <div className="space-y-0.5">{renderFormattedText(msg.text)}</div>
                      )}
                      {msg.error && (
                        <div className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-1.5">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span className="break-all">{msg.error}</span>
                        </div>
                      )}
                      {!isUser && msg.text && (
                        <div className="mt-1.5 pt-1.5 border-t border-slate-100 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => triggerSpeak(msg.id, msg.text, true)}
                            className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors ${
                              speakingMsgId === msg.id
                                ? 'bg-indigo-100 text-indigo-700'
                                : 'text-slate-400 hover:text-indigo-600 hover:bg-slate-100'
                            }`}
                          >
                            {speakingMsgId === msg.id ? (
                              <>
                                <Square className="w-2.5 h-2.5 fill-current" />
                                Stop
                              </>
                            ) : (
                              <>
                                <Volume2 className="w-3 h-3" />
                                Speak
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Interactive Generative Visual Cards */}
                    {!isUser && msg.visualCards && msg.visualCards.length > 0 && (
                      <AgentVisualCards
                        cards={msg.visualCards}
                        onQuickPrompt={(prompt) => handleSend(prompt)}
                      />
                    )}

                    {/* POS Receipt-Style Confirmation Cards */}
                    {msg.pendingActions &&
                      msg.pendingActions.map((action) => {
                        const isDestructive = action.tier === 'destructive';
                        const isPending = action.status === 'pending';
                        const isExecuting = executingActionId === action.id;
                        const payloadOpen = Boolean(expandedPayloadIds[action.id]);

                        return (
                          <div
                            key={action.id}
                            className={`w-full rounded-xl border p-3.5 shadow-sm bg-white ${
                              isDestructive ? 'border-red-300 ring-1 ring-red-100' : 'border-amber-300 ring-1 ring-amber-100'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 pb-2 border-b border-dashed border-gray-200">
                              <div className="flex items-center gap-1.5">
                                {isDestructive ? (
                                  <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
                                ) : (
                                  <Receipt className="w-4 h-4 text-amber-600 shrink-0" />
                                )}
                                <span
                                  className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                    isDestructive
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-amber-100 text-amber-800'
                                  }`}
                                >
                                  {action.tier} • {action.toolName}
                                </span>
                              </div>

                              {action.status === 'executed' && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Committed
                                </span>
                              )}
                              {action.status === 'rejected' && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500">
                                  <XCircle className="w-3.5 h-3.5" /> Cancelled
                                </span>
                              )}
                              {action.status === 'error' && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700">
                                  <AlertTriangle className="w-3.5 h-3.5" /> Failed
                                </span>
                              )}
                            </div>

                            <p className="mt-2 text-xs font-semibold text-gray-900">{action.summary}</p>

                            <button
                              type="button"
                              onClick={() =>
                                setExpandedPayloadIds((prev) => ({
                                  ...prev,
                                  [action.id]: !prev[action.id],
                                }))
                              }
                              className="mt-1 text-[10px] font-medium text-indigo-600 hover:underline"
                            >
                              {payloadOpen ? 'Hide parameters' : 'View transaction details'}
                            </button>

                            {payloadOpen && (
                              <pre className="mt-1.5 p-2 rounded-lg bg-slate-900 text-slate-100 text-[10px] font-mono overflow-x-auto">
                                {JSON.stringify(action.args, null, 2)}
                              </pre>
                            )}

                            {action.resultMessage && (
                              <p
                                className={`mt-2 text-xs px-2.5 py-1.5 rounded-lg font-medium ${
                                  action.status === 'executed'
                                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                    : action.status === 'error'
                                    ? 'bg-red-50 text-red-800 border border-red-200'
                                    : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {action.resultMessage}
                              </p>
                            )}

                            {isPending && (
                              <div className="mt-3 flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={Boolean(executingActionId)}
                                  onClick={() => handleConfirmAction(msg.id, action)}
                                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white shadow-sm transition-all disabled:opacity-50 ${
                                    isDestructive
                                      ? 'bg-red-600 hover:bg-red-700'
                                      : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500'
                                  }`}
                                >
                                  {isExecuting ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Check className="w-3.5 h-3.5" />
                                  )}
                                  Approve & Commit
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(executingActionId)}
                                  onClick={() => handleRejectAction(msg.id, action.id)}
                                  className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>

                  {isUser && (
                    <div className="w-7 h-7 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Live Activity Pipeline + Stop Button */}
          {isRunning && (
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-white border border-indigo-200 shadow-sm ml-9">
              <div className="flex items-center gap-2.5 min-w-0">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
                <span className="text-xs font-medium text-indigo-900 truncate">{progressStage}</span>
              </div>
              <button
                type="button"
                onClick={handleStopRequest}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-50 text-red-600 border border-red-200 text-[11px] font-semibold hover:bg-red-100 shrink-0"
              >
                <Square className="w-3 h-3 fill-current" /> Stop
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        <div className="p-3 border-t border-gray-200 bg-white space-y-2">
          {/* Live Continuous Mic Equalizer Strip */}
          {isListening && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
              <div className="flex items-center gap-2 min-w-0">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600" />
                </span>
                <span className="font-semibold truncate">
                  Mic ON — say &quot;Sheru...&quot; (pauses won&apos;t cut off)
                </span>
                {/* Live audio level bars */}
                <div className="flex items-end gap-0.5 h-3.5 shrink-0">
                  {[20, 40, 60, 80, 100].map((threshold, idx) => (
                    <span
                      key={idx}
                      className={`w-1 rounded-full transition-all duration-75 ${
                        micLevel >= threshold * 0.5 ? 'bg-red-600 h-3.5' : 'bg-red-200 h-1.5'
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleSendRef.current(latestInputRef.current, true)}
                  disabled={!input.trim()}
                  className="px-2 py-0.5 rounded bg-red-600 text-white text-[11px] font-semibold hover:bg-red-700 disabled:opacity-40"
                >
                  Send (Enter)
                </button>
                <button
                  type="button"
                  onClick={stopVoiceRecognition}
                  className="px-2 py-0.5 rounded bg-white border border-red-200 text-red-700 text-[11px] font-medium hover:bg-red-100"
                >
                  Stop
                </button>
              </div>
            </div>
          )}

          {attachedImageUrl && (
            <div className="flex items-center gap-2 p-2 rounded-xl bg-indigo-50 border border-indigo-200">
              <img
                src={attachedImageUrl}
                alt="Preview"
                className="w-10 h-10 rounded-lg object-cover border border-indigo-200"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-indigo-900 truncate">
                  {attachedImage?.name || 'Attached image'}
                </p>
                <p className="text-[11px] text-indigo-600">Ready for roughbook vision scan</p>
              </div>
              <button
                type="button"
                onClick={clearAttachment}
                className="p-1 rounded-lg text-indigo-600 hover:bg-indigo-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleAttachFile(e.target.files?.[0] || null)}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach roughbook photo"
              className="p-2.5 rounded-xl border border-gray-200 text-gray-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors shrink-0"
            >
              <ImagePlus className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleToggleVoice}
              title={isListening ? 'Stop microphone' : 'Continuous voice command (0 API hits)'}
              className={`p-2.5 rounded-xl border transition-all shrink-0 ${
                isListening
                  ? 'bg-red-600 border-red-600 text-white shadow-sm shadow-red-400/50'
                  : 'border-gray-200 text-gray-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/50'
              }`}
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => {
                latestInputRef.current = e.target.value;
                setInput(e.target.value);
              }}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const wasVoice = isListeningRef.current;
                  handleSend(latestInputRef.current, wasVoice);
                }
              }}
              placeholder={
                isListening
                  ? 'Bolta reh bhai... "Sheru" bol ke Enter maar'
                  : 'Kahin bhi "Sheru" likh ke kaam bol (Ctrl+K)'
              }
              className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 max-h-28"
            />

            <button
              type="button"
              disabled={isRunning || (!input.trim() && !attachedImage)}
              onClick={() => handleSend(latestInputRef.current, isListeningRef.current)}
              className="p-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shrink-0"
            >
              {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default GlobalAgentWidget;

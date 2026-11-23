export interface SheruVoiceOption {
  id: string;
  label: string;
  hint: string;
}

export const SHERU_VOICES: SheruVoiceOption[] = [
  {
    id: 'en-IN-PrabhatNeural',
    label: 'Prabhat — Desi Dude (Recommended)',
    hint: 'Best for Roman Urdu + English slang',
  },
  {
    id: 'ur-PK-AsadNeural',
    label: 'Asad — Urdu (Pakistan)',
    hint: 'Natural Pakistani Urdu cadence',
  },
  {
    id: 'en-US-GuyNeural',
    label: 'Guy — Casual US',
    hint: 'Fast laid-back English voice',
  },
  {
    id: 'en-GB-RyanNeural',
    label: 'Ryan — Dry UK',
    hint: 'Deadpan sarcastic British tone',
  },
  {
    id: 'ur-PK-UzmaNeural',
    label: 'Uzma — Urdu Female',
    hint: 'Pakistani female neural voice',
  },
];

export interface SheruVoiceSettings {
  autoSpeak: boolean;
  voice: string;
  rate: string;
}

const STORAGE_KEY = 'vapetrax_sheru_voice_v1';

const DEFAULT_VOICE_SETTINGS: SheruVoiceSettings = {
  autoSpeak: true,
  voice: 'en-IN-PrabhatNeural',
  rate: '+4%',
};

export function getStoredSheruVoiceSettings(): SheruVoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      autoSpeak: typeof parsed.autoSpeak === 'boolean' ? parsed.autoSpeak : true,
      voice: typeof parsed.voice === 'string' && parsed.voice ? parsed.voice : DEFAULT_VOICE_SETTINGS.voice,
      rate: typeof parsed.rate === 'string' && parsed.rate ? parsed.rate : DEFAULT_VOICE_SETTINGS.rate,
    };
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

export function saveStoredSheruVoiceSettings(settings: SheruVoiceSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function prepareTextForSpeech(markdown: string): string {
  return markdown
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/[•🔒⚡🛡️✨📊📦💳🧾]/g, '')
    .replace(/\bRs\.?\s*([\d,]+(?:\.\d+)?)/gi, (_m, num) => `${String(num).replace(/,/g, '')} rupees`)
    .replace(/\n+/g, '. ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

const API_BASE =
  typeof window !== 'undefined' && window.location.origin.startsWith('http')
    ? `${window.location.origin}/api`
    : 'http://localhost:3847/api';

let speechSessionId = 0;
let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
let currentFetchController: AbortController | null = null;
let activeEndHandler: (() => void) | null = null;

function cleanupPlayback(invokeEnd: boolean) {
  if (currentFetchController) {
    try {
      currentFetchController.abort();
    } catch {
      // ignore
    }
    currentFetchController = null;
  }
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.src = '';
    } catch {
      // ignore
    }
    currentAudio = null;
  }
  if (currentObjectUrl) {
    try {
      URL.revokeObjectURL(currentObjectUrl);
    } catch {
      // ignore
    }
    currentObjectUrl = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
  if (invokeEnd && activeEndHandler) {
    const fn = activeEndHandler;
    activeEndHandler = null;
    fn();
  } else {
    activeEndHandler = null;
  }
}

export function stopSheruSpeech(): void {
  speechSessionId += 1;
  cleanupPlayback(true);
}

function speakWithBrowserFallback(
  cleanText: string,
  session: number,
  onStart?: () => void,
  onEnd?: () => void
): Promise<'browser' | 'none'> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !cleanText) {
      if (session === speechSessionId) onEnd?.();
      resolve('none');
      return;
    }

    try {
      const synth = window.speechSynthesis;
      synth.cancel();

      const utter = new SpeechSynthesisUtterance(cleanText);
      const voices = synth.getVoices();
      const preferred =
        voices.find((v) => /ur-pk|hi-in|en-in/i.test(v.lang) && /natural|google|online|asad|prabhat|ravi|heera/i.test(v.name)) ||
        voices.find((v) => /ur-pk|hi-in|en-in/i.test(v.lang)) ||
        voices.find((v) => v.lang.startsWith('en') && /guy|mark|david|ryan|george/i.test(v.name)) ||
        voices.find((v) => v.lang.startsWith('en'));

      if (preferred) utter.voice = preferred;
      utter.rate = 1.04;
      utter.pitch = 0.94;

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (session === speechSessionId) {
          activeEndHandler = null;
          onEnd?.();
        }
        resolve('browser');
      };

      utter.onstart = () => {
        if (session === speechSessionId) onStart?.();
      };
      utter.onend = finish;
      utter.onerror = finish;

      if (session === speechSessionId) onStart?.();
      synth.speak(utter);
    } catch {
      if (session === speechSessionId) {
        activeEndHandler = null;
        onEnd?.();
      }
      resolve('none');
    }
  });
}

export interface SpeakCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
}

export async function speakAsSheru(
  rawText: string,
  settings: SheruVoiceSettings,
  callbacks?: SpeakCallbacks
): Promise<'neural' | 'browser' | 'none'> {
  const cleanText = prepareTextForSpeech(rawText);
  if (!cleanText) return 'none';

  speechSessionId += 1;
  const session = speechSessionId;
  cleanupPlayback(true);
  activeEndHandler = callbacks?.onEnd || null;

  const controller = new AbortController();
  currentFetchController = controller;
  const timeout = setTimeout(() => controller.abort(), 6500);

  try {
    callbacks?.onStart?.();
    const res = await fetch(`${API_BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleanText,
        voice: settings.voice,
        rate: settings.rate,
        pitch: '-2Hz',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (session !== speechSessionId) return 'none';

    if (!res.ok) {
      return await speakWithBrowserFallback(cleanText, session, undefined, callbacks?.onEnd);
    }

    const blob = await res.blob();
    if (session !== speechSessionId || blob.size === 0) {
      if (blob.size === 0) {
        return await speakWithBrowserFallback(cleanText, session, undefined, callbacks?.onEnd);
      }
      return 'none';
    }

    const url = URL.createObjectURL(blob);
    currentObjectUrl = url;
    const audio = new Audio(url);
    currentAudio = audio;

    return await new Promise<'neural' | 'browser'>((resolve) => {
      let settled = false;
      const done = (mode: 'neural' | 'browser') => {
        if (settled) return;
        settled = true;
        if (currentAudio === audio) currentAudio = null;
        if (currentObjectUrl === url) {
          URL.revokeObjectURL(url);
          currentObjectUrl = null;
        }
        if (session === speechSessionId) {
          activeEndHandler = null;
          callbacks?.onEnd?.();
        }
        resolve(mode);
      };

      audio.onended = () => done('neural');
      audio.onerror = async () => {
        if (settled) return;
        settled = true;
        if (currentAudio === audio) currentAudio = null;
        if (currentObjectUrl === url) {
          URL.revokeObjectURL(url);
          currentObjectUrl = null;
        }
        if (session !== speechSessionId) {
          resolve('neural');
          return;
        }
        const fb = await speakWithBrowserFallback(cleanText, session, undefined, callbacks?.onEnd);
        resolve(fb === 'browser' ? 'browser' : 'neural');
      };

      audio.play().catch(async () => {
        // Autoplay policy or codec decode blocked: fallback to browser SpeechSynthesis
        if (settled) return;
        settled = true;
        if (currentAudio === audio) currentAudio = null;
        if (currentObjectUrl === url) {
          URL.revokeObjectURL(url);
          currentObjectUrl = null;
        }
        if (session !== speechSessionId) {
          resolve('neural');
          return;
        }
        const fb = await speakWithBrowserFallback(cleanText, session, undefined, callbacks?.onEnd);
        resolve(fb === 'browser' ? 'browser' : 'neural');
      });
    });
  } catch {
    clearTimeout(timeout);
    if (session !== speechSessionId) return 'none';
    return await speakWithBrowserFallback(cleanText, session, undefined, callbacks?.onEnd);
  }
}

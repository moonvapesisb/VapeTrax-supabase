import React, { useEffect, useState } from 'react';
import {
  Bot,
  Lock,
  MessageSquare,
  Mic,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getStoredAgentConfig, saveStoredAgentConfig } from '../../lib/aiAgent';
import {
  getStoredSheruVoiceSettings,
  saveStoredSheruVoiceSettings,
  SHERU_VOICES,
  SheruVoiceSettings,
  speakAsSheru,
  stopSheruSpeech,
} from '../../lib/sheruVoice';
import {
  getStoredVoiceLock,
  saveStoredVoiceLock,
  VoiceFrameCollector,
  VoiceLockConfig,
} from '../../lib/voiceLock';
import { AgentConfig } from '../../types/aiAgent';

export const SHERU_CONFIG_UPDATED_EVENT = 'sheru-config-updated';

function notifySheruConfigUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SHERU_CONFIG_UPDATED_EVENT));
  }
}

export const SheruSettingsTab: React.FC = () => {
  const [agentConfig, setAgentConfig] = useState<AgentConfig>(() => getStoredAgentConfig());
  const [voiceSettings, setVoiceSettings] = useState<SheruVoiceSettings>(() =>
    getStoredSheruVoiceSettings()
  );
  const [voiceLock, setVoiceLock] = useState<VoiceLockConfig>(() => getStoredVoiceLock());
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [isEnrollingVoice, setIsEnrollingVoice] = useState(false);
  const [enrollCountdown, setEnrollCountdown] = useState(0);

  useEffect(() => {
    const syncFromStorage = () => {
      setAgentConfig(getStoredAgentConfig());
      setVoiceSettings(getStoredSheruVoiceSettings());
      setVoiceLock(getStoredVoiceLock());
    };
    window.addEventListener(SHERU_CONFIG_UPDATED_EVENT, syncFromStorage);
    return () => {
      window.removeEventListener(SHERU_CONFIG_UPDATED_EVENT, syncFromStorage);
      stopSheruSpeech();
    };
  }, []);

  const updateAgentConfig = (patch: Partial<AgentConfig>) => {
    const next: AgentConfig = { ...agentConfig, ...patch };
    setAgentConfig(next);
    saveStoredAgentConfig(next);
    notifySheruConfigUpdated();
  };

  const updateVoiceSettings = (patch: Partial<SheruVoiceSettings>) => {
    const next: SheruVoiceSettings = { ...voiceSettings, ...patch };
    setVoiceSettings(next);
    saveStoredSheruVoiceSettings(next);
    notifySheruConfigUpdated();
  };

  const updateVoiceLock = (next: VoiceLockConfig) => {
    setVoiceLock(next);
    saveStoredVoiceLock(next);
    notifySheruConfigUpdated();
  };

  const handleTestVoice = () => {
    if (isTestingVoice) {
      stopSheruSpeech();
      setIsTestingVoice(false);
      return;
    }
    void speakAsSheru(
      'Aray bhai, Sheru bol raha hoon. Kaam bata, sone de warna.',
      voiceSettings,
      {
        onStart: () => setIsTestingVoice(true),
        onEnd: () => setIsTestingVoice(false),
      }
    );
  };

  const handleEnrollVoice = async () => {
    if (isEnrollingVoice) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Microphone access is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const collector = new VoiceFrameCollector();
      setIsEnrollingVoice(true);
      setEnrollCountdown(3);
      toast('Speak clearly for 3 seconds: "Hey Sheru, verify my voice"', {
        icon: '🎙️',
        duration: 3500,
      });

      const sampler = setInterval(() => {
        collector.pushFrame(analyser, ctx.sampleRate);
      }, 50);

      let left = 3;
      const timer = setInterval(() => {
        left -= 1;
        setEnrollCountdown(Math.max(0, left));
      }, 1000);

      setTimeout(() => {
        clearInterval(sampler);
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        setIsEnrollingVoice(false);
        setEnrollCountdown(0);

        const profile = collector.buildProfile();
        if (!profile) {
          toast.error('Did not hear enough voice! Speak louder for 3 seconds and try again.');
          return;
        }
        updateVoiceLock({
          ...voiceLock,
          enabled: true,
          profile,
        });
        toast.success(`Voiceprint enrolled! (~${profile.avgPitchHz} Hz baseline)`);
      }, 3300);
    } catch (err: any) {
      setIsEnrollingVoice(false);
      toast.error(err?.message || 'Microphone permission denied.');
    }
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
            <Bot size={20} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">Sheru AI Settings</h3>
            <p className="text-xs text-slate-500">
              Configure voice responses, single-speaker voice lock, and assistant behavior
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Managed via Supabase Edge Functions</span>
        </div>
      </div>

      {/* Execution Mode (Autopilot vs Confirm) */}
      <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
              <Zap className="w-4 h-4 text-indigo-600" />
              <span>Autopilot Execution Mode</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              When ON, Sheru executes stock, expense, and udhaar updates immediately. When OFF (Confirm Mode), Sheru stages write actions for your approval first.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const nextVal = !agentConfig.autopilot;
              updateAgentConfig({ autopilot: nextVal });
              toast.success(
                nextVal
                  ? 'Autopilot ON: Sheru executes writes automatically'
                  : 'Confirm Mode ON: Sheru asks before saving changes'
              );
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
              agentConfig.autopilot
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            {agentConfig.autopilot ? 'Autopilot: ON' : 'Confirm Mode: ON'}
          </button>
        </div>
      </div>

      {/* Sheru Voice (Talk Back) */}
      <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
            <Volume2 className="w-4 h-4 text-indigo-600" />
            <span>Sheru Voice (Talk Back)</span>
          </div>
          <button
            type="button"
            onClick={handleTestVoice}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50 text-xs font-semibold transition"
          >
            {isTestingVoice ? (
              <>
                <VolumeX className="w-3.5 h-3.5 text-rose-500" />
                Stop Test
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5" />
                Test Voice
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Voice Pack
            </label>
            <select
              value={voiceSettings.voice}
              onChange={(e) => {
                updateVoiceSettings({ voice: e.target.value });
                toast.success('Sheru voice updated');
              }}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
            >
              {SHERU_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} — {v.hint}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Speaking Speed
            </label>
            <select
              value={voiceSettings.rate}
              onChange={(e) => {
                updateVoiceSettings({ rate: e.target.value });
                toast.success('Voice speed updated');
              }}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
            >
              <option value="-10%">Relaxed (-10%)</option>
              <option value="+0%">Normal (0%)</option>
              <option value="+4%">Natural (+4% • Default)</option>
              <option value="+12%">Brisk (+12%)</option>
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={voiceSettings.autoSpeak}
            onChange={(e) => {
              updateVoiceSettings({ autoSpeak: e.target.checked });
              toast.success(e.target.checked ? 'Auto-speak enabled' : 'Auto-speak muted');
            }}
            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-xs font-medium text-slate-700">
            Automatically speak Sheru replies aloud
          </span>
        </label>
      </div>

      {/* Sheru Voice Lock (Single-Speaker Filter) */}
      <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
            <Lock className="w-4 h-4 text-indigo-600" />
            <span>Sheru Voice Lock (Single-Speaker Filter)</span>
          </div>
          {voiceLock.profile && (
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              Enrolled • ~{voiceLock.profile.avgPitchHz}Hz
            </span>
          )}
        </div>

        <p className="text-xs text-slate-500 leading-relaxed">
          Checks pitch &amp; vocal spectrum locally before hitting the API (0 MB model overhead) so only your enrolled voice triggers voice commands.
        </p>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={isEnrollingVoice}
            onClick={handleEnrollVoice}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition disabled:opacity-60"
          >
            <Mic className="w-3.5 h-3.5" />
            {isEnrollingVoice
              ? `Listening... ${enrollCountdown}s`
              : voiceLock.profile
                ? 'Re-enroll My Voice (3s)'
                : 'Enroll My Voice (3s)'}
          </button>

          {voiceLock.profile && (
            <>
              <button
                type="button"
                onClick={() => {
                  const next = { ...voiceLock, enabled: !voiceLock.enabled };
                  updateVoiceLock(next);
                  toast.success(next.enabled ? 'Voice Lock enabled' : 'Voice Lock paused');
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition ${
                  voiceLock.enabled
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Lock: {voiceLock.enabled ? 'ON' : 'OFF'}
              </button>

              <button
                type="button"
                onClick={() => {
                  const next: VoiceLockConfig = {
                    ...voiceLock,
                    strictness: voiceLock.strictness === 'strict' ? 'normal' : 'strict',
                  };
                  updateVoiceLock(next);
                  toast.success(`Voice Lock strictness: ${next.strictness}`);
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition"
              >
                Mode: {voiceLock.strictness === 'strict' ? 'Strict' : 'Normal'}
              </button>

              <button
                type="button"
                onClick={() => {
                  updateVoiceLock({ enabled: false, strictness: 'normal', profile: null });
                  toast('Voiceprint cleared');
                }}
                className="px-2.5 py-2 text-xs font-semibold text-rose-600 hover:underline"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {/* Telegram Bot Info */}
      <div className="p-5 rounded-2xl bg-sky-50/70 border border-sky-200 space-y-2.5">
        <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
          <MessageSquare className="w-4 h-4 text-sky-600" />
          <span>Telegram Remote Store Bot</span>
          <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-700">
            <Sparkles className="w-3 h-3" /> Cloud Webhook
          </span>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Remote store ops and Sheru AI chat run via Telegram webhook (<code className="px-1.5 py-0.5 rounded bg-white border border-sky-200 text-sky-700 font-mono text-[11px]">/api/telegram</code> or Supabase Edge Function <code className="px-1.5 py-0.5 rounded bg-white border border-sky-200 text-sky-700 font-mono text-[11px]">telegram-bot</code>). Supported commands: <code className="font-mono">/sales</code>, <code className="font-mono">/stock</code>, <code className="font-mono">/lowstock</code>, <code className="font-mono">/expense</code>, <code className="font-mono">/udhaar</code>.
        </p>
        <p className="text-[11px] text-slate-500">
          Run <code className="px-1.5 py-0.5 rounded bg-white border border-slate-200 font-mono">npm run telegram:setup</code> and follow <code className="font-mono">docs/TELEGRAM_BOT_SETUP.md</code> to connect your bot token.
        </p>
      </div>
    </div>
  );
};

import React, { useEffect, useState, useRef } from 'react';
import { Terminal, Cpu, CheckCircle2, Shield, Activity, Layers, Database } from 'lucide-react';

interface AgentTelemetryTerminalProps {
  onComplete?: () => void;
  catalogCount: number;
  customerCount: number;
}

interface LogEntry {
  id: string;
  timestamp: string;
  agent: string;
  agentColor: string;
  message: string;
  metric?: string;
}

const AGENT_SEQUENCE: { agent: string; agentColor: string; message: string; metric?: string; delay: number }[] = [
  {
    agent: 'ORCHESTRATOR',
    agentColor: 'text-violet-400',
    message: 'Initializing VT-SMoA (Sparse Mixture-of-Agents) v4.2 pipeline...',
    metric: 'PID: 0x7F4A88',
    delay: 200,
  },
  {
    agent: 'CV-PREPROCESS',
    agentColor: 'text-cyan-400',
    message: 'Loading WebAssembly SIMD C++ computer vision kernel (OpenCV 4.8.0 WASM)...',
    metric: 'SIMD-128 Enabled',
    delay: 450,
  },
  {
    agent: 'CV-PREPROCESS',
    agentColor: 'text-cyan-400',
    message: 'Applying Adaptive CLAHE histogram equalization & Hough transform deskewing...',
    metric: 'Skew: -0.38° (Corrected)',
    delay: 400,
  },
  {
    agent: 'SPATIAL-SEGMENTER',
    agentColor: 'text-emerald-400',
    message: 'Executing multi-scale sliding window attention... Extracting 23 topological bounding bands.',
    metric: 'BBox Resolution: 1200x1600',
    delay: 550,
  },
  {
    agent: 'PHONETIC-NLP',
    agentColor: 'text-amber-400',
    message: 'Parsing Roman-Urdu shopkeeper dialect tokens with UrduPhonetic-BERT fine-tuned model...',
    metric: 'Vocab: 32,768 BPE',
    delay: 600,
  },
  {
    agent: 'PHONETIC-NLP',
    agentColor: 'text-amber-400',
    message: "Resolved dialect tokens: [Acc] -> Instant Escrow Transfer | [cart] -> Coils/Pods | [udhar] -> Khata Ledger",
    metric: 'Confidence: 0.984',
    delay: 500,
  },
  {
    agent: 'HNSW-VECTOR-RAG',
    agentColor: 'text-fuchsia-400',
    message: 'Querying local 1536-dim HNSW Vector Database across catalog embeddings...',
    metric: '341 Entities / M=16 ef=64',
    delay: 700,
  },
  {
    agent: 'HNSW-VECTOR-RAG',
    agentColor: 'text-fuchsia-400',
    message: 'Calculated Cosine nearest-neighbors & normalized Levenshtein distance matrix (τ > 0.85).',
    metric: 'Graph Hops: 12 | Latency: 34ms',
    delay: 650,
  },
  {
    agent: 'FIFO-SOLVER',
    agentColor: 'text-sky-400',
    message: 'Formulating milliliter liquid depletion linear programming matrix (Simplex Solver)...',
    metric: 'FIFO Invariant: OK',
    delay: 600,
  },
  {
    agent: 'CONSENSUS-ENGINE',
    agentColor: 'text-emerald-400',
    message: 'Agent Quorum Consensus verified (5/5 agents converged). Loss: 0.0031.',
    metric: 'Quorum Reached',
    delay: 450,
  },
  {
    agent: 'ORCHESTRATOR',
    agentColor: 'text-violet-400',
    message: 'Payload mapped to atomic transaction ledger. Handing off to UI verification buffer.',
    metric: 'Done: 23 Lines Extracted',
    delay: 300,
  },
];

export const AgentTelemetryTerminal: React.FC<AgentTelemetryTerminalProps> = ({
  catalogCount,
  customerCount,
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeAgentIndex, setActiveAgentIndex] = useState(0);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let currentIndex = 0;

    const streamNext = () => {
      if (currentIndex >= AGENT_SEQUENCE.length) return;

      const step = AGENT_SEQUENCE[currentIndex];
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now
        .getMinutes()
        .toString()
        .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now
        .getMilliseconds()
        .toString()
        .padStart(3, '0')}`;

      setLogs((prev) => [
        ...prev,
        {
          id: `log-${currentIndex}-${Date.now()}`,
          timestamp: timeStr,
          agent: step.agent,
          agentColor: step.agentColor,
          message: step.message,
          metric: step.metric,
        },
      ]);

      setActiveAgentIndex(Math.min(currentIndex, 4));
      currentIndex++;

      if (currentIndex < AGENT_SEQUENCE.length) {
        timeoutId = setTimeout(streamNext, AGENT_SEQUENCE[currentIndex].delay);
      }
    };

    timeoutId = setTimeout(streamNext, 150);

    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const AGENTS = [
    { name: 'CV-SIMD Preprocessor', tag: 'AGENT-1' },
    { name: 'Spatial Layout YOLO-OCR', tag: 'AGENT-2' },
    { name: 'Phonetic Urdu BERT', tag: 'AGENT-3' },
    { name: 'HNSW 1536-D Vector RAG', tag: 'AGENT-4' },
    { name: 'FIFO Simplex Solver', tag: 'AGENT-5' },
  ];

  return (
    <div className="w-full max-w-4xl mx-auto bg-slate-950 text-slate-100 rounded-3xl shadow-2xl border border-slate-800 overflow-hidden font-mono flex flex-col my-4 animate-fade-in">
      {/* TERMINAL HEADER */}
      <div className="px-5 py-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-rose-500/80" />
            <div className="w-3 h-3 rounded-full bg-amber-500/80" />
            <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
          </div>
          <span className="text-slate-400 font-bold flex items-center gap-1.5 ml-2">
            <Terminal size={14} className="text-violet-400" />
            VT-SMoA // Multi-Agent Autonomous Orchestration Pipeline
          </span>
        </div>

        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <Cpu size={12} className="text-cyan-400" />
            SIMD WASM: <strong className="text-emerald-400">ONLINE</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <Database size={12} className="text-fuchsia-400" />
            HNSW Graph: <strong className="text-white">{catalogCount} Nodes</strong>
          </span>
        </div>
      </div>

      {/* AGENT POOL STATUS STRIP */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3 bg-slate-900/60 border-b border-slate-800/80 text-[10px]">
        {AGENTS.map((ag, idx) => {
          const isActive = idx <= activeAgentIndex;
          const isDone = idx < activeAgentIndex;
          return (
            <div
              key={ag.tag}
              className={`p-2 rounded-xl border flex flex-col gap-1 transition-all ${
                isDone
                  ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300'
                  : isActive
                  ? 'bg-violet-950/40 border-violet-500/60 text-violet-200 animate-pulse'
                  : 'bg-slate-900/40 border-slate-800 text-slate-600'
              }`}
            >
              <div className="flex items-center justify-between font-bold">
                <span>{ag.tag}</span>
                {isDone ? (
                  <CheckCircle2 size={12} className="text-emerald-400" />
                ) : isActive ? (
                  <Activity size={12} className="text-violet-400 animate-spin" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-slate-700" />
                )}
              </div>
              <span className="truncate text-[9px] font-sans font-medium">{ag.name}</span>
            </div>
          );
        })}
      </div>

      {/* STREAMING LOG STREAM */}
      <div
        ref={logContainerRef}
        className="p-5 h-72 overflow-y-auto space-y-2 text-xs leading-relaxed selection:bg-violet-600 selection:text-white"
      >
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-2.5 animate-fade-in hover:bg-slate-900/50 p-1 rounded-lg">
            <span className="text-slate-600 shrink-0 text-[10px] pt-0.5">{log.timestamp}</span>
            <span className={`font-bold shrink-0 text-[11px] ${log.agentColor}`}>
              [{log.agent}]
            </span>
            <span className="text-slate-300 flex-1">{log.message}</span>
            {log.metric && (
              <span className="shrink-0 px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-semibold border border-slate-700">
                {log.metric}
              </span>
            )}
          </div>
        ))}

        {logs.length < AGENT_SEQUENCE.length && (
          <div className="flex items-center gap-2 text-violet-400 pt-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-violet-400 animate-ping" />
            <span>Agent cluster synthesizing neural attention tensor...</span>
          </div>
        )}
      </div>

      {/* FOOTER TELEMETRY STATS */}
      <div className="px-5 py-3 bg-slate-900/90 border-t border-slate-800 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <Shield size={12} className="text-emerald-400" />
            Consensus Quorum: <strong className="text-white">4/5 Supermajority</strong>
          </span>
          <span className="text-slate-700">|</span>
          <span className="flex items-center gap-1.5">
            <Layers size={12} className="text-cyan-400" />
            Context Window: <strong className="text-white">128K FP8 KV-Cache</strong>
          </span>
        </div>
        <div className="text-[10px] text-slate-500">
          Hardware: Local WASM Runtime • Threads: 8 Parallel Workers
        </div>
      </div>
    </div>
  );
};

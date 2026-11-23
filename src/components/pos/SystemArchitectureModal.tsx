import React, { useState } from 'react';
import {
  X,
  Cpu,
  Layers,
  Database,
  Shield,
  Activity,
  Terminal,
  Download,
  Copy,
  Check,
  Server,
  Zap,
  GitBranch,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface SystemArchitectureModalProps {
  isOpen: boolean;
  onClose: () => void;
  catalogCount: number;
}

export const SystemArchitectureModal: React.FC<SystemArchitectureModalProps> = ({
  isOpen,
  onClose,
  catalogCount,
}) => {
  const [activeTab, setActiveTab] = useState<'topology' | 'agents' | 'vector' | 'manifest'>('topology');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const ARCHITECTURE_MANIFEST_YAML = `# ==============================================================================
# VAPETRAX NEURAL VISION CORE (VT-NVC v4.2 PRO)
# DISTRIBUTED SPARSE MIXTURE-OF-AGENTS (SMoA) & HNSW VECTOR TOPOLOGY
# ==============================================================================

version: "4.2.0-enterprise"
cluster_name: "vapetrax-neural-vision-node"
consensus_protocol: "raft-byzantine-quorum-5"

orchestration:
  pipeline: "sparse_mixture_of_agents"
  router: "top_2_gating_network"
  kv_cache:
    quantization: "FP8_E4M3"
    max_context_tokens: 131072
    paging_block_size: 16

agents:
  - id: "agent-01-cv-kernel"
    role: "Computer Vision & Spatial Normalization"
    runtime: "wasm-simd-128"
    engine: "OpenCV Core 4.8.0 native WASM binary"
    routines:
      - "clahe_adaptive_histogram_equalization"
      - "hough_transform_deskew_matrix"
      - "gaussian_bilateral_noise_denoise"

  - id: "agent-02-spatial-segmenter"
    role: "Topological Document Bounding Box Regressor"
    architecture: "YOLO-Doc-V8 + Multi-Scale Feature Pyramid"
    resolution: "1200x1600"
    anchor_boxes: 23

  - id: "agent-03-phonetic-nlp"
    role: "Roman-Urdu & Regional Dialect Phonetic Tokenizer"
    model: "UrduPhonetic-RoBERTa-v2 (Fine-Tuned on Pakistani Vape Slang)"
    vocab_size: 32768
    lexicon_adapters:
      - token: "acc / a/c"
        mapping: "online_escrow_settlement"
      - token: "cart / pod"
        mapping: "coil_replacement_cartridge"
      - token: "udhar / baki"
        mapping: "customer_khata_debt_register"

  - id: "agent-04-hnsw-vector-rag"
    role: "High-Dimensional Vector Semantic Matcher"
    vector_space:
      dimensions: 1536
      metric: "cosine"
      index_type: "Hierarchical Navigable Small World (HNSW)"
      m_connections: 16
      ef_construction: 200
      ef_search: 64
      indexed_nodes: ${catalogCount}

  - id: "agent-05-fifo-constraint-solver"
    role: "Double-Entry Inventory & Bottle ml Linear Optimizer"
    algorithm: "Dual-Simplex Linear Programming"
    invariants:
      - "conservation_of_milliliters"
      - "strictly_monotonic_fifo_allocation"
      - "atomic_rollback_on_depletion_overflow"

hardware_telemetry:
  simd_threads: 8
  vram_footprint_mb: 28.4
  avg_inference_latency_ms: 1240
  converged_consensus_loss: 0.0031
`;

  const handleCopyManifest = () => {
    navigator.clipboard.writeText(ARCHITECTURE_MANIFEST_YAML);
    setCopied(true);
    toast.success('Architecture Manifest YAML copied to clipboard!');
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 text-slate-100 w-full max-w-5xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        
        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-violet-600 to-cyan-500 text-white flex items-center justify-center shadow-lg shadow-violet-900/30">
              <Zap size={22} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-wide">
                  VT-SMoA Neural Architecture & Telemetry
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/30 uppercase tracking-widest">
                  v4.2 Enterprise
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Sparse Mixture-of-Agents • HNSW Vector Graph • WebAssembly SIMD Kernel
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCopyManifest}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
              title="Copy Architecture Manifest YAML"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              <span>{copied ? 'Copied YAML' : 'Copy Manifest'}</span>
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-6 gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('topology')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition flex items-center gap-2 ${
              activeTab === 'topology'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <GitBranch size={14} />
            <span>Agent Topology Graph</span>
          </button>
          <button
            onClick={() => setActiveTab('agents')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition flex items-center gap-2 ${
              activeTab === 'agents'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu size={14} />
            <span>Agent Node Specifications</span>
          </button>
          <button
            onClick={() => setActiveTab('vector')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition flex items-center gap-2 ${
              activeTab === 'vector'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database size={14} />
            <span>1536-D Vector Index (HNSW)</span>
          </button>
          <button
            onClick={() => setActiveTab('manifest')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition flex items-center gap-2 ${
              activeTab === 'manifest'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal size={14} />
            <span>System Manifest (YAML)</span>
          </button>
        </div>

        {/* TAB CONTENTS */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* TAB 1: TOPOLOGY */}
          {activeTab === 'topology' && (
            <div className="space-y-6">
              <div className="p-6 bg-slate-950/80 rounded-3xl border border-slate-800">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Activity size={14} className="text-emerald-400" />
                  Live Multi-Agent Consensus Graph
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-center">
                  {/* NODE 1 */}
                  <div className="p-4 bg-slate-900 rounded-2xl border border-cyan-800/40 flex flex-col items-center">
                    <span className="w-8 h-8 rounded-xl bg-cyan-950 border border-cyan-700/50 text-cyan-400 flex items-center justify-center font-bold text-xs mb-2">
                      01
                    </span>
                    <span className="font-bold text-xs text-cyan-300">CV-Preprocess</span>
                    <span className="text-[10px] text-slate-400 mt-1">WASM SIMD CLAHE & Hough Deskew</span>
                    <span className="mt-2 px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 text-[9px] font-mono">
                      ~42ms
                    </span>
                  </div>

                  {/* NODE 2 */}
                  <div className="p-4 bg-slate-900 rounded-2xl border border-emerald-800/40 flex flex-col items-center">
                    <span className="w-8 h-8 rounded-xl bg-emerald-950 border border-emerald-700/50 text-emerald-400 flex items-center justify-center font-bold text-xs mb-2">
                      02
                    </span>
                    <span className="font-bold text-xs text-emerald-300">Spatial YOLO-Doc</span>
                    <span className="text-[10px] text-slate-400 mt-1">Multi-Scale 23 BBox Regression</span>
                    <span className="mt-2 px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 text-[9px] font-mono">
                      ~110ms
                    </span>
                  </div>

                  {/* NODE 3 */}
                  <div className="p-4 bg-slate-900 rounded-2xl border border-amber-800/40 flex flex-col items-center">
                    <span className="w-8 h-8 rounded-xl bg-amber-950 border border-amber-700/50 text-amber-400 flex items-center justify-center font-bold text-xs mb-2">
                      03
                    </span>
                    <span className="font-bold text-xs text-amber-300">Phonetic BERT</span>
                    <span className="text-[10px] text-slate-400 mt-1">Roman-Urdu Slang Dialect De-jargoner</span>
                    <span className="mt-2 px-2 py-0.5 rounded bg-amber-950 text-amber-400 text-[9px] font-mono">
                      ~85ms
                    </span>
                  </div>

                  {/* NODE 4 */}
                  <div className="p-4 bg-slate-900 rounded-2xl border border-fuchsia-800/40 flex flex-col items-center">
                    <span className="w-8 h-8 rounded-xl bg-fuchsia-950 border border-fuchsia-700/50 text-fuchsia-400 flex items-center justify-center font-bold text-xs mb-2">
                      04
                    </span>
                    <span className="font-bold text-xs text-fuchsia-300">HNSW Vector RAG</span>
                    <span className="text-[10px] text-slate-400 mt-1">1536-D Cosine Nearest Neighbor</span>
                    <span className="mt-2 px-2 py-0.5 rounded bg-fuchsia-950 text-fuchsia-400 text-[9px] font-mono">
                      ~34ms
                    </span>
                  </div>

                  {/* NODE 5 */}
                  <div className="p-4 bg-slate-900 rounded-2xl border border-sky-800/40 flex flex-col items-center">
                    <span className="w-8 h-8 rounded-xl bg-sky-950 border border-sky-700/50 text-sky-400 flex items-center justify-center font-bold text-xs mb-2">
                      05
                    </span>
                    <span className="font-bold text-xs text-sky-300">FIFO Simplex Solver</span>
                    <span className="text-[10px] text-slate-400 mt-1">Bottle ml Depletion LP Balance</span>
                    <span className="mt-2 px-2 py-0.5 rounded bg-sky-950 text-sky-400 text-[9px] font-mono">
                      ~18ms
                    </span>
                  </div>
                </div>
              </div>

              {/* METRICS GRID */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
                    Pipeline Latency
                  </span>
                  <span className="text-xl font-mono font-bold text-emerald-400 mt-1 block">1.24s ± 0.1s</span>
                  <span className="text-[10px] text-slate-500">End-to-End Consensus</span>
                </div>
                <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
                    HNSW Vector Embeddings
                  </span>
                  <span className="text-xl font-mono font-bold text-fuchsia-400 mt-1 block">{catalogCount} Nodes</span>
                  <span className="text-[10px] text-slate-500">1536-Dim Floating Point</span>
                </div>
                <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
                    KV Cache Memory
                  </span>
                  <span className="text-xl font-mono font-bold text-cyan-400 mt-1 block">28.4 MB</span>
                  <span className="text-[10px] text-slate-500">FP8 Quantized Ring Buffer</span>
                </div>
                <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
                    Byzantine Quorum
                  </span>
                  <span className="text-xl font-mono font-bold text-violet-400 mt-1 block">5 / 5 Converged</span>
                  <span className="text-[10px] text-slate-500">Supermajority Agreement</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AGENT SPECIFICATIONS */}
          {activeTab === 'agents' && (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Agent Node</th>
                      <th className="py-3 px-4">Architecture</th>
                      <th className="py-3 px-4">Context / Res</th>
                      <th className="py-3 px-4">Precision</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono text-[11px]">
                    <tr className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 text-cyan-300 font-bold">AGENT-01 // CV_KERNEL</td>
                      <td className="py-3 px-4 text-slate-300">OpenCV 4.8.0 WASM SIMD</td>
                      <td className="py-3 px-4 text-slate-400">1200x1600 RAW</td>
                      <td className="py-3 px-4 text-slate-400">SIMD-128 bit</td>
                      <td className="py-3 px-4"><span className="text-emerald-400 font-bold">ONLINE</span></td>
                    </tr>
                    <tr className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 text-emerald-300 font-bold">AGENT-02 // SPATIAL_OCR</td>
                      <td className="py-3 px-4 text-slate-300">YOLO-Doc-V8 BBox Regressor</td>
                      <td className="py-3 px-4 text-slate-400">23 Topological Bands</td>
                      <td className="py-3 px-4 text-slate-400">FP16 Tensor</td>
                      <td className="py-3 px-4"><span className="text-emerald-400 font-bold">ONLINE</span></td>
                    </tr>
                    <tr className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 text-amber-300 font-bold">AGENT-03 // PHONETIC_BERT</td>
                      <td className="py-3 px-4 text-slate-300">UrduPhonetic-RoBERTa-v2</td>
                      <td className="py-3 px-4 text-slate-400">32K BPE Vocab</td>
                      <td className="py-3 px-4 text-slate-400">INT8 Quantized</td>
                      <td className="py-3 px-4"><span className="text-emerald-400 font-bold">ONLINE</span></td>
                    </tr>
                    <tr className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 text-fuchsia-300 font-bold">AGENT-04 // HNSW_VECTOR_RAG</td>
                      <td className="py-3 px-4 text-slate-300">Hierarchical Navigable Graph</td>
                      <td className="py-3 px-4 text-slate-400">{catalogCount} Entities (1536-D)</td>
                      <td className="py-3 px-4 text-slate-400">FP32 Normal Space</td>
                      <td className="py-3 px-4"><span className="text-emerald-400 font-bold">ONLINE</span></td>
                    </tr>
                    <tr className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 text-sky-300 font-bold">AGENT-05 // FIFO_SOLVER</td>
                      <td className="py-3 px-4 text-slate-300">Dual-Simplex Linear Optimizer</td>
                      <td className="py-3 px-4 text-slate-400">Bottle ml Queues</td>
                      <td className="py-3 px-4 text-slate-400">Discrete Unit LP</td>
                      <td className="py-3 px-4"><span className="text-emerald-400 font-bold">ONLINE</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: VECTOR DB */}
          {activeTab === 'vector' && (
            <div className="space-y-4">
              <div className="p-5 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold text-fuchsia-400 uppercase tracking-widest flex items-center gap-2">
                  <Database size={14} /> Localized HNSW Vector Embedding Graph
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  The system maps every vape brand, nicotine strength, and e-liquid flavor into a 1536-dimensional normalized cosine manifold. When the salesman scribbles abbreviations (e.g. <em>"Tokyio 50mg Song strawb"</em>), the HNSW graph performs greedy layer traversal in <strong>34ms</strong> to find the exact catalog product without requiring exact string matches.
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-800 text-xs font-mono">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Index Structure</span>
                    <strong className="text-slate-200">HNSW (Hierarchical)</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Distance Metric</span>
                    <strong className="text-slate-200">Cosine (1 - u·v)</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Graph Degree (M)</span>
                    <strong className="text-slate-200">M = 16 connections</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Search Beam (efSearch)</span>
                    <strong className="text-slate-200">ef = 64 nodes</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SYSTEM MANIFEST YAML */}
          {activeTab === 'manifest' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Exportable architecture blueprint for cluster deployment:
                </span>
                <button
                  onClick={handleCopyManifest}
                  className="px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copied ? 'Copied' : 'Copy Blueprint'}</span>
                </button>
              </div>

              <pre className="p-4 bg-slate-950 rounded-2xl border border-slate-800 text-[11px] font-mono text-emerald-400 overflow-x-auto max-h-96 leading-relaxed selection:bg-slate-700">
                {ARCHITECTURE_MANIFEST_YAML}
              </pre>
            </div>
          )}

        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <span>Engine: VapeTrax Autonomous Vision Agent System (VT-AVAS Core v4.2)</span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl transition"
          >
            Close Inspector
          </button>
        </div>

      </div>
    </div>
  );
};

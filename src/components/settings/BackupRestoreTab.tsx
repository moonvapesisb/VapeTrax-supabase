import React, { useState } from 'react';
import { Save, Upload, Info, Lock, Download } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { exportBackup } from '../../lib/backup';
import { reauthenticateForSensitiveAction, requiresPasswordReauth } from '../../lib/secureAction';
import toast from 'react-hot-toast';

export const BackupRestoreTab: React.FC = () => {
  const { shopId, currentUser } = useAuth();
  const [password, setPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const needsPassword = requiresPasswordReauth(currentUser);

  const handleExport = async () => {
    if (!shopId) return;
    if (needsPassword && !password) {
      toast.error('Please enter your password to authorize backup');
      return;
    }

    setIsProcessing(true);
    try {
      if (needsPassword && currentUser) {
        await reauthenticateForSensitiveAction(currentUser, password);
      }
      await exportBackup(shopId);
      toast.success('Backup downloaded successfully');
      setPassword('');
    } catch (error: any) {
      const code = error?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        toast.error('Incorrect password.');
      } else {
        toast.error(error?.message || 'Failed to export backup');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
      <div className="flex items-center gap-3 border-b border-slate-100 pb-6">
        <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center text-violet-600">
          <Save size={20} />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900 tracking-tight">System Backup & Restore</h3>
          <p className="text-slate-500 text-sm">Download a full backup of your shop's data as a JSON file.</p>
        </div>
      </div>

      <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex gap-3">
        <Info className="text-sky-600 shrink-0 mt-0.5" size={20} />
        <div>
          <h4 className="font-bold text-sky-800 text-sm">Backups now include every record</h4>
          <p className="text-sky-700 text-xs mt-1 leading-relaxed">
            Older backup files stopped at 1,000 rows per table, so they may be missing sales. Download a fresh backup.
            Restore is turned off until a safe version is ready, so a backup file can never wipe your shop by accident.
          </p>
        </div>
      </div>

      {needsPassword && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-3">
            <Lock size={14} className="text-violet-600" />
            Security Verification Required
          </label>
          <input
            type="password"
            placeholder="Enter your account password to authorize"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full max-w-md px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 font-medium focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 outline-none transition-all shadow-sm"
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-violet-300 transition-all flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-full bg-violet-50 flex items-center justify-center text-violet-600">
            <Download size={32} />
          </div>
          <div>
            <h4 className="font-bold text-slate-900">Download Backup</h4>
            <p className="text-xs text-slate-500 mt-1">Export your entire database to a secure JSON file.</p>
          </div>
          <button
            onClick={handleExport}
            disabled={isProcessing}
            className="w-full mt-auto py-3 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-lg shadow-violet-600/20 transition-all disabled:opacity-50"
          >
            {isProcessing ? 'Processing...' : 'Export JSON Backup'}
          </button>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
            <Upload size={32} />
          </div>
          <div>
            <h4 className="font-bold text-slate-500">Restore System</h4>
            <p className="text-xs text-slate-500 mt-1">Temporarily disabled to protect your data. It will return as a safe, checked restore.</p>
          </div>
          <button
            type="button"
            disabled
            className="w-full mt-auto py-3 bg-slate-200 text-slate-500 font-bold rounded-xl cursor-not-allowed"
          >
            Restore unavailable
          </button>
        </div>
      </div>
    </div>
  );
};

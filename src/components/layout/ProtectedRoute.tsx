import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { WifiOff, ShieldAlert, Link2Off, RefreshCw, LogOut, ShoppingCart } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import LoadingSpinner from '../ui/LoadingSpinner';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'admin' | 'cashier';
}

// Pages that work without a live session: the POS writes to this device and
// the sync queue sends the sales once the internet is back.
const OFFLINE_ROUTES = new Set(['/', '/sales/new']);

interface NoticeProps {
  icon: React.ReactNode;
  title: string;
  message: string;
  showRetry?: boolean;
  showPos?: boolean;
}

const AccessNotice: React.FC<NoticeProps> = ({ icon, title, message, showRetry, showPos }) => {
  const { retryVerification, logout, currentUser } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  const handleRetry = async () => {
    setChecking(true);
    try {
      await retryVerification();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center space-y-5">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center">
          {icon}
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-slate-900">{title}</h1>
          <p className="text-sm text-slate-500">{message}</p>
          {currentUser?.email && (
            <p className="text-xs text-slate-400">Signed in as {currentUser.email}</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {showPos && (
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-violet-600 hover:bg-violet-700 text-white font-semibold text-sm rounded-xl transition-all"
            >
              <ShoppingCart size={16} />
              Back to New Sale
            </button>
          )}
          {showRetry && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={checking}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition-all disabled:opacity-60"
            >
              <RefreshCw size={16} className={checking ? 'animate-spin' : ''} />
              {checking ? 'Checking...' : 'Try again'}
            </button>
          )}
          <button
            type="button"
            onClick={() => { void logout(); }}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-slate-500 hover:text-slate-800 font-medium text-sm rounded-xl transition-all"
          >
            <LogOut size={16} />
            Log out
          </button>
        </div>
      </div>
    </div>
  );
};

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredRole }) => {
  const { currentUser, userRole, loading, authStatus } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingSpinner fullScreen />;
  }

  if (!currentUser || authStatus === 'signed-out') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (authStatus === 'unverified') {
    return (
      <AccessNotice
        icon={<ShieldAlert size={28} />}
        title="Connect to the internet to verify your account"
        message="This device has not confirmed your account yet, so nothing can be opened. Connect to the internet and try again."
        showRetry
      />
    );
  }

  // 'pending', an unknown role, or no shop: never treated as a cashier or admin.
  if (authStatus === 'not-linked' || (userRole !== 'admin' && userRole !== 'cashier')) {
    return (
      <AccessNotice
        icon={<Link2Off size={28} />}
        title="Your account is not linked to a shop yet"
        message="Ask the shop owner to add you. Nothing can be changed until then."
        showRetry
      />
    );
  }

  if (authStatus === 'offline') {
    const editingOldSale = !!(location.state as any)?.editSale;
    if (!OFFLINE_ROUTES.has(location.pathname) || editingOldSale) {
      return (
        <AccessNotice
          icon={<WifiOff size={28} />}
          title="Needs internet"
          message="You are working offline. New sales still work and are sent when the internet is back. This page needs a connection."
          showRetry
          showPos
        />
      );
    }
  }

  if (requiredRole && userRole !== 'admin' && userRole !== requiredRole) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

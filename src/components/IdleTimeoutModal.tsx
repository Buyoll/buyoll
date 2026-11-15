import React from 'react';
import { Clock, LogOut, ShieldCheck } from 'lucide-react';
import { useUser } from '../context/UserContext.tsx';

export const IdleTimeoutModal: React.FC<{ onLoggedOut?: (role?: string) => void }> = ({ onLoggedOut }) => {
  const {
    currentUser,
    idleWarningSecondsLeft,
    keepSessionAlive,
    logoutRole,
  } = useUser();

  if (!currentUser || idleWarningSecondsLeft === null) return null;

  const seconds = Math.max(0, Math.floor(idleWarningSecondsLeft));
  const formattedSeconds = String(seconds).padStart(2, '0');
  const activeRole = (currentUser.activeRole || currentUser.role || 'member').toLowerCase();

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-timeout-title"
    >
      <div className="bg-white dark:bg-[#111A17] border border-amber-300 dark:border-amber-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h2 id="idle-timeout-title" className="text-base font-black text-slate-900 dark:text-white">
              Session Expiring Soon
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">
              Active {activeRole} session inactivity check
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-center">
          <p className="text-sm font-bold text-amber-950 dark:text-amber-100">
            You will be locked out due to inactivity in{' '}
            <span className="font-mono text-lg font-black text-red-600 dark:text-red-400">
              0:{formattedSeconds}
            </span>
            .
          </p>
          <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1">
            Confirm you are still here to continue your session without losing your work.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={() => keepSessionAlive()}
            className="flex-1 py-2.5 px-4 bg-[#ff6600] hover:bg-[#ff8000] text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>I&apos;m still here</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              await logoutRole(activeRole);
              onLoggedOut?.(activeRole);
            }}
            className="sm:w-auto py-2.5 px-4 bg-slate-100 dark:bg-[#1A2622] hover:bg-slate-200 dark:hover:bg-[#24312C] text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Log out now</span>
          </button>
        </div>
      </div>
    </div>
  );
};

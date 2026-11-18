import React from 'react';
import { Shield, RefreshCw, AlertTriangle, ArrowLeft } from 'lucide-react';

const CHUNK_RETRY_KEY = 'buyoll_admin_chunk_retry_v1';

export function isChunkLoadError(err: any): boolean {
  const msg = String(err?.message || err || '');
  const name = String(err?.name || '');
  return (
    name === 'ChunkLoadError' ||
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk [\d\w-]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  );
}

let prefetchedPromise: Promise<any> | null = null;
export function importAdminControlCenterModule() {
  return import('../pages/AdminDashboardPage.tsx');
}

export function prefetchAdminControlCenter(): void {
  if (!prefetchedPromise) {
    prefetchedPromise = importAdminControlCenterModule().catch(() => {
      prefetchedPromise = null;
    });
  }
}

export function lazyWithChunkRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      const mod = await factory();
      try {
        sessionStorage.removeItem(CHUNK_RETRY_KEY);
      } catch {}
      return mod;
    } catch (err) {
      if (isChunkLoadError(err) && typeof window !== 'undefined') {
        let alreadyRetried = false;
        try {
          alreadyRetried = sessionStorage.getItem(CHUNK_RETRY_KEY) === '1';
        } catch {}
        if (!alreadyRetried) {
          try {
            sessionStorage.setItem(CHUNK_RETRY_KEY, '1');
          } catch {}
          // Retry dynamic import once first; if still failing (e.g. stale HTML after deploy), reload once
          try {
            const retried = await factory();
            try {
              sessionStorage.removeItem(CHUNK_RETRY_KEY);
            } catch {}
            return retried;
          } catch {
            window.location.reload();
            return new Promise<{ default: T }>(() => {});
          }
        }
      }
      throw err;
    }
  });
}

export const AdminControlCenterSkeleton: React.FC = () => (
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-pulse" aria-busy="true" aria-label="Loading Buyoll Admin Control Center">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#ff6600]/20" />
          <div className="h-7 w-72 bg-slate-200 rounded-lg" />
          <div className="h-5 w-20 bg-emerald-100 rounded-full" />
        </div>
        <div className="h-3.5 w-96 max-w-full bg-slate-200 rounded" />
      </div>
      <div className="flex items-center gap-2">
        <div className="h-9 w-24 bg-slate-200 rounded-xl" />
        <div className="h-9 w-24 bg-slate-200 rounded-xl" />
        <div className="h-9 w-24 bg-red-100 rounded-xl" />
      </div>
    </div>

    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
          <div className="h-3 w-24 bg-slate-200 rounded" />
          <div className="h-7 w-16 bg-slate-300 rounded" />
          <div className="h-3 w-32 bg-slate-100 rounded" />
        </div>
      ))}
    </div>

    <div className="flex gap-2 border-b border-slate-200 mb-6 pb-2 overflow-hidden">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-9 w-32 bg-slate-200 rounded-xl shrink-0" />
      ))}
    </div>

    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 bg-slate-100 rounded-xl" />
      ))}
    </div>
  </div>
);

interface ErrorBoundaryProps {
  onNavigateHome: () => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  retryKey: number;
}

export class AdminControlCenterErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      retryKey: 0,
    };
  }

  static getDerivedStateFromError(error: any): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage:
        error?.message || 'Unable to load the Buyoll Admin Control Center module.',
    };
  }

  handleRetry = () => {
    try {
      sessionStorage.removeItem(CHUNK_RETRY_KEY);
    } catch {}
    this.setState((prev) => ({
      hasError: false,
      errorMessage: '',
      retryKey: prev.retryKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-xl mx-auto px-4 py-16">
          <div className="bg-white border border-red-200 rounded-2xl p-8 shadow-sm text-center">
            <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-700 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-[#fff4ec] text-[#ff6600] text-[10px] font-bold uppercase rounded-full mb-2">
              <Shield className="w-3 h-3" />
              <span>Buyoll Admin Control Center</span>
            </div>
            <h2 className="text-lg font-black text-slate-900 mb-2">
              Could not load Control Center
            </h2>
            <p className="text-xs text-slate-600 mb-6 leading-relaxed">
              {this.state.errorMessage}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={this.handleRetry}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry</span>
              </button>
              <button
                type="button"
                onClick={this.props.onNavigateHome}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Return to Marketplace</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes so a single broken component shows a recovery
 * screen instead of a blank white page — which is what the app did before,
 * leaving a shop with no dashboard and no explanation.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Unhandled render error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-600/40 mb-5">
            <AlertTriangle className="w-7 h-7 text-rose-400" aria-hidden="true" />
          </div>

          <h1 className="text-xl font-bold text-white mb-2">Something went wrong</h1>
          <p className="text-sm text-slate-400 mb-6">
            The page failed to load. Your data is safe — reloading usually fixes this. If it keeps
            happening, please report it with the message below.
          </p>

          <pre className="text-left text-xs bg-slate-950 border border-slate-800 rounded-lg p-3 mb-6 overflow-x-auto text-rose-300">
            {error.message}
          </pre>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}

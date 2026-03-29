import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12">
          <div className="rounded-3xl border border-red-500/20 bg-red-500/[0.06] p-8 text-center max-w-md">
            <p className="text-lg font-semibold text-white">Something went wrong</p>
            <p className="mt-2 text-sm text-slate-400">
              {this.props.fallbackLabel || 'This section encountered an error.'}
            </p>
            {this.state.error && (
              <p className="mt-3 rounded-xl bg-slate-950 p-3 text-xs text-red-300 font-mono break-all">
                {this.state.error.message}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                this.props.onReset?.();
              }}
              className="mt-5 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-950 hover:bg-gray-100"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

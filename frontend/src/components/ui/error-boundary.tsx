import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearLocalSession, resetSessionExpiredState } from '../../utils/api';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Error capturado:', error.message);
    console.error('[ErrorBoundary] Component stack:', info.componentStack);

    try {
      const payload = {
        mensaje: error.message,
        stack: error.stack?.slice(0, 2000) ?? '',
        componente: info.componentStack?.slice(0, 2000) ?? '',
        url: window.location.href.slice(0, 500),
        userAgent: navigator.userAgent.slice(0, 500),
        timestamp: new Date().toISOString(),
      };
      navigator.sendBeacon('/api/errores-frontend', JSON.stringify(payload));
    } catch {
      // Beacon fallido — no hacer nada, no queremos otro error encadenado
    }
  }

  componentWillUnmount() {
    if (this.retryTimeout != null) {
      clearTimeout(this.retryTimeout);
    }
  }

  handleRetry = () => {
    window.location.reload();
  };

  handleCleanReload = () => {
    try {
      clearLocalSession();
      resetSessionExpiredState();
    } catch {
      // Limpiar storage puede fallar si está corrupto; ignoramos
    }
    window.location.href = '/login';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="system-bg min-h-svh grid place-items-center px-4 text-center">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-[#2d466d]/70 bg-[#10264a]/60 px-8 py-7 max-w-sm">
            <span className="material-symbols-outlined text-4xl text-amber-400">error_outline</span>
            <div>
              <p className="text-[#e7eef9] text-lg font-semibold">Algo salió mal</p>
              <p className="text-slate-400 text-sm mt-1">
                La aplicación encontró un error inesperado. Probá reintentar o volver al inicio.
              </p>
            </div>
            <div className="flex gap-3 w-full">
              <button
                type="button"
                onClick={this.handleRetry}
                className="btn-modern btn-modern-primary flex-1"
              >
                Reintentar
              </button>
              <button
                type="button"
                onClick={this.handleCleanReload}
                className="btn-modern btn-modern-ghost flex-1"
              >
                Ir al inicio
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

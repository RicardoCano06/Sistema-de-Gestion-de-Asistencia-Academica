import { useEffect, useState } from 'react';

export type ImportConfirmPhase = 'idle' | 'confirming' | 'syncing' | 'success' | 'error';

const PHASE_MESSAGE: Record<Exclude<ImportConfirmPhase, 'idle'>, string> = {
  confirming: 'Confirmando e insertando registros en la base de datos…',
  syncing: 'Actualizando detalle del lote…',
  success: '¡Importación confirmada!',
  error: 'No se pudo completar la confirmación',
};

type ImportConfirmOverlayProps = {
  phase: ImportConfirmPhase;
  archivo?: string | null;
  totalRegistros?: number | null;
  errorMessage?: string | null;
  /** Mensaje final en pantalla (sustituye el toast inferior). */
  successMessage?: string | null;
  onDismissError?: () => void;
};

export function ImportConfirmOverlay({
  phase,
  archivo,
  totalRegistros,
  errorMessage,
  successMessage,
  onDismissError,
}: ImportConfirmOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  const isBusy = phase === 'confirming' || phase === 'syncing';
  const isSuccess = phase === 'success';
  const isError = phase === 'error';

  useEffect(() => {
    if (phase === 'idle') {
      const hideTimer = window.setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 220);
      return () => window.clearTimeout(hideTimer);
    }

    setVisible(true);

    if (phase === 'confirming') {
      setProgress(0.06);
      let current = 0.06;
      const interval = window.setInterval(() => {
        current = Math.min(current + (0.68 - current) * 0.09 + 0.005, 0.68);
        setProgress(current);
      }, 120);
      return () => window.clearInterval(interval);
    }

    if (phase === 'syncing') {
      setProgress((p) => Math.max(p, 0.72));
      const interval = window.setInterval(() => {
        setProgress((p) => Math.min(p + (0.94 - p) * 0.2 + 0.01, 0.94));
      }, 80);
      return () => window.clearInterval(interval);
    }

    if (phase === 'success') {
      setProgress(1);
      return undefined;
    }

    if (phase === 'error') {
      setProgress(0);
      return undefined;
    }

    return undefined;
  }, [phase]);

  if (!visible && phase === 'idle') return null;

  const message =
    phase === 'error' && errorMessage
      ? errorMessage
      : phase === 'success' && successMessage
        ? successMessage
        : phase !== 'idle'
          ? PHASE_MESSAGE[phase]
          : '';

  const pct = Math.round(progress * 100);
  const showPanel = phase !== 'idle' || visible;

  const cardClass = isSuccess
    ? 'border-emerald-300 bg-white shadow-lg shadow-emerald-500/15 dark:border-emerald-500/40 dark:bg-[#132a52]/95 dark:shadow-emerald-500/10'
    : isError
      ? 'border-rose-300 bg-white shadow-lg shadow-rose-500/15 dark:border-rose-500/35 dark:bg-[#132a52]/95 dark:shadow-rose-500/10'
      : 'border-slate-200 bg-white shadow-xl shadow-slate-300/40 dark:border-primary/25 dark:bg-[#132a52]/95 dark:shadow-primary/10';

  return (
    <div
      className={`absolute inset-0 z-30 flex min-w-0 flex-col items-center justify-center overflow-hidden px-4 sm:px-6 transition-opacity duration-200 ${
        showPanel ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      role="status"
      aria-live="polite"
      aria-busy={isBusy ? 'true' : 'false'}
    >
      <div
        className="absolute inset-0 bg-white/70 backdrop-blur-sm dark:bg-[#0a1424]/75"
        aria-hidden="true"
      />

      <div className={`relative w-full min-w-0 max-w-[min(100%,20rem)] sm:max-w-[320px] rounded-2xl border p-4 sm:p-6 animate-fade-in ${cardClass}`}>
        <div className="flex flex-col items-center text-center">
          <div className="relative w-[88px] h-[88px] mb-5" aria-hidden="true">
            {isBusy ? (
              <>
                <span className="absolute inset-0 rounded-full border-2 border-primary/25 animate-ping dark:border-primary/20" />
                <span className="absolute inset-1 rounded-full border border-dashed border-primary/50 animate-spin [animation-duration:4s] dark:border-primary/40" />
                <span className="absolute inset-3 rounded-full bg-primary/15 dark:bg-primary/10" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[42px] text-primary animate-bounce">
                    cloud_upload
                  </span>
                </div>
              </>
            ) : isSuccess ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="material-symbols-outlined text-[52px] text-emerald-600 dark:text-emerald-400">
                  check_circle
                </span>
              </div>
            ) : isError ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="material-symbols-outlined text-[52px] text-rose-600 dark:text-rose-400">
                  error
                </span>
              </div>
            ) : null}
          </div>

          <h4 className="text-slate-900 font-semibold text-base mb-1 dark:text-[#f0f4f8]">
            {isSuccess ? 'Listo' : isError ? 'Error' : 'Confirmando importación'}
          </h4>
          <p
            className={`scroll-region text-xs mb-4 leading-relaxed max-h-28 px-1 w-full min-w-0 ${
              isError
                ? 'text-rose-800 dark:text-rose-100'
                : 'text-slate-600 dark:text-slate-400'
            } ${isSuccess || isBusy ? 'min-h-[2.5rem]' : ''}`}
          >
            {message}
          </p>

          {archivo ? (
            <p
              className="text-[11px] text-slate-500 mb-3 w-full truncate dark:text-slate-500"
              title={archivo}
            >
              {archivo}
            </p>
          ) : null}

          {!isError ? (
            <>
              <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden mb-2 relative dark:bg-slate-800/90">
                <div
                  className={`h-full rounded-full transition-[width] duration-150 ease-out relative overflow-hidden ${
                    isSuccess
                      ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 dark:from-emerald-500 dark:to-emerald-400'
                      : 'bg-gradient-to-r from-primary via-primary to-sky-500 dark:from-primary/80 dark:via-primary dark:to-sky-400'
                  }`}
                  style={{ width: `${Math.max(progress * 100, isBusy ? 8 : 100)}%` }}
                >
                  {isBusy ? (
                    <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent animate-import-shimmer dark:via-white/35" />
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-between w-full text-[11px]">
                <span className="text-slate-600 dark:text-slate-500">
                  {totalRegistros != null && totalRegistros > 0
                    ? `${totalRegistros.toLocaleString('es-AR')} registros`
                    : 'Procesando lote'}
                </span>
                <span
                  className={`font-semibold tabular-nums ${
                    isSuccess ? 'text-emerald-700 dark:text-emerald-400' : 'text-primary'
                  }`}
                >
                  {pct}%
                </span>
              </div>
            </>
          ) : null}

          {isBusy ? (
            <div className="flex items-center gap-1.5 mt-4" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full bg-primary/80 animate-bounce [animation-duration:0.9s] dark:bg-primary/70 ${
                    i === 1 ? '[animation-delay:0.15s]' : i === 2 ? '[animation-delay:0.3s]' : ''
                  }`}
                />
              ))}
            </div>
          ) : null}

          {isBusy ? (
            <p className="text-[10px] text-slate-500 mt-4 leading-snug dark:text-slate-500">
              {phase === 'syncing'
                ? 'Sincronizando con el servidor…'
                : 'No cierres esta ventana hasta que finalice.'}
            </p>
          ) : null}

          {isError && onDismissError ? (
            <button
              type="button"
              className="mt-4 px-4 py-2 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-500"
              onClick={onDismissError}
            >
              Entendido
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

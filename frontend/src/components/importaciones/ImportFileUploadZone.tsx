import type { ChangeEvent, RefObject } from 'react';

export type ImportUploadPhase = 'idle' | 'parsing' | 'creating' | 'uploading' | 'syncing' | 'success' | 'error';

const PHASE_LABEL: Record<Exclude<ImportUploadPhase, 'idle'>, string> = {
  parsing: 'Leyendo archivo Excel…',
  creating: 'Validando y creando lote…',
  uploading: 'Enviando registros…',
  syncing: 'Actualizando historial…',
  success: '¡Archivo cargado!',
  error: 'No se pudo cargar el archivo',
};

type ImportFileUploadZoneProps = {
  phase: ImportUploadPhase;
  progress: number;
  message: string | null;
  fileName: string | null;
  errorMessage?: string | null;
  disabled: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onManualTrigger: () => void;
  onDismissError?: () => void;
};

export function ImportFileUploadZone({
  phase,
  progress,
  message,
  fileName,
  errorMessage,
  disabled,
  fileInputRef,
  onFileChange,
  onManualTrigger,
  onDismissError,
}: ImportFileUploadZoneProps) {
  const uploadBusy = phase !== 'idle';
  const isError = phase === 'error';
  const isSuccess = phase === 'success';
  const isLoading = uploadBusy && !isError && !isSuccess;
  const pct = Math.round(progress * 100);

  const statusText =
    phase === 'idle'
      ? 'Esperando archivo'
      : isError && errorMessage
        ? errorMessage
        : message ?? PHASE_LABEL[phase];

  const barPercent =
    phase === 'idle' ? 0 : isError ? 0 : Math.max(progress * 100, isLoading ? 8 : 100);

  const barColor = isError
    ? 'bg-rose-500'
    : isSuccess
      ? 'bg-emerald-500'
      : 'bg-primary';

  return (
    <div className="relative w-full min-w-0 group">
      <input
        ref={fileInputRef}
        type="file"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
        onChange={onFileChange}
        accept=".xlsx"
        disabled={disabled || uploadBusy}
        aria-busy={isLoading}
      />

      <div
        className={`app-file-upload-zone app-file-upload-zone--stacked group-hover:border-primary group-hover:bg-slate-50 dark:group-hover:bg-slate-800/40 ${
          isError
            ? 'border-rose-400 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-950/30'
            : ''
        }`}
      >
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform shrink-0">
          <span
            className={`material-symbols-outlined text-[28px] sm:text-[32px] text-primary ${
              isLoading ? 'animate-pulse' : ''
            }`}
          >
            cloud_upload
          </span>
        </div>

        <h3 className="text-slate-900 font-medium text-base sm:text-lg mb-1 dark:text-[#f0f4f8] max-w-full px-1">
          Haz clic o arrastra tu archivo
        </h3>
        <p className="text-slate-600 text-sm mb-4 sm:mb-6 dark:text-slate-400 max-w-full px-1">
          Formato soportado: Excel (.xlsx) (máx. 25 MB)
        </p>

        <div className="flex w-full max-w-full min-w-0 flex-col items-stretch justify-center gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 text-xs text-slate-500 dark:text-slate-400">
          <button
            type="button"
            className="px-3 py-1 rounded-full bg-primary/10 text-primary disabled:opacity-60 disabled:cursor-not-allowed relative z-[11] w-full sm:w-auto shrink-0"
            onClick={onManualTrigger}
            disabled={disabled || uploadBusy}
          >
            Seleccionar archivo
          </button>
          <span className={`min-w-0 text-center sm:text-left ${isError ? 'text-rose-800 dark:text-rose-200' : ''}`}>{statusText}</span>
          {isLoading || isSuccess ? (
            <span className="font-semibold text-slate-800 dark:text-[#f0f4f8] tabular-nums">{pct}%</span>
          ) : null}
        </div>

        {isError ? (
          <button
            type="button"
            className="mt-4 px-4 py-2 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-500 relative z-[11]"
            onClick={onDismissError}
          >
            Entendido
          </button>
        ) : null}

        {disabled && !uploadBusy ? (
          <p className="text-xs text-amber-700 mt-2 dark:text-amber-300">
            Primero selecciona facultad, carrera y semestre para habilitar la carga.
          </p>
        ) : null}

        {fileName && uploadBusy && !isError ? (
          <p className="text-xs text-slate-500 mt-2 dark:text-slate-500">Archivo: {fileName}</p>
        ) : null}

        {!uploadBusy && fileName ? (
          <p className="text-xs text-slate-500 mt-2 dark:text-slate-500">Último archivo: {fileName}</p>
        ) : null}

        <div className="w-full min-w-0 max-w-md h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mt-4">
          <div
            className={`h-full transition-all duration-200 ease-out ${barColor}`}
            style={{ width: `${barPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

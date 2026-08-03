import { useState } from 'react';
import { formatearRangoFechasGrupo } from '../utils/justificaciones-grupo';

type Props = {
  fechas: string[];
  /** Variante clara (modal alumno) u oscura (planilla docente) */
  variant?: 'light' | 'dark';
};

const chipBase =
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums';

export function JustificacionFechasGrupo({ fechas, variant = 'light' }: Props) {
  const [expandido, setExpandido] = useState(false);
  const rango = formatearRangoFechasGrupo(fechas);

  if (rango.cantidad === 0) {
    return <span className="text-slate-400 dark:text-slate-500">—</span>;
  }

  const esOscuro = variant === 'dark';
  const iconCls = esOscuro ? 'text-sky-400/90' : 'text-sky-600 dark:text-sky-400/90';
  const tituloCls = esOscuro ? 'text-[#e7eef9]' : 'text-slate-800 dark:text-slate-100';
  const subCls = esOscuro ? 'text-slate-500' : 'text-slate-500 dark:text-slate-400';
  const cajaCls = esOscuro
    ? 'rounded-lg border border-slate-700/80 bg-[#07101f] p-2'
    : 'rounded-lg border border-slate-200/90 bg-white/80 p-2 shadow-sm dark:border-white/10 dark:bg-[#0a162c]/50';
  const chipCls = esOscuro
    ? `${chipBase} border-slate-700 bg-[#132a52] text-[#9fb3d4]`
    : `${chipBase} border-sky-200/80 bg-sky-50/90 text-sky-900 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-100`;
  const btnCls = esOscuro
    ? 'text-[11px] font-medium text-sky-400 hover:text-sky-300'
    : 'text-[11px] font-medium text-sky-700 hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200';

  if (rango.cantidad === 1) {
    return (
      <div className="flex items-center gap-1.5 min-w-[6.5rem]">
        <span className={`material-symbols-outlined shrink-0 text-[17px] ${iconCls}`} aria-hidden>
          event
        </span>
        <span className={`text-sm font-semibold tabular-nums ${tituloCls}`}>{rango.principal}</span>
      </div>
    );
  }

  return (
    <div className={`min-w-0 max-w-full w-full space-y-1.5 ${cajaCls}`}>
      <div className="flex items-start gap-1.5">
        <span className={`material-symbols-outlined shrink-0 text-[17px] mt-0.5 ${iconCls}`} aria-hidden>
          date_range
        </span>
        <div className="min-w-0">
          <p className={`text-sm font-semibold leading-snug tabular-nums ${tituloCls}`}>{rango.principal}</p>
          <p className={`mt-0.5 text-[11px] leading-tight ${subCls}`}>
            {rango.cantidad} clases · 1 documento
          </p>
        </div>
      </div>
      <button
        type="button"
        className={`inline-flex items-center gap-0.5 ${btnCls}`}
        onClick={() => setExpandido((v) => !v)}
        aria-expanded={expandido}
      >
        <span className="material-symbols-outlined text-[14px]" aria-hidden>
          {expandido ? 'expand_less' : 'expand_more'}
        </span>
        {expandido ? 'Ocultar fechas' : 'Ver todas las fechas'}
      </button>
      {expandido ? (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {rango.fechasCortas.map((f) => (
            <span key={f} className={chipCls}>
              <span className="material-symbols-outlined text-[12px] opacity-70" aria-hidden>
                calendar_today
              </span>
              {f}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

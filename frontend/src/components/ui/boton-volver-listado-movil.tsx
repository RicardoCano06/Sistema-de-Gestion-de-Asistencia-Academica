import type { ReactNode } from 'react';

type BotonVolverListadoMovilProps = {
  onClick: () => void;
  className?: string;
  ariaLabel?: string;
  label?: string;
};

/** Botón «Volver al listado» para master–detail en móvil/tablet (ocultar en PC con xl:hidden / lg:hidden en el contenedor). */
export function BotonVolverListadoMovil({
  onClick,
  className = '',
  ariaLabel = 'Volver al listado',
  label = 'Volver al listado',
}: BotonVolverListadoMovilProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn-modern btn-modern-ghost btn-modern-sm btn-mobile-cta group flex w-full min-h-11 items-center justify-start gap-2.5 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-all active:scale-[0.99] hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-600/80 dark:bg-slate-900/50 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800/70 ${className}`}
      aria-label={ariaLabel}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 transition-colors group-hover:bg-sky-200/90 dark:bg-sky-500/15 dark:text-sky-300 dark:group-hover:bg-sky-500/25">
        <span className="material-symbols-outlined text-[20px]">arrow_back</span>
      </span>
      {label}
    </button>
  );
}

export function VolverListadoMovilBar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex shrink-0 items-center border-b border-slate-200 bg-slate-50/95 px-3 py-2.5 dark:border-slate-800 dark:bg-[#0f1f3d] ${className}`}
    >
      {children}
    </div>
  );
}

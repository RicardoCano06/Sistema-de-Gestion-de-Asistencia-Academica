import { useEffect } from 'react';
import { cn } from '../lib/utils';
import { AppSelect } from './ui/app-select';
import { Skeleton } from './ui/skeleton';

export interface ScopeOption {
  id: number;
  nombre: string;
}

export interface ScopeSelectorProps {
  label: string;
  /** Opciones permitidas según `/scopes/mis-alcances` (o catálogo acotado). */
  options: ScopeOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
  /** Clases del control (select o bloque de solo lectura). */
  controlClassName?: string;
  /** Si true y hay varias opciones, permite valor vacío (ej. "Todas" en listados). */
  allowEmptyOption?: boolean;
  emptyOptionLabel?: string;
  /** Barra de filtros inline (sin etiqueta encima del control). */
  hideLabel?: boolean;
  /** Texto cuando aún no hay opciones (ej. cascada facultad → carrera). */
  emptyOptionsHint?: string;
}

const readonlyDefaultClass =
  'px-3 py-2 text-sm text-slate-700 dark:text-slate-300 rounded-lg bg-slate-50 border border-slate-200 dark:bg-slate-900/30 dark:border-slate-700';

const skeletonFieldClass = 'rounded bg-slate-200 dark:bg-white/10';

/** Placeholder mientras se resuelve alcance y catálogo (evita flash de selectores vacíos). */
export function ScopeSelectorSkeleton({
  soloCarrera = false,
  soloFacultad = false,
  hideLabel = false,
  className = '',
  gridClassName,
}: {
  soloCarrera?: boolean;
  soloFacultad?: boolean;
  hideLabel?: boolean;
  className?: string;
  /** Ej. `xl:grid-cols-2` o `grid-cols-1 lg:grid-cols-2` */
  gridClassName?: string;
}) {
  const grid = gridClassName ?? (soloCarrera || soloFacultad ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2');
  const mostrarFacultad = !soloCarrera;
  const mostrarCarrera = !soloFacultad;
  const labelH = hideLabel ? 'hidden' : 'block';
  const layoutClass = gridClassName?.trimStart().startsWith('flex')
    ? cn(gridClassName, className)
    : cn('grid gap-4', grid, className);

  return (
    <div className={layoutClass}>
      {mostrarFacultad ? (
        <div className="space-y-2">
          <Skeleton className={`h-3 w-16 ${labelH} ${skeletonFieldClass}`} />
          <Skeleton className={`h-10 w-full rounded-lg ${skeletonFieldClass}`} />
        </div>
      ) : null}
      {mostrarCarrera ? (
        <div className="space-y-2">
          <Skeleton className={`h-3 w-14 ${labelH} ${skeletonFieldClass}`} />
          <Skeleton className={`h-10 w-full rounded-lg ${skeletonFieldClass}`} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Selector estándar de alcance institucional (facultad / carrera).
 * - `options.length === 1`: texto de solo lectura; el padre debe enlazar el ID vía `useAutoAssignScopeId`.
 * - `options.length > 1`: desplegable con lista redondeada (`AppSelect`).
 */
export function ScopeSelector({
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  className = '',
  controlClassName,
  allowEmptyOption = false,
  emptyOptionLabel = 'Todas',
  hideLabel = false,
  emptyOptionsHint,
}: ScopeSelectorProps) {
  const unica = options.length === 1 ? options[0] : null;
  const wrapClass = hideLabel
    ? cn('min-w-0', className)
    : cn('min-w-0 w-full max-w-full space-y-2', className);

  if (unica) {
    return (
      <div className={wrapClass}>
        {hideLabel ? null : (
          <label className="text-xs uppercase text-slate-500 dark:text-slate-400">{label}</label>
        )}
        <p
          className={controlClassName ?? readonlyDefaultClass}
          aria-readonly="true"
          aria-label={label}
          data-scope-id={unica.id}
        >
          {unica.nombre}
        </p>
      </div>
    );
  }

  const selectOptions = options.map((o) => ({
    value: String(o.id),
    label: o.nombre,
  }));

  return (
    <div className={wrapClass}>
      {hideLabel ? null : (
        <label className="text-xs uppercase text-slate-500 dark:text-slate-400">{label}</label>
      )}
      <AppSelect
        className="w-full"
        options={selectOptions}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled || options.length === 0}
        allowEmpty={allowEmptyOption}
        emptyLabel={emptyOptionLabel}
        emptyOptionsText={options.length === 0 ? (emptyOptionsHint ?? placeholder) : undefined}
        aria-label={label}
        triggerClassName={controlClassName}
      />
    </div>
  );
}

/**
 * Auto-asigna el ID cuando hay una sola opción; limpia el valor si deja de ser válido.
 * Usar en el formulario padre junto con `ScopeSelector`.
 */
export function useAutoAssignScopeId(
  options: ScopeOption[],
  value: string,
  setValue: (id: string) => void
): void {
  useEffect(() => {
    if (options.length === 1) {
      const id = String(options[0].id);
      if (value !== id) setValue(id);
      return;
    }
    if (value && !options.some((o) => String(o.id) === value)) {
      setValue('');
    }
  }, [options, value, setValue]);
}

import { useMemo } from 'react';
import { AppSelect } from '../ui/app-select';

export interface ReportesCursoOpcion {
  id: number;
  materia?: string;
  docente?: string;
  anio?: number;
  mes?: number;
}

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

function formatPeriodo(anio?: number, mes?: number): string {
  if (!anio) return '—';
  const idx = mes != null && mes >= 1 && mes <= 12 ? mes - 1 : -1;
  const mesLabel = idx >= 0 ? MESES[idx] : '—';
  return `${mesLabel} ${anio}`;
}

/** Una línea legible: materia · docente · período. */
export function formatCursoOpcionLabel(c: ReportesCursoOpcion): string {
  const materia = c.materia?.trim() || 'Curso';
  const docente = c.docente?.trim() || 'Sin docente';
  return `${materia} · ${docente} · ${formatPeriodo(c.anio, c.mes)}`;
}

interface ReportesCursoPickerProps {
  options: ReportesCursoOpcion[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

export function ReportesCursoPicker({
  options,
  value,
  onChange,
  disabled = false,
  loading = false,
  className,
}: ReportesCursoPickerProps) {
  const selectOptions = useMemo(
    () =>
      options.map((c) => ({
        value: String(c.id),
        label: formatCursoOpcionLabel(c),
      })),
    [options]
  );

  return (
    <AppSelect
      className={className}
      options={selectOptions}
      value={value}
      onChange={onChange}
      disabled={disabled}
      loading={loading}
      placeholder="Selecciona un curso"
      title="Seleccionar curso"
      aria-label="Seleccionar curso"
    />
  );
}

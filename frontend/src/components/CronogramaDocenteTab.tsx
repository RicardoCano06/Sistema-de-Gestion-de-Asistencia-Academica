import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, isSessionExpiredError, generarYAbrirPdf } from '../utils/api';
import { toast } from '../utils/toast';
import { ConfirmDialog } from '../components/ui/confirm-dialog';

type SemanaCronograma = {
  id: number;
  semana_numero: number;
  fecha_inicio: string;
  fecha_fin: string;
  contenidos: string[];
  actividades: string[];
  horas: number;
  firmado: boolean;
  firmado_en: string | null;
  firmado_por: string | null;
};

type EvaluacionCronograma = {
  id: number;
  tipo: 'parcial' | 'final';
  fecha: string | null;
  alcance_prueba: string | null;
  firmado: boolean;
  firmado_en: string | null;
  firmado_por: string | null;
};

type CronogramaDocenteData = {
  semanas: SemanaCronograma[];
  evaluaciones: EvaluacionCronograma[];
  todas_firmadas: boolean;
};

function formatDateRange(inicio: string, fin: string): string {
  const parse = (d: string) => {
    const [, m, day] = d.split('-').map(Number);
    return { d: day, m };
  };
  const i = parse(inicio);
  const f = parse(fin);
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${meses[i.m - 1]} ${i.d} — ${meses[f.m - 1]} ${f.d}`;
}

function formatFirmaFecha(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDateDisplay(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

interface CronogramaDocenteTabProps {
  cursoId: number;
}

export default function CronogramaDocenteTab({ cursoId }: CronogramaDocenteTabProps) {
  const [data, setData] = useState<CronogramaDocenteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingId, setSigningId] = useState<number | null>(null);
  const [signingType, setSigningType] = useState<'semana' | 'evaluacion' | null>(null);
  const [showSignConfirm, setShowSignConfirm] = useState<{ id: number; type: 'semana' | 'evaluacion' } | null>(null);
  const [showSignAllConfirm, setShowSignAllConfirm] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const result = await apiFetch<CronogramaDocenteData>(`/asistencias/cronograma/${cursoId}`);
      setData(result);
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      toast.error(err instanceof Error ? err.message : 'No se pudo cargar el cronograma');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cursoId]);

  useEffect(() => { load(true); }, [load]);

  const handleFirmar = async () => {
    if (!showSignConfirm) return;
    const { id, type } = showSignConfirm;
    setShowSignConfirm(null);
    setSigningId(id);
    setSigningType(type);

    const url = type === 'semana'
      ? `/asistencias/cronograma/semanas/${id}/firmar`
      : `/asistencias/cronograma/evaluaciones/${id}/firmar`;

    try {
      const result = await apiFetch<{ firmado: boolean; firmado_en: string; docente_nombre: string }>(url, { method: 'POST' });
      setData((prev) => {
        if (!prev) return prev;
        if (type === 'semana') {
          return {
            ...prev,
            semanas: prev.semanas.map((s) =>
              s.id === id ? { ...s, firmado: true, firmado_en: result.firmado_en, firmado_por: result.docente_nombre } : s
            ),
            todas_firmadas: prev.semanas.every((s) => s.id === id ? true : s.firmado) && prev.evaluaciones.every((e) => e.firmado),
          };
        } else {
          return {
            ...prev,
            evaluaciones: prev.evaluaciones.map((e) =>
              e.id === id ? { ...e, firmado: true, firmado_en: result.firmado_en, firmado_por: result.docente_nombre } : e
            ),
            todas_firmadas: prev.semanas.every((s) => s.firmado) && prev.evaluaciones.every((e) => e.id === id ? true : e.firmado),
          };
        }
      });
      toast.success(type === 'semana' ? 'Semana firmada' : 'Evaluación firmada');
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      toast.error(err instanceof Error ? err.message : 'No se pudo firmar');
    } finally {
      setSigningId(null);
      setSigningType(null);
    }
  };

  const handleFirmarTodo = async () => {
    setShowSignAllConfirm(false);
    setSigningId(-1);
    try {
      const result = await apiFetch<{ firmados: number; total: number }>(`/asistencias/cronograma/${cursoId}/firmar-todo`, { method: 'POST' });
      toast.success(`${result.firmados} de ${result.total} elementos firmados`);
      await load();
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      toast.error(err instanceof Error ? err.message : 'No se pudo firmar');
    } finally {
      setSigningId(null);
    }
  };

  const totalHoras = useMemo(() => (data?.semanas ?? []).reduce((acc, s) => acc + (Number(s.horas) || 0), 0), [data]);

  const SignBadge = ({ firmado, firmado_en: _en }: { firmado: boolean; firmado_en: string | null }) => {
    if (firmado) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <span className="material-symbols-outlined text-[12px]">check_circle</span>
          Firmado
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        <span className="material-symbols-outlined text-[12px]">pending</span>
        Pendiente
      </span>
    );
  };

  const Skel = ({ children, w }: { children: React.ReactNode; w?: string }) => {
    if (refreshing) {
      return <div className={`animate-pulse rounded bg-slate-200 dark:bg-slate-700 h-5 ${w ?? 'w-full'}`} />;
    }
    return <>{children}</>;
  };

  const SignBtn = ({ id, type, firmado }: { id: number; type: 'semana' | 'evaluacion'; firmado: boolean }) => {
    if (firmado) return null;
    const isSigning = signingId === id && signingType === type;
    return (
      <button
        type="button"
        className="btn-modern btn-modern-xs shrink-0 text-[10px] px-2 py-0.5"
        style={{ backgroundColor: '#3f9a75', color: 'white', border: 'none' }}
        onClick={() => setShowSignConfirm({ id, type })}
        disabled={isSigning}
      >
        <span className="material-symbols-outlined text-[12px]">draw</span>
        {isSigning ? '...' : 'Firmar'}
      </button>
    );
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-[#132a52]">
        <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-48" />
        <div className="h-32 bg-slate-100 dark:bg-slate-800 rounded" />
      </div>
    );
  }

  if (!data || data.semanas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white py-16 px-4 text-center shadow-sm dark:border-slate-700 dark:bg-[#132a52]">
        <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600">calendar_month</span>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Sin cronograma de cátedra</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">La coordinación académica aún no cargó el cronograma para este curso.</p>
      </div>
    );
  }

  const headerCell = 'px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 text-center';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-black dark:text-[#e7eef9]">Cronograma de cátedra</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {data.semanas.length} semana{data.semanas.length !== 1 ? 's' : ''} · Total: {totalHoras} h
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.todas_firmadas ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs dark:border-emerald-800 dark:bg-emerald-950/40">
              <span className="material-symbols-outlined text-emerald-600 dark:text-emerald-400 text-[18px]">verified</span>
              <span className="font-semibold text-emerald-700 dark:text-emerald-300">Todo firmado</span>
            </div>
          ) : (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {data.semanas.filter((s) => s.firmado).length + data.evaluaciones.filter((e) => e.firmado).length} de {data.semanas.length + data.evaluaciones.length} firmados
            </span>
          )}
          <button
            type="button"
            className="btn-modern btn-modern-ghost btn-modern-sm shrink-0"
            onClick={() => load()}
            disabled={refreshing}
          >
            <span className={`material-symbols-outlined text-[16px] ${refreshing ? 'animate-spin' : ''}`}>refresh</span>
          </button>
          <button
            type="button"
            className="btn-modern btn-modern-ghost btn-modern-sm shrink-0"
            onClick={() => {
              setDownloading(true);
              generarYAbrirPdf(`/reportes/cursos/${cursoId}/cronograma-pdf`, { method: 'POST' }).finally(() => setDownloading(false));
            }}
            disabled={downloading}
          >
            <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
            {downloading ? '...' : 'PDF'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-[#132a52]">
        <table className="w-full min-w-[50rem] text-sm">
          <thead>
            <tr>
              <th className={`${headerCell} w-[18%]`}>Fecha</th>
              <th className={`${headerCell} w-[31%]`}>Contenidos</th>
              <th className={`${headerCell} w-[31%]`}>Actividades</th>
              <th className={`${headerCell} w-[7%]`}>Horas</th>
              {data?.todas_firmadas ? (
                <th className={`${headerCell} w-[13%]`} colSpan={2}>Firma</th>
              ) : (
                <>
                  <th className={`${headerCell} w-[4%]`}>Firma</th>
                  <th className={`${headerCell} w-[9%]`}>
                    <button
                      type="button"
                      onClick={() => setShowSignAllConfirm(true)}
                      disabled={signingId !== null}
                      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold text-white"
                      style={{ backgroundColor: '#3f9a75' }}
                    >
                      <span className="material-symbols-outlined text-[11px]">draw</span>
                      Firmar todo
                    </button>
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {data.semanas.map((sem, semIdx) => {
              const maxRows = Math.max(sem.contenidos.length, sem.actividades.length, 1);
              const isEven = semIdx % 2 === 0;
              const semanaBg = isEven
                ? 'bg-white dark:bg-transparent'
                : 'bg-slate-50 dark:bg-slate-900/30';
              return Array.from({ length: maxRows }, (_, rowIdx) => {
                const isFirst = rowIdx === 0;
                const contenido = sem.contenidos[rowIdx] ?? '';
                const actividad = sem.actividades[rowIdx] ?? '';
                const isLastRow = rowIdx === maxRows - 1;

                return (
                  <tr key={`${sem.semana_numero}-${rowIdx}`} className={`${semanaBg} ${isLastRow ? 'border-b border-slate-200 dark:border-slate-700/60' : ''}`}>
                    {isFirst && (
                      <td className={`px-2 py-2 align-top text-sm font-semibold text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-700/60 ${isEven ? 'bg-slate-50 dark:bg-slate-800/40' : 'bg-slate-100 dark:bg-slate-800/60'}`} rowSpan={maxRows}>
                        <div>Semana {sem.semana_numero}</div>
                        <div className="font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                          {formatDateRange(sem.fecha_inicio, sem.fecha_fin)}
                        </div>
                      </td>
                    )}
                    <td className="px-1 py-1 align-top text-slate-600 dark:text-slate-300">
                      <Skel>{contenido || <span className="text-slate-300 dark:text-slate-600">—</span>}</Skel>
                    </td>
                    <td className="px-1 py-1 align-top text-slate-600 dark:text-slate-300">
                      <Skel>{actividad || <span className="text-slate-300 dark:text-slate-600">—</span>}</Skel>
                    </td>
                    {isFirst && (
                      <td className="px-2 py-2 align-middle text-center border-x border-slate-100 dark:border-slate-800/60 tabular-nums font-medium text-slate-700 dark:text-slate-300" rowSpan={maxRows}>
                        <Skel w="w-10 mx-auto">{sem.horas || 0}</Skel>
                      </td>
                    )}
                    {isFirst && (
                      <td className="px-2 py-2 align-top" rowSpan={maxRows} colSpan={data?.todas_firmadas ? 2 : 1}>
                        <div className="flex flex-col items-center gap-1">
                          <SignBadge firmado={sem.firmado} firmado_en={sem.firmado_en} />
                          {sem.firmado_en && (
                            <span className="text-[9px] text-slate-400 dark:text-slate-500">{formatFirmaFecha(sem.firmado_en)}</span>
                          )}
                        </div>
                      </td>
                    )}
                    {isFirst && !data?.todas_firmadas && (
                      <td className="px-1 py-2 align-top text-center" rowSpan={maxRows}>
                        <SignBtn id={sem.id} type="semana" firmado={sem.firmado} />
                      </td>
                    )}
                  </tr>
                );
              });
            })}

            {data.evaluaciones.map((evalData) => {
              const isParcial = evalData.tipo === 'parcial';
              return (
                <tr key={evalData.id ?? evalData.tipo} className={`border-t-2 border-slate-300 dark:border-slate-600 ${isParcial ? 'bg-amber-50/40 dark:bg-amber-950/20' : 'bg-rose-50/40 dark:bg-rose-950/20'}`}>
                  <td className={`px-3 py-2.5 align-top font-semibold text-sm uppercase tracking-wide ${isParcial ? 'text-amber-800 dark:text-amber-300 border-r border-amber-200 dark:border-amber-900/40' : 'text-rose-800 dark:text-rose-300 border-r border-rose-200 dark:border-rose-900/40'}`}>
                    Evaluación {evalData.tipo}
                  </td>
                  <td className="px-3 py-2 align-top" colSpan={2}>
                    {refreshing ? (
                      <div className="flex gap-4">
                        <div className="animate-pulse rounded bg-slate-200 dark:bg-slate-700 h-4 w-28" />
                        <div className="animate-pulse rounded bg-slate-200 dark:bg-slate-700 h-4 w-40" />
                      </div>
                    ) : (
                      <div className="flex gap-4">
                        <div>
                          <span className="text-xs text-slate-400">Fecha: </span>
                          <span className="font-medium text-slate-700 dark:text-slate-300">{fmtDateDisplay(evalData.fecha)}</span>
                        </div>
                        <div>
                          <span className="text-xs text-slate-400">Prueba: </span>
                          <span className="text-slate-700 dark:text-slate-300">{evalData.alcance_prueba || '—'}</span>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 align-top text-center border-x border-slate-100 dark:border-slate-800/60">
                    <span className="text-[10px] text-slate-400">—</span>
                  </td>
                  <td className="px-2 py-2 align-top" colSpan={data?.todas_firmadas ? 2 : 1}>
                    <div className="flex flex-col items-center gap-1">
                      <SignBadge firmado={evalData.firmado} firmado_en={evalData.firmado_en} />
                      {evalData.firmado_en && (
                        <span className="text-[9px] text-slate-400">{formatFirmaFecha(evalData.firmado_en)}</span>
                      )}
                    </div>
                  </td>
                  {!data?.todas_firmadas && (
                    <td className="px-1 py-2 align-top text-center">
                      <SignBtn id={evalData.id} type="evaluacion" firmado={evalData.firmado} />
                    </td>
                  )}
                </tr>

              );
            })}

            <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40">
              <td className="px-3 py-2.5 align-top font-semibold text-sm uppercase tracking-wide text-slate-700 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700" colSpan={4}>
                Total de horas
              </td>
              <td className="px-2 py-2.5 align-top text-center font-bold text-base tabular-nums text-primary">
                {refreshing ? <div className="animate-pulse rounded bg-slate-200 dark:bg-slate-700 h-5 w-8 mx-auto" /> : totalHoras}
              </td>
              {!data?.todas_firmadas && <td></td>}
            </tr>
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={showSignConfirm !== null}
        title="Firmar"
        description={`¿Confirmás la firma digital de esta ${showSignConfirm?.type === 'semana' ? 'semana' : 'evaluación'}? La acción quedará registrada en la auditoría del sistema.`}
        confirmLabel={signingId ? 'Firmando...' : 'Sí, firmar'}
        variant="default"
        loading={signingId !== null}
        onCancel={() => setShowSignConfirm(null)}
        onConfirm={() => void handleFirmar()}
      />

      <ConfirmDialog
        open={showSignAllConfirm}
        title="Firmar todo el cronograma"
        description="¿Confirmás la firma digital de todas las semanas y evaluaciones pendientes? Esta acción quedará registrada en la auditoría del sistema."
        confirmLabel={signingId === -1 ? 'Firmando...' : 'Sí, firmar todo'}
        variant="default"
        loading={signingId === -1}
        onCancel={() => setShowSignAllConfirm(false)}
        onConfirm={() => void handleFirmarTodo()}
      />
    </div>
  );
}

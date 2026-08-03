import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, isSessionExpiredError, generarYAbrirPdf } from '../utils/api';
import { toast } from '../utils/toast';

type SemanaCronograma = {
  id?: number;
  semana_numero: number;
  fecha_inicio: string;
  fecha_fin: string;
  contenidos: string[];
  actividades: string[];
  horas: number;
  firmado?: boolean;
  firmado_en?: string | null;
  firmado_por?: string | null;
};

type EvaluacionCronograma = {
  id?: number;
  tipo: 'parcial' | 'final';
  fecha: string | null;
  alcance_prueba: string | null;
  firmado?: boolean;
  firmado_en?: string | null;
  firmado_por?: string | null;
};

type CronogramaData = {
  semanas: SemanaCronograma[];
  evaluaciones: EvaluacionCronograma[];
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

function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function generateWeeks(fechaInicio: string, fechaFin: string): SemanaCronograma[] {
  const end = new Date(fechaFin + 'T00:00:00');
  const weeks: SemanaCronograma[] = [];
  let currentMonday = getMondayOfWeek(fechaInicio);
  let weekNum = 1;

  while (new Date(currentMonday) <= end) {
    const weekEnd = addDays(currentMonday, 4);
    const effectiveEnd = weekEnd > fechaFin ? fechaFin : weekEnd;
    if (new Date(currentMonday) > end) break;

    weeks.push({
      semana_numero: weekNum,
      fecha_inicio: currentMonday,
      fecha_fin: effectiveEnd,
      contenidos: [''],
      actividades: [''],
      horas: 0,
    });

    currentMonday = addDays(currentMonday, 7);
    weekNum++;
  }

  return weeks;
}

interface CronogramaCatedraProps {
  cursoId: number;
  fechaInicio: string;
  fechaFin: string;
}

export default function CronogramaCatedra({ cursoId, fechaInicio, fechaFin }: CronogramaCatedraProps) {
  const [semanas, setSemanas] = useState<SemanaCronograma[]>([]);
  const [evaluacionParcial, setEvaluacionParcial] = useState<EvaluacionCronograma>({ tipo: 'parcial', fecha: null, alcance_prueba: null });
  const [evaluacionFinal, setEvaluacionFinal] = useState<EvaluacionCronograma>({ tipo: 'final', fecha: null, alcance_prueba: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [readOnly, setReadOnly] = useState(false);

  const loadCronograma = useCallback(async () => {
    const data = await apiFetch<CronogramaData>(`/academico/cursos/${cursoId}/cronograma`);
    if (data.semanas.length > 0) {
      setSemanas(data.semanas);
      setReadOnly(true);
    } else {
      setSemanas(generateWeeks(fechaInicio, fechaFin));
      setDirty(true);
      setReadOnly(false);
    }
    const parcial = data.evaluaciones.find((e) => e.tipo === 'parcial');
    const final = data.evaluaciones.find((e) => e.tipo === 'final');
    if (parcial) setEvaluacionParcial(parcial);
    if (final) setEvaluacionFinal(final);
  }, [cursoId, fechaInicio, fechaFin]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        await loadCronograma();
      } catch (err) {
        if (isSessionExpiredError(err)) return;
        toast.error('No se pudo cargar el cronograma');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
  }, [loadCronograma]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadCronograma();
      setDirty(false);
      setReadOnly(true);
      toast.success('Cronograma actualizado');
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      toast.error('No se pudo actualizar el cronograma');
    } finally {
      setRefreshing(false);
    }
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const payload = {
        semanas: semanas.map((s) => ({
          semana_numero: s.semana_numero,
          fecha_inicio: s.fecha_inicio,
          fecha_fin: s.fecha_fin,
          contenidos: s.contenidos.filter((c) => c.trim() !== ''),
          actividades: s.actividades.filter((a) => a.trim() !== ''),
          horas: s.horas,
        })),
        evaluacion_parcial: {
          fecha: evaluacionParcial.fecha ?? null,
          alcance_prueba: evaluacionParcial.alcance_prueba ?? null,
        },
        evaluacion_final: {
          fecha: evaluacionFinal.fecha ?? null,
          alcance_prueba: evaluacionFinal.alcance_prueba ?? null,
        },
      };
      const result = await apiFetch<CronogramaData>(`/academico/cursos/${cursoId}/cronograma`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setSemanas(result.semanas);
      const p = result.evaluaciones.find((e) => e.tipo === 'parcial');
      const f = result.evaluaciones.find((e) => e.tipo === 'final');
      if (p) setEvaluacionParcial(p);
      if (f) setEvaluacionFinal(f);
      setDirty(false);
      setReadOnly(true);
      toast.success('Cronograma guardado');
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar el cronograma');
    } finally {
      setSaving(false);
    }
  }, [cursoId, semanas, evaluacionParcial, evaluacionFinal]);

  const totalHoras = useMemo(() => semanas.reduce((acc, s) => acc + (Number(s.horas) || 0), 0), [semanas]);

  const setSemanaHoras = (idx: number, val: number) => {
    setSemanas((prev) => prev.map((s, i) => (i === idx ? { ...s, horas: val } : s)));
    setDirty(true);
  };

  const addContenidoActividad = (idx: number, tipo: 'contenidos' | 'actividades') => {
    setSemanas((prev) => prev.map((s, i) => {
      if (i !== idx) return s;
      return { ...s, [tipo]: [...s[tipo], ''] };
    }));
    setDirty(true);
  };

  const updateContenidoActividad = (semIdx: number, rowIdx: number, tipo: 'contenidos' | 'actividades', val: string) => {
    setSemanas((prev) => prev.map((s, i) => {
      if (i !== semIdx) return s;
      const arr = [...s[tipo]];
      arr[rowIdx] = val;
      return { ...s, [tipo]: arr };
    }));
    setDirty(true);
  };

  const removeContenidoActividad = (semIdx: number, rowIdx: number, tipo: 'contenidos' | 'actividades') => {
    setSemanas((prev) => prev.map((s, i) => {
      if (i !== semIdx) return s;
      const arr = s[tipo].filter((_, j) => j !== rowIdx);
      return { ...s, [tipo]: arr.length === 0 ? [''] : arr };
    }));
    setDirty(true);
  };

  const handleEvalChange = (tipo: 'parcial' | 'final', field: 'fecha' | 'alcance_prueba', value: string) => {
    const updater = tipo === 'parcial' ? setEvaluacionParcial : setEvaluacionFinal;
    updater((prev) => ({ ...prev, [field]: value || null }));
    setDirty(true);
  };

  useEffect(() => {
    if (loading || refreshing) return;
    const timer = setTimeout(() => {
      document.querySelectorAll<HTMLTextAreaElement>('textarea[data-autosize]').forEach((el) => {
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [semanas, readOnly]);

  if (loading) {
    return (
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-[#132a52]">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-48" />
          <div className="h-32 bg-slate-100 dark:bg-slate-800 rounded" />
        </div>
      </div>
    );
  }

  const headerCell = 'px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 text-center';
  const inputBase = 'w-full rounded border bg-white px-2 py-1 text-sm text-black placeholder:text-slate-400 focus:border-primary focus:outline-none dark:bg-[#0b2147] dark:border-slate-700 dark:text-[#e7eef9] dark:placeholder:text-slate-500';

  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-[#132a52]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Cronograma de cátedra</p>
          <h3 className="text-lg font-semibold text-black dark:text-[#e7eef9]">
            {semanas.length} semana{semanas.length !== 1 ? 's' : ''}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {formatDateShort(fechaInicio)} — {formatDateShort(fechaFin)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {readOnly ? (
            <button
              type="button"
              className="btn-modern btn-modern-primary btn-modern-sm shrink-0"
              onClick={() => setReadOnly(false)}
            >
              <span className="material-symbols-outlined text-[16px]">edit</span>
              Editar
            </button>
          ) : (
            <>
              {dirty && (
                <span className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Sin guardar
                </span>
              )}
              <button
                type="button"
                className="btn-modern btn-modern-primary btn-modern-sm shrink-0"
                onClick={handleSave}
                disabled={saving || !dirty}
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </>
          )}
          <button
            type="button"
            className="btn-modern btn-modern-ghost btn-modern-sm shrink-0"
            onClick={handleRefresh}
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
            {downloading ? 'Generando...' : 'PDF'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[50rem] text-xs">
          <thead>
            <tr>
              <th className={`${headerCell} w-[20%]`}>Fecha</th>
              <th className={`${headerCell} w-[28%]`}>Contenidos</th>
              <th className={`${headerCell} w-[28%]`}>Actividades</th>
              <th className={`${headerCell} w-[8%]`}>Horas</th>
              <th className={`${headerCell} w-[16%]`}>Firma</th>
            </tr>
          </thead>
          <tbody>
            {semanas.map((sem, semIdx) => {
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
                  <tr key={`${sem.semana_numero}-${rowIdx}`} className={`${semanaBg} ${isLastRow ? 'border-b-2 border-slate-300 dark:border-slate-600' : ''}`}>
                    {isFirst && (
                      <td className={`px-2 py-2 align-top text-sm font-semibold text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-700/60 ${isEven ? 'bg-slate-50 dark:bg-slate-800/40' : 'bg-slate-100 dark:bg-slate-800/60'}`} rowSpan={maxRows}>
                        <div>Semana {sem.semana_numero}</div>
                        <div className="ca-normal text-slate-500 dark:text-slate-400 mt-0.5">
                          {formatDateRange(sem.fecha_inicio, sem.fecha_fin)}
                        </div>
                      </td>
                    )}
                    <td className="px-1 py-1 align-top">
                      <div className="flex items-start gap-0.5">
                        {refreshing ? (
                          <div className="animate-pulse rounded bg-slate-200 dark:bg-slate-700 h-5 w-full" />
                        ) : readOnly ? (
                          <span className="text-slate-700 dark:text-slate-300 text-sm whitespace-pre-wrap">{contenido || '—'}</span>
                        ) : (
                          <textarea
                            className={inputBase + ' resize-none overflow-hidden'}
                            data-autosize
                            value={contenido}
                            onChange={(e) => updateContenidoActividad(semIdx, rowIdx, 'contenidos', e.target.value)}
                            onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
                            placeholder="Tema..."
                            rows={1}
                          />
                        )}
                        {!refreshing && !readOnly && isLastRow && (
                          <>
                            <button type="button" className="mt-0.5 shrink-0 text-slate-400 hover:text-primary dark:hover:text-primary" onClick={() => addContenidoActividad(semIdx, 'contenidos')} title="Agregar contenido">
                              <span className="material-symbols-outlined text-[14px]">add</span>
                            </button>
                            {sem.contenidos.length > 1 && (
                              <button type="button" className="mt-0.5 shrink-0 text-slate-400 hover:text-red-500" onClick={() => removeContenidoActividad(semIdx, rowIdx, 'contenidos')} title="Quitar contenido">
                                <span className="material-symbols-outlined text-[14px]">remove</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-1 align-top">
                      <div className="flex items-start gap-0.5">
                        {refreshing ? (
                          <div className="animate-pulse rounded bg-slate-200 dark:bg-slate-700 h-5 w-full" />
                        ) : readOnly ? (
                          <span className="text-slate-700 dark:text-slate-300 text-sm whitespace-pre-wrap">{actividad || '—'}</span>
                        ) : (
                          <textarea
                            className={inputBase + ' resize-none overflow-hidden'}
                            data-autosize
                            value={actividad}
                            onChange={(e) => updateContenidoActividad(semIdx, rowIdx, 'actividades', e.target.value)}
                            onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
                            placeholder="Actividad..."
                            rows={1}
                          />
                        )}
                        {!refreshing && !readOnly && isLastRow && (
                          <>
                            <button type="button" className="mt-0.5 shrink-0 text-slate-400 hover:text-primary dark:hover:text-primary" onClick={() => addContenidoActividad(semIdx, 'actividades')} title="Agregar actividad">
                              <span className="material-symbols-outlined text-[14px]">add</span>
                            </button>
                            {sem.actividades.length > 1 && (
                              <button type="button" className="mt-0.5 shrink-0 text-slate-400 hover:text-red-500" onClick={() => removeContenidoActividad(semIdx, rowIdx, 'actividades')} title="Quitar actividad">
                                <span className="material-symbols-outlined text-[14px]">remove</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    {isFirst && (
                      <td className="px-2 py-2 align-top text-center border-x border-slate-100 dark:border-slate-800/60" rowSpan={maxRows}>
                        {refreshing ? (
                          <div className="animate-pulse rounded bg-slate-200 dark:bg-slate-700 h-5 w-10 mx-auto" />
                        ) : readOnly ? (
                          <span className="tabular-nums font-medium text-slate-700 dark:text-slate-300">{sem.horas || 0}</span>
                        ) : (
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            className={`${inputBase} text-center w-16 mx-auto`}
                            value={sem.horas || ''}
                            onChange={(e) => setSemanaHoras(semIdx, Number(e.target.value) || 0)}
                          />
                        )}
                      </td>
                    )}
                    {isFirst && (
                      <td className="px-2 py-2 align-top text-center" rowSpan={maxRows}>
                        {sem.firmado ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            <span className="material-symbols-outlined text-[12px]">check_circle</span>
                            {sem.firmado_por || 'Firmado'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            <span className="material-symbols-outlined text-[12px]">pending</span>
                            Pendiente
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              });
            })}

            {/* Evaluación Parcial */}
            <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-amber-50/40 dark:bg-amber-950/20">
              <td className="px-3 py-2.5 align-top font-semibold text-sm uppercase tracking-wide text-amber-800 dark:text-amber-300 border-r border-amber-200 dark:border-amber-900/40">
                Evaluación parcial
              </td>
              <td className="px-3 py-2 align-top" colSpan={2}>
                {refreshing ? (
                  <div className="space-y-2">
                    <div className="animate-pulse rounded bg-slate-200 dark:bg-slate-700 h-5 w-32" />
                    <div className="animate-pulse rounded bg-slate-200 dark:bg-slate-700 h-5 w-48" />
                  </div>
                ) : readOnly ? (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-xs text-slate-400">Fecha: </span><span className="text-slate-700 dark:text-slate-300">{evaluacionParcial.fecha ? formatDateShort(evaluacionParcial.fecha) : '—'}</span></div>
                    <div><span className="text-xs text-slate-400">Prueba: </span><span className="text-slate-700 dark:text-slate-300">{evaluacionParcial.alcance_prueba || '—'}</span></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Fecha</span>
                      <input type="date" className={inputBase} value={toDateInputValue(evaluacionParcial.fecha)} min={fechaInicio} max={fechaFin} onChange={(e) => handleEvalChange('parcial', 'fecha', e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Prueba (alcance)</span>
                      <input type="text" className={inputBase} value={evaluacionParcial.alcance_prueba ?? ''} onChange={(e) => handleEvalChange('parcial', 'alcance_prueba', e.target.value)} placeholder="Ej: Unidad I a la Unidad IV" />
                    </label>
                  </div>
                )}
              </td>
              <td className="px-2 py-2 align-top text-center border-x border-amber-200/60 dark:border-amber-900/40">
                <span className="text-[10px] text-slate-400 dark:text-slate-500">—</span>
              </td>
              <td className="px-2 py-2 align-top text-center">
                {refreshing ? (
                  <div className="animate-pulse rounded-full bg-slate-200 dark:bg-slate-700 h-4 w-16 mx-auto" />
                ) : evaluacionParcial.firmado ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    <span className="material-symbols-outlined text-[12px]">check_circle</span>
                    {evaluacionParcial.firmado_por || 'Firmado'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    <span className="material-symbols-outlined text-[12px]">pending</span>
                    Pendiente
                  </span>
                )}
              </td>
            </tr>

            {/* Evaluación Final */}
            <tr className="border-t border-amber-200 dark:border-amber-900/40 bg-rose-50/40 dark:bg-rose-950/20">
              <td className="px-3 py-2.5 align-top font-semibold text-sm uppercase tracking-wide text-rose-800 dark:text-rose-300 border-r border-rose-200 dark:border-rose-900/40">
                Evaluación final
              </td>
              <td className="px-3 py-2 align-top" colSpan={2}>
                {refreshing ? (
                  <div className="space-y-2">
                    <div className="animate-pulse rounded bg-slate-200 dark:bg-slate-700 h-5 w-32" />
                    <div className="animate-pulse rounded bg-slate-200 dark:bg-slate-700 h-5 w-48" />
                  </div>
                ) : readOnly ? (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-xs text-slate-400">Fecha: </span><span className="text-slate-700 dark:text-slate-300">{evaluacionFinal.fecha ? formatDateShort(evaluacionFinal.fecha) : '—'}</span></div>
                    <div><span className="text-xs text-slate-400">Prueba: </span><span className="text-slate-700 dark:text-slate-300">{evaluacionFinal.alcance_prueba || '—'}</span></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Fecha</span>
                      <input type="date" className={inputBase} value={toDateInputValue(evaluacionFinal.fecha)} min={fechaInicio} max={fechaFin} onChange={(e) => handleEvalChange('final', 'fecha', e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Prueba (alcance)</span>
                      <input type="text" className={inputBase} value={evaluacionFinal.alcance_prueba ?? ''} onChange={(e) => handleEvalChange('final', 'alcance_prueba', e.target.value)} placeholder="Ej: Unidad I a la Unidad VIII" />
                    </label>
                  </div>
                )}
              </td>
              <td className="px-2 py-2 align-top text-center border-x border-rose-200/60 dark:border-rose-900/40">
                <span className="text-[10px] text-slate-400 dark:text-slate-500">—</span>
              </td>
              <td className="px-2 py-2 align-top text-center">
                {refreshing ? (
                  <div className="animate-pulse rounded-full bg-slate-200 dark:bg-slate-700 h-4 w-16 mx-auto" />
                ) : evaluacionFinal.firmado ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    <span className="material-symbols-outlined text-[12px]">check_circle</span>
                    {evaluacionFinal.firmado_por || 'Firmado'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                    <span className="material-symbols-outlined text-[12px]">pending</span>
                    Pendiente
                  </span>
                )}
              </td>
            </tr>

            {/* Total de Horas */}
            <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40">
              <td className="px-3 py-2.5 align-top font-semibold text-sm uppercase tracking-wide text-slate-700 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700" colSpan={4}>
                Total de horas
              </td>
              <td className="px-2 py-2.5 align-top text-center font-bold text-base tabular-nums text-primary">
                {refreshing ? <div className="animate-pulse rounded bg-slate-200 dark:bg-slate-700 h-5 w-8 mx-auto" /> : totalHoras}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-200 px-4 py-2 dark:border-slate-800">
        <p className="text-[10px] text-slate-400 dark:text-slate-500">
          Completá los campos y usá el botón "Guardar" para persistir los cambios.
        </p>
      </div>
    </div>
  );
}

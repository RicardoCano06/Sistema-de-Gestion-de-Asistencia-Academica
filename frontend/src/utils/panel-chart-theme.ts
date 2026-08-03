import type { CSSProperties } from 'react';

export interface PanelChartTheme {
  card: string;
  kicker: string;
  title: string;
  hint: string;
  muted: string;
  grid: string;
  axisTick: string;
  axisTickCategory: string;
  legend: string;
  funnelLabel: string;
  scatterDot: string;
  scatterCursor: string;
  areaStroke: string;
  areaFill: string;
  barAlertas: string;
  barInhabilitados: string;
  axisAlertas: string;
  tooltip: CSSProperties;
  tooltipTitle: string;
  tooltipBody: string;
  tooltipMuted: string;
}

export function getPanelChartTheme(isDark: boolean): PanelChartTheme {
  if (isDark) {
    return {
      card: 'min-w-0 w-full overflow-hidden rounded-xl border border-slate-800 bg-[#132a52] p-5',
      kicker: 'text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold',
      title: 'text-base font-bold text-white mt-0.5 mb-1',
      hint: 'text-xs text-slate-400 mb-3',
      muted: 'text-slate-500',
      grid: 'rgba(255,255,255,0.08)',
      axisTick: '#94a3b8',
      axisTickCategory: '#94a3b8',
      legend: 'text-xs text-slate-400',
      funnelLabel: '#e2e8f0',
      scatterDot: '#38bdf8',
      scatterCursor: 'rgba(148, 163, 184, 0.45)',
      areaStroke: '#22c55e',
      areaFill: '#22c55e',
      barAlertas: '#f97316',
      barInhabilitados: '#f43f5e',
      axisAlertas: '#fb923c',
      tooltip: {
        backgroundColor: '#0f1d32',
        border: '1px solid rgba(71, 85, 105, 0.65)',
        borderRadius: '10px',
        padding: '10px 12px',
        boxShadow: '0 10px 28px rgba(0, 0, 0, 0.35)',
        color: '#e7eef9',
      },
      tooltipTitle: 'font-semibold text-white',
      tooltipBody: 'text-[#e7eef9]',
      tooltipMuted: 'text-slate-300',
    };
  }

  return {
    card: 'min-w-0 w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm',
    kicker: 'text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold',
    title: 'text-base font-bold text-slate-900 mt-0.5 mb-1',
    hint: 'text-xs text-slate-600 mb-3',
    muted: 'text-slate-500',
    grid: 'rgba(15, 23, 42, 0.08)',
    axisTick: '#64748b',
    axisTickCategory: '#475569',
    legend: 'text-xs text-slate-600',
    funnelLabel: '#334155',
    scatterDot: '#0284c7',
    scatterCursor: 'rgba(100, 116, 139, 0.35)',
    areaStroke: '#16a34a',
    areaFill: '#22c55e',
    barAlertas: '#ea580c',
    barInhabilitados: '#e11d48',
    axisAlertas: '#c2410c',
    tooltip: {
      backgroundColor: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '10px',
      padding: '10px 12px',
      boxShadow: '0 4px 16px rgba(15, 23, 42, 0.12)',
      color: '#0f172a',
    },
    tooltipTitle: 'font-semibold text-slate-900',
    tooltipBody: 'text-slate-800',
    tooltipMuted: 'text-slate-600',
  };
}

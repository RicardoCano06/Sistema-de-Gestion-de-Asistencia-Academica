import { memo, useEffect, useState, type ReactNode, type WheelEvent } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type {
  AsistenciaAlertasMesRow,
  CarreraInhabilitadosRow,
  FunnelRetencionRow,
  ScatterAsistenciaRiesgoRow,
} from '../../utils/panel-chart-data';
import { getPanelChartTheme, type PanelChartTheme } from '../../utils/panel-chart-theme';

/** lg = 1024px — alineado con `max-lg:` del resto de la app. */
function usePanelChartMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

/** Recharts captura la rueda del mouse; reenvía el scroll vertical al contenedor de la página. */
function forwardPanelChartWheel(event: WheelEvent<HTMLDivElement>) {
  if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;

  const wrap = event.currentTarget;
  const canScrollUp = wrap.scrollTop > 0;
  const canScrollDown = wrap.scrollTop + wrap.clientHeight < wrap.scrollHeight - 1;
  if ((event.deltaY > 0 && canScrollDown) || (event.deltaY < 0 && canScrollUp)) {
    return;
  }

  const scrollParent = wrap.closest('.app-scroll-content') as HTMLElement | null;
  if (!scrollParent) return;

  scrollParent.scrollTop += event.deltaY;
  event.preventDefault();
}

type PanelChartShellProps = {
  theme: PanelChartTheme;
  title: string;
  subtitle: string;
  hint?: string;
  statsLoading: boolean;
  empty: boolean;
  emptyMessage: string;
  height?: number;
  /** Altura del gráfico en móvil/tablet (opcional). */
  mobileHeight?: number;
  /** Ancho mínimo del canvas en móvil para scroll horizontal sin comprimir etiquetas. */
  mobileChartMinWidth?: number;
  /** Vista alternativa en móvil/tablet (reemplaza el canvas Recharts). */
  mobileAlternate?: ReactNode;
  children: ReactNode;
};

function PanelChartShell({
  theme,
  title,
  subtitle,
  hint,
  statsLoading,
  empty,
  emptyMessage,
  height = 260,
  mobileHeight,
  mobileChartMinWidth,
  mobileAlternate,
  children,
}: PanelChartShellProps) {
  const isMobile = usePanelChartMobile();
  const chartHeight = isMobile && mobileHeight != null ? mobileHeight : height;
  const useMobileAlternate = isMobile && mobileAlternate != null;

  return (
    <div className={theme.card}>
      <p className={theme.kicker}>{title}</p>
      <h2 className={theme.title}>{subtitle}</h2>
      {hint ? <p className={`${theme.hint} max-lg:text-[11px] max-lg:leading-snug`}>{hint}</p> : <div className="mb-3" />}
      {statsLoading ? (
        <div className={`flex items-center justify-center text-sm ${theme.muted}`} style={{ height: chartHeight }}>
          Cargando...
        </div>
      ) : empty ? (
        <div
          className={`flex flex-col items-center justify-center gap-2 ${theme.muted}`}
          style={{ height: chartHeight }}
        >
          <span className="material-symbols-outlined text-[36px] opacity-40">insights</span>
          <p className="text-sm">{emptyMessage}</p>
        </div>
      ) : useMobileAlternate ? (
        <div
          className="scroll-region-at-lg min-w-0 w-full lg:max-h-[min(70dvh,520px)]"
          style={{ minHeight: chartHeight }}
        >
          {mobileAlternate}
        </div>
      ) : (
        <div
          className={`panel-chart-canvas-wrap min-w-0 w-full${
            isMobile && mobileChartMinWidth ? ' panel-chart-canvas-wrap--h-scroll' : ''
          }`}
          style={{ height: chartHeight }}
          onWheelCapture={forwardPanelChartWheel}
        >
          <div
            className="h-full w-full"
            style={
              isMobile && mobileChartMinWidth
                ? { minWidth: mobileChartMinWidth, width: '100%' }
                : undefined
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function ChartTooltipBox({
  theme,
  title,
  children,
}: {
  theme: PanelChartTheme;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className="max-w-[min(92vw,280px)] rounded-lg px-3 py-2 text-xs break-words"
      style={theme.tooltip}
    >
      <p className={`${theme.tooltipTitle} break-words leading-snug`}>{title}</p>
      <div className={`space-y-0.5 mt-1 ${theme.tooltipBody}`}>{children}</div>
    </div>
  );
}

export const PanelFunnelRetencionChart = memo(function PanelFunnelRetencionChart({
  statsLoading,
  data,
  chartKey,
  totalAlumnos,
  isDark,
}: {
  statsLoading: boolean;
  data: FunnelRetencionRow[];
  chartKey: string;
  totalAlumnos: number;
  isDark: boolean;
}) {
  const theme = getPanelChartTheme(isDark);

  return (
    <PanelChartShell
      theme={theme}
      title="Retención académica"
      subtitle="Embudo de matrícula a inhabilitación"
      hint={`${totalAlumnos} matrículas en el período más reciente por curso. La caída indica cuántos alumnos pasan a cada estado más restrictivo.`}
      statsLoading={statsLoading}
      empty={!data.length}
      emptyMessage="Sin matrículas para el embudo"
      height={280}
    >
      <FunnelChart key={chartKey}>
        <ReTooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as FunnelRetencionRow;
            return (
              <ChartTooltipBox theme={theme} title={row.name}>
                <p>
                  Alumnos: <strong>{row.value}</strong>
                </p>
                {row.dropOffAbs > 0 ? (
                  <p className={theme.tooltipMuted}>
                    Caída desde etapa anterior:{' '}
                    <strong>
                      {row.dropOffAbs} ({row.dropOffPct}%)
                    </strong>
                  </p>
                ) : null}
              </ChartTooltipBox>
            );
          }}
        />
        <Funnel dataKey="value" data={data} isAnimationActive animationDuration={1200}>
          <LabelList position="right" fill={theme.funnelLabel} stroke="none" fontSize={11} dataKey="name" />
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.fill} />
          ))}
        </Funnel>
      </FunnelChart>
    </PanelChartShell>
  );
});

export const PanelScatterAsistenciaRiesgoChart = memo(function PanelScatterAsistenciaRiesgoChart({
  statsLoading,
  data,
  chartKey,
  isDark,
}: {
  statsLoading: boolean;
  data: ScatterAsistenciaRiesgoRow[];
  chartKey: string;
  isDark: boolean;
}) {
  const theme = getPanelChartTheme(isDark);

  return (
    <PanelChartShell
      theme={theme}
      title="Mapa de riesgo"
      subtitle="Asistencia vs % en riesgo por materia"
      hint="Cada punto es una materia (último mes). Esquina inferior derecha = alta asistencia y bajo riesgo."
      statsLoading={statsLoading}
      empty={!data.length}
      emptyMessage="Sin materias para graficar"
      height={280}
    >
      <ScatterChart key={chartKey} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
        <XAxis
          type="number"
          dataKey="asistencia"
          name="Asistencia"
          unit="%"
          domain={[0, 100]}
          tick={{ fill: theme.axisTick, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="number"
          dataKey="pctRiesgo"
          name="% en riesgo"
          unit="%"
          domain={[0, 100]}
          tick={{ fill: theme.axisTick, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <ZAxis type="number" dataKey="matriculas" range={[48, 220]} />
        <ReTooltip
          cursor={{ stroke: theme.scatterCursor, strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as ScatterAsistenciaRiesgoRow;
            return (
              <ChartTooltipBox theme={theme} title={row.materia}>
                <p>Asistencia: {row.asistencia}%</p>
                <p>En riesgo: {row.pctRiesgo}%</p>
                <p>Matrículas: {row.matriculas}</p>
              </ChartTooltipBox>
            );
          }}
        />
        <Scatter
          name="Materias"
          data={data}
          fill={theme.scatterDot}
          fillOpacity={isDark ? 0.85 : 0.72}
          stroke={isDark ? '#0ea5e9' : '#0369a1'}
          strokeWidth={1}
        />
      </ScatterChart>
    </PanelChartShell>
  );
});

function CarreraInhabilitadosMobileList({
  data,
  theme,
}: {
  data: CarreraInhabilitadosRow[];
  theme: PanelChartTheme;
}) {
  const maxPct = Math.max(100, ...data.map((row) => row.pctInhabilitados), 1);

  return (
    <ul className="flex flex-col gap-4 px-0.5 py-2">
      {data.map((row) => {
        const barPct = maxPct > 0 ? (row.pctInhabilitados / maxPct) * 100 : 0;
        return (
          <li key={row.carreraId} className="min-w-0">
            <div className="mb-1.5 flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 break-words text-sm font-medium leading-snug text-slate-800 dark:text-slate-100">
                {row.carrera}
              </p>
              <span
                className="shrink-0 text-sm font-semibold tabular-nums"
                style={{ color: theme.barInhabilitados }}
              >
                {row.pctInhabilitados}%
              </span>
            </div>
            <div
              className="h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800/70"
              role="presentation"
            >
              <div
                className="h-full min-w-0 rounded-full transition-[width] duration-500"
                style={{
                  width: `${barPct}%`,
                  backgroundColor: theme.barInhabilitados,
                }}
              />
            </div>
            <p className={`mt-1 text-[11px] ${theme.muted}`}>
              Asist. prom. {row.pctAsistencia}% · {row.matriculas} matrículas
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export const PanelCarreraInhabilitadosChart = memo(function PanelCarreraInhabilitadosChart({
  statsLoading,
  data,
  chartKey,
  isDark,
}: {
  statsLoading: boolean;
  data: CarreraInhabilitadosRow[];
  chartKey: string;
  isDark: boolean;
}) {
  const theme = getPanelChartTheme(isDark);
  const isMobile = usePanelChartMobile();
  const chartHeight = Math.max(220, data.length * 44);
  const mobileHeight = Math.max(280, data.length * 76);

  return (
    <PanelChartShell
      theme={theme}
      title="Comparativo por carrera"
      subtitle="Distribución de inhabilitados"
      hint="Solo coordinadores / vista facultad o institucional. Eje X: % de matrículas en estado irregular (último mes por curso)."
      statsLoading={statsLoading}
      empty={!data.length}
      emptyMessage="Sin carreras con datos en el alcance"
      height={chartHeight}
      mobileHeight={mobileHeight}
      mobileAlternate={<CarreraInhabilitadosMobileList data={data} theme={theme} />}
    >
      <BarChart
        key={chartKey}
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 24, left: 8, bottom: 4 }}
        barCategoryGap="10%"
      >
        <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
        <XAxis
          type="number"
          unit="%"
          domain={[0, 'auto']}
          tick={{ fill: theme.axisTick, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="carrera"
          width={180}
          tick={{ fill: theme.axisTickCategory, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => (String(v).length > 28 ? `${String(v).slice(0, 26)}…` : String(v))}
        />
        <ReTooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as CarreraInhabilitadosRow;
            return (
              <ChartTooltipBox theme={theme} title={row.carrera}>
                <p>Inhabilitados: {row.pctInhabilitados}%</p>
                <p>Asistencia prom.: {row.pctAsistencia}%</p>
                <p>Matrículas: {row.matriculas}</p>
              </ChartTooltipBox>
            );
          }}
        />
        <Bar
          dataKey="pctInhabilitados"
          name="% inhabilitados"
          fill={theme.barInhabilitados}
          radius={[0, 6, 6, 0]}
          isAnimationActive={!isMobile}
          animationDuration={1400}
        />
      </BarChart>
    </PanelChartShell>
  );
});

export const PanelAsistenciaAlertasChart = memo(function PanelAsistenciaAlertasChart({
  statsLoading,
  data,
  chartKey,
  isDark,
}: {
  statsLoading: boolean;
  data: AsistenciaAlertasMesRow[];
  chartKey: string;
  isDark: boolean;
}) {
  const theme = getPanelChartTheme(isDark);
  const isMobile = usePanelChartMobile();
  const barSize = isMobile
    ? Math.min(44, Math.max(22, Math.floor(240 / Math.max(data.length, 1))))
    : 18;
  const chartHeight = isMobile ? 380 : 300;
  const chartMinWidth = isMobile ? Math.max(340, data.length * 72) : undefined;

  return (
    <PanelChartShell
      theme={theme}
      title="Asistencia y alertas"
      subtitle="Evolución mensual superpuesta"
      hint="Área verde: % asistencia ponderado. Barras: cantidad de alertas generadas ese mes."
      statsLoading={statsLoading}
      empty={!data.length}
      emptyMessage="Sin historial mensual para comparar"
      height={chartHeight}
      mobileHeight={chartHeight}
      mobileChartMinWidth={chartMinWidth}
    >
      <ComposedChart
        key={chartKey}
        data={data}
        margin={
          isMobile
            ? { top: 12, right: 44, left: 6, bottom: 56 }
            : { top: 8, right: 48, left: 0, bottom: 4 }
        }
        barCategoryGap={isMobile ? '20%' : undefined}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
        <XAxis
          dataKey="periodo"
          tick={{ fill: theme.axisTick, fontSize: isMobile ? 10 : 11 }}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={isMobile ? -32 : 0}
          textAnchor={isMobile ? 'end' : 'middle'}
          height={isMobile ? 52 : 30}
        />
        <YAxis
          yAxisId="left"
          width={isMobile ? 36 : 60}
          tick={{ fill: theme.axisTick, fontSize: isMobile ? 10 : 11 }}
          unit="%"
          domain={[0, 100]}
          ticks={isMobile ? [0, 50, 100] : undefined}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          width={isMobile ? 32 : 60}
          tick={{ fill: theme.axisAlertas, fontSize: isMobile ? 10 : 11 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          tickCount={isMobile ? 4 : 5}
        />
        <ReTooltip
          contentStyle={theme.tooltip}
          labelStyle={{ color: theme.tooltip.color, fontWeight: 600 }}
          itemStyle={{ color: theme.tooltip.color }}
          formatter={(value, name) => {
            if (name === 'Asistencia %') return [`${value}%`, name];
            if (name === 'Alertas') return [String(value ?? 0), name];
            return [String(value ?? 0), String(name)];
          }}
        />
        <Legend
          formatter={(v) => <span className={theme.legend}>{v}</span>}
          verticalAlign="bottom"
          wrapperStyle={isMobile ? { paddingTop: 12, fontSize: 11 } : undefined}
        />
        <Area
          yAxisId="left"
          type="monotone"
          dataKey="asistencia"
          name="Asistencia %"
          stroke={theme.areaStroke}
          fill={theme.areaFill}
          fillOpacity={isDark ? 0.28 : 0.2}
          strokeWidth={isMobile ? 2.5 : 2}
          isAnimationActive
          animationDuration={1600}
        />
        <Bar
          yAxisId="right"
          dataKey="alertas"
          name="Alertas"
          fill={theme.barAlertas}
          barSize={barSize}
          radius={[4, 4, 0, 0]}
          fillOpacity={isDark ? 0.9 : 0.85}
          isAnimationActive
          animationDuration={1600}
        />
      </ComposedChart>
    </PanelChartShell>
  );
});

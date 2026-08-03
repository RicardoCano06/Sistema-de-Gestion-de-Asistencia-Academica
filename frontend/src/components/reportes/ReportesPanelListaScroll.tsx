import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const SCROLL_STEP = 56;
const ARROW_SIZE = 12;

type ScrollMetrics = {
  top: number;
  height: number;
  conBarra: boolean;
};

type ReportesPanelListaScrollProps = {
  children: ReactNode;
  /** true = mensaje vacío: sin caja fija ni barra; el dedo scrollea la página. */
  vacio?: boolean;
  /** Barra lateral custom hasta xl (móvil + tablet horizontal); en xl+ el panel usa scroll del layout PC. */
  barraCustomHastaXl?: boolean;
};

export function ReportesPanelListaScroll({
  children,
  vacio = false,
  barraCustomHastaXl = false,
}: ReportesPanelListaScrollProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics>({ top: 0, height: 40, conBarra: false });

  const syncThumb = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (vacio) {
      setMetrics({ top: 0, height: 0, conBarra: false });
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = el;
    const trackHeight = Math.max(0, clientHeight - ARROW_SIZE * 2);
    const hayOverflow = scrollHeight > clientHeight + 2 && trackHeight > 0;

    if (!hayOverflow) {
      setMetrics({ top: 0, height: trackHeight, conBarra: false });
      return;
    }

    const ratio = clientHeight / scrollHeight;
    const height = Math.max(28, Math.round(trackHeight * ratio));
    const maxTop = trackHeight - height;
    const top = maxTop <= 0 ? 0 : Math.round((scrollTop / (scrollHeight - clientHeight)) * maxTop);

    setMetrics({ top, height, conBarra: true });
  }, [vacio]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const medir = () => {
      syncThumb();
      requestAnimationFrame(syncThumb);
    };

    medir();
    const t1 = window.setTimeout(medir, 50);
    const t2 = window.setTimeout(medir, 200);
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    for (const child of el.children) {
      ro.observe(child);
    }
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      ro.disconnect();
    };
  }, [children, syncThumb, vacio]);

  const scrollBy = (delta: number) => {
    scrollRef.current?.scrollBy({ top: delta, behavior: 'smooth' });
  };

  return (
    <div
      className={`reportes-lista-scroll-outer min-h-0${metrics.conBarra ? ' reportes-lista-scroll-outer--con-barra' : ''}`}
    >
      <div
        ref={scrollRef}
        className={`reportes-panel-lista-scroll min-h-0${
          barraCustomHastaXl ? ' reportes-panel-lista-scroll--barra-custom' : ''
        } ${
          vacio
            ? `reportes-panel-lista-scroll--sin-overflow ${barraCustomHastaXl ? 'max-xl:pointer-events-none' : 'max-lg:pointer-events-none'}`
            : 'reportes-panel-lista-scroll--con-lista'
        }`}
        onScroll={syncThumb}
      >
        {children}
      </div>
      {metrics.conBarra ? (
        <div className="reportes-lista-scrollbar-rail" aria-hidden="true">
          <button
            type="button"
            className="reportes-lista-scrollbar-arrow reportes-lista-scrollbar-arrow--up"
            tabIndex={-1}
            onClick={() => scrollBy(-SCROLL_STEP)}
          >
            <span className="material-symbols-outlined text-[12px] leading-none">keyboard_arrow_up</span>
          </button>
          <div className="reportes-lista-scrollbar-track">
            <div
              className="reportes-lista-scrollbar-thumb"
              style={{ height: metrics.height, transform: `translateY(${metrics.top}px)` }}
            />
          </div>
          <button
            type="button"
            className="reportes-lista-scrollbar-arrow reportes-lista-scrollbar-arrow--down"
            tabIndex={-1}
            onClick={() => scrollBy(SCROLL_STEP)}
          >
            <span className="material-symbols-outlined text-[12px] leading-none">keyboard_arrow_down</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

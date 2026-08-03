import { useEffect } from 'react';

const CSS_VAR = '--vv-bottom-inset';
/** Barra de navegación del SO: tope razonable (evita huecos enormes por lecturas erróneas). */
const MAX_NAV_INSET_PX = 56;

function readVisualViewportBottomInset(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  return Math.min(inset, MAX_NAV_INSET_PX);
}

function applyVisualViewportBottomInset(): void {
  const inset = readVisualViewportBottomInset();
  if (inset > 0) {
    document.documentElement.style.setProperty(CSS_VAR, `${inset}px`);
  } else {
    document.documentElement.style.removeProperty(CSS_VAR);
  }
}

/**
 * Expone en :root el espacio tapado abajo (solo visualViewport, acotado).
 * El CSS de paginación añade un mínimo táctil aparte; no inflar el scroll global.
 */
export function useVisualViewportBottomInset(): void {
  useEffect(() => {
    const update = () => applyVisualViewportBottomInset();

    update();
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      document.documentElement.style.removeProperty(CSS_VAR);
    };
  }, []);
}

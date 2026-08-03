// ── Guardián de carga de chunks (cold start / archivos stale) ──
// Debe estar ANTES de cualquier import de React o de la app.
// Si el navegador intenta cargar un chunk viejo tras reactivar la pestaña,
// forzamos recarga limpia sin caché.
window.addEventListener('error', (e) => {
  const mutationErrors = ['Loading chunk', 'CSS chunk', 'Dynamic import'];
  const isChunkError = mutationErrors.some((msg) => (e as ErrorEvent).message?.includes(msg));

  if (isChunkError) {
    console.warn('[cold-start] Fallo de archivos por reactivación. Forzando recarga dura...');
    window.location.reload();
  }
}, true);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import './index.css';
import App from './App.tsx';

// ── Recuperación de sesión suspendida (bfcache / cold start) ──

// bfcache: el navegador restaura una snapshot congelada. Forzamos reload limpio.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    window.location.reload();
  }
});

// Guardián de reactivación: cuando el usuario vuelve a la pestaña,
// verificamos consistencia del estado de autenticación.
// Si el navegador limpió la memoria y perdimos al usuario, rebotamos al login.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    try {
      const user = localStorage.getItem('currentUser');
      if (!user && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    } catch {
      try { localStorage.clear(); } catch { /* ignorar */ }
      window.location.reload();
    }
  }
});

// ── Renderizado ──

const rootEl = document.getElementById('root');
if (!rootEl) {
  document.body.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:100svh;background:#0d1f3c;color:#e7eef9;font-family:sans-serif;font-size:18px">No se pudo iniciar la aplicación. Recargá la página.</div>';
  throw new Error('No se encontró el elemento #root');
}

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{
          style: {
            fontFamily: 'Lexend, sans-serif',
            fontSize: '14px',
          },
        }}
      />
    </BrowserRouter>
  </StrictMode>
);

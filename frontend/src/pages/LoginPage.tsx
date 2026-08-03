import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import type { SessionUser } from '../utils/rbac';
import { API_BASE_URL, resetSessionExpiredState } from '../utils/api';

interface LoginPageProps {
  onLoginSuccess?: (usuario?: SessionUser | null) => void;
  onOpenLegalPage?: (page: 'terminos' | 'privacidad' | 'soporte') => void;
}

interface LoginResponse {
  token: string;
  refreshToken: string;
  usuario?: SessionUser;
}

const LOGIN_LOGO_URL = '/ung-logo.png';

export function LoginPage({ onLoginSuccess, onOpenLegalPage }: LoginPageProps) {
  const [rememberMe, setRememberMe] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const [exitingData, setExitingData] = useState<LoginResponse['usuario'] | null>(null);
  const currentYear = new Date().getFullYear();

  // Failsafe: si prefers-reduced-motion elimina la transición CSS,
  // onTransitionEnd nunca se dispara. Este timer rescata al usuario.
  useEffect(() => {
    if (!isExiting) return;
    const data = exitingData;
    const cb = onLoginSuccess;
    const timer = setTimeout(() => cb?.(data), 400);
    return () => clearTimeout(timer);
  }, [isExiting]);

  useEffect(() => {
    const storedIdentifier = localStorage.getItem('rememberedIdentifier');
    if (storedIdentifier) {
      setIdentifier(storedIdentifier);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identificador: identifier, password }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.mensaje ?? 'Credenciales inválidas');
        }
        return (await response.json()) as LoginResponse;
      })
      .then((data) => {
        resetSessionExpiredState();
        localStorage.setItem('accessToken', data.token);
        localStorage.setItem('token', data.token);
        localStorage.setItem('refreshToken', data.refreshToken);
        if (data.usuario) {
          localStorage.setItem('currentUser', JSON.stringify(data.usuario));
        } else {
          localStorage.removeItem('currentUser');
        }
        if (rememberMe) {
          localStorage.setItem('rememberedIdentifier', identifier);
        } else {
          localStorage.removeItem('rememberedIdentifier');
        }
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        setExitingData(data.usuario ?? null);
        setIsExiting(true);
      })
      .catch((err: unknown) => {
        const mensaje = err instanceof Error ? err.message : 'No se pudo iniciar sesión';
        setError(mensaje);
      })
      .finally(() => setLoading(false));
  };

  return (
    <div
      className={`login-shell-bg w-full max-w-full transition-opacity duration-300 ${isExiting ? 'opacity-0 pointer-events-none' : ''}`}
      onTransitionEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.propertyName !== 'opacity') return;
        if (isExiting) onLoginSuccess?.(exitingData);
      }}
    >
      <div className="flex min-h-[100dvh] w-full min-w-0 flex-col items-center justify-center px-4 py-6 max-md:justify-center max-md:px-4 max-md:py-8 max-md:pb-[max(2rem,env(safe-area-inset-bottom))] max-md:pt-[max(2rem,env(safe-area-inset-top))] sm:px-6 sm:py-8 md:px-8">
        <main className="w-full min-w-0 max-w-xl overflow-hidden rounded-2xl bg-slate-100 shadow-2xl max-lg:max-w-md">
          <div className="px-4 pb-10 pt-8 max-lg:px-5 max-lg:pb-6 max-lg:pt-6 sm:px-8 sm:pb-12 sm:pt-12 lg:px-10">
            <div className="pb-6 text-center max-lg:pb-4 sm:pb-7">
              <img
                src={LOGIN_LOGO_URL}
                alt="Logo institucional"
                className="mx-auto mb-4 h-auto w-28 rounded-xl max-lg:mb-3 max-lg:w-[4.5rem] sm:mb-5 sm:w-36"
                loading="eager"
              />
              <h1 className="text-2xl font-bold leading-tight text-gray-800 max-lg:mx-auto max-lg:max-w-[16rem] max-lg:text-[1.05rem] max-lg:leading-snug sm:text-3xl lg:max-w-none lg:text-4xl">
                Sistema de Gestion de Asistencia Academica
              </h1>
            </div>
            <form className="space-y-6 max-lg:space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="usuario" className="mb-1 block text-sm font-medium text-black max-lg:text-xs">
                  Usuario
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <svg className="h-5 w-5 text-gray-400 max-lg:h-4 max-lg:w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                    </svg>
                  </div>
                  <input
                    id="usuario"
                    className="block w-full rounded-lg border border-gray-300 py-3.5 pl-10 pr-3 text-base text-gray-900 placeholder-gray-400 transition-all duration-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 max-lg:py-3 max-lg:pl-9 max-lg:text-sm"
                    placeholder="Usuario o correo"
                    type="text"
                    autoComplete="username"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor="password" className="block text-sm font-medium text-black max-lg:text-xs">
                    Contraseña
                  </label>
                </div>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <svg className="h-5 w-5 text-gray-400 max-lg:h-4 max-lg:w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path
                        fillRule="evenodd"
                        d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <input
                    id="password"
                    className="block w-full rounded-lg border border-gray-300 py-3.5 pl-10 pr-11 text-base text-gray-900 placeholder-gray-400 transition-all duration-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 max-lg:py-3 max-lg:pl-9 max-lg:pr-10 max-lg:text-sm"
                    placeholder="Ingresa tu contraseña"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-black transition-colors hover:text-black focus:outline-none focus-visible:text-black focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    aria-pressed={showPassword}
                  >
                    <span className="material-symbols-outlined text-[22px] max-lg:text-[20px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex items-center">
                <input
                  id="remember-me"
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm font-medium text-black max-lg:text-xs">
                  Recordarme
                </label>
              </div>

              <button
                type="submit"
                className="flex w-full justify-center rounded-lg border border-transparent bg-blue-700 px-4 py-3.5 text-base font-bold text-white shadow-md transition-all duration-200 hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 max-lg:py-3 max-lg:text-sm"
                disabled={loading}
              >
                {loading ? 'Ingresando...' : 'Ingresar al sistema'}
              </button>
            </form>

            {error ? <p className="mt-4 text-center text-sm text-rose-600 max-lg:mt-3 max-lg:text-xs">{error}</p> : null}
          </div>

          <footer className="border-t border-gray-100 bg-slate-100 px-4 py-4 text-center max-lg:px-5 max-lg:py-3 sm:px-8 sm:py-5 lg:px-10">
            <div className="flex flex-col items-center justify-center gap-1.5 text-xs text-gray-500 max-lg:gap-1 sm:flex-row sm:flex-wrap sm:gap-x-4 sm:gap-y-2">
              <button type="button" onClick={() => onOpenLegalPage?.('terminos')} className="max-lg:py-1 hover:text-gray-700">
                Términos y condiciones
              </button>
              <button type="button" onClick={() => onOpenLegalPage?.('privacidad')} className="max-lg:py-1 hover:text-gray-700">
                Política de privacidad
              </button>
              <button type="button" onClick={() => onOpenLegalPage?.('soporte')} className="max-lg:py-1 hover:text-gray-700">
                Soporte
              </button>
            </div>
            <p className="mt-2 text-xs leading-snug text-gray-400 max-lg:mt-1.5 max-lg:text-[10px]">
              © {currentYear} Universidad Nihon Gakko.
              <br />
              Todos los derechos reservados.
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}

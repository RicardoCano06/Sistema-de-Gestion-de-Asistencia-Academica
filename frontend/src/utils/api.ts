import { toast } from './toast';
import type { SessionUser } from './rbac';

/** API en Heroku; usada en build de producción si no hay VITE_API_URL (p. ej. en Vercel). */
const PRODUCTION_API_BASE_URL = 'https://gestion-asistencias-ung-623e820b6ba1.herokuapp.com/api';

function hostDeUrlApi(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function esHostLocal(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function resolveApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL?.trim();
  if (fromEnv) {
    const base = fromEnv.replace(/\/$/, '');
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      const apiHost = hostDeUrlApi(base.startsWith('http') ? base : `http://${base}`);
      const pageHost = window.location.hostname.toLowerCase();
      if (apiHost && esHostLocal(apiHost) && !esHostLocal(pageHost)) {
        return '/api';
      }
    }
    return base;
  }
  if (import.meta.env.PROD) {
    return PRODUCTION_API_BASE_URL;
  }
  /** Mismo origen que Vite; el proxy en vite.config reenvía a :4000 (PC y celular en LAN). */
  return '/api';
}

export const API_BASE_URL = resolveApiBaseUrl();

function resolveApiOrigin(apiBaseUrl: string): string {
  const withoutApi = apiBaseUrl.replace(/\/api\/?$/, '');
  if (withoutApi) return withoutApi;
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return '';
}

export const API_ORIGIN = resolveApiOrigin(API_BASE_URL);

/** URL absoluta para documentos guardados como path relativo o URL pública (p. ej. Supabase). */
export function getDocumentoUrl(url: string | null | undefined): string {
  if (!url?.trim()) return '#';
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${API_ORIGIN}${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
}

export function esUrlActaRegenerable(url: string | null | undefined): boolean {
  return Boolean(url && /^\/reportes\/actas\/\d+\/pdf$/i.test(url.trim()));
}

function parsePdfFileName(contentDisposition: string | null): string {
  if (!contentDisposition) return 'documento.pdf';
  const utf8 = /filename\*=UTF-8''([^;\n]+)/i.exec(contentDisposition);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch {
      /* fallback abajo */
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(contentDisposition);
  if (quoted?.[1]) {
    try {
      return decodeURIComponent(quoted[1]);
    } catch {
      return quoted[1];
    }
  }
  const plain = /filename=([^;\n]+)/i.exec(contentDisposition);
  if (plain?.[1]) {
    return plain[1].trim().replace(/^["']|["']$/g, '');
  }
  return 'documento.pdf';
}

function normalizarNombrePdf(fileName: string): string {
  const trimmed = fileName.trim() || 'documento';
  return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
}

/** Une path con API_BASE_URL y devuelve URL absoluta (new URL exige absoluta si la base es /api). */
function resolveApiAbsoluteUrl(path: string): string {
  const pathPart = path.startsWith('/') ? path : `/${path}`;
  const base = API_BASE_URL.replace(/\/$/, '');
  const combined = `${base}${pathPart}`;
  if (/^https?:\/\//i.test(combined)) {
    return combined;
  }
  if (typeof window !== 'undefined') {
    return new URL(combined, window.location.origin).href;
  }
  return combined;
}

const TOKEN_KEYS = ['accessToken', 'token', 'authToken'] as const;
const USER_STORAGE_KEY = 'currentUser';

/** Curso activo en asistencias docente; persiste en sessionStorage y se borra al cerrar sesión. */
export const ASISTENCIAS_CURSO_ID_STORAGE_KEY = 'asistencias-docente-curso-id';

/**
 * Borra el curso persistido de asistencias docente.
 * @returns false si el navegador bloqueó sessionStorage (p. ej. Safari modo privado estricto).
 */
export function clearAsistenciasCursoIdPersistido(): boolean {
  try {
    sessionStorage.removeItem(ASISTENCIAS_CURSO_ID_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
const REFRESH_TOKEN_KEY = 'refreshToken';

interface RefreshTokenResponse {
  token: string;
  refreshToken: string;
  usuario?: SessionUser;
}

/**
 * Candado global: una sola renovación en vuelo.
 * Peticiones concurrentes con 401 comparten esta promesa (RTR sin invalidación cruzada).
 */
let tokenRefreshPromise: Promise<string | null> | null = null;

export function obtenerTokenSesion(): string | null {
  return TOKEN_KEYS.map((key) => localStorage.getItem(key)).find(Boolean) ?? null;
}

function isAuthRefreshPath(path: string): boolean {
  const normalized = path.replace(/^\/+/, '').replace(/\/+$/, '');
  return normalized === 'auth/refresh';
}

function persistRefreshedSession(data: RefreshTokenResponse): void {
  localStorage.setItem('accessToken', data.token);
  localStorage.setItem('token', data.token);
  localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
  if (data.usuario) {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.usuario));
  }
}

/** POST /auth/refresh con rotación estricta (RTR). */
async function executeTokenRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)?.trim();
  if (!refreshToken) {
    clearLocalSession();
    return null;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      clearLocalSession();
      return null;
    }

    const data = (await response.json()) as RefreshTokenResponse;
    if (!data.token?.trim() || !data.refreshToken?.trim()) {
      clearLocalSession();
      return null;
    }

    persistRefreshedSession(data);
    return data.token;
  } catch {
    clearLocalSession();
    return null;
  }
}

/**
 * Obtiene un access token renovado reutilizando la promesa en curso si ya hay un refresh activo.
 */
async function obtainRefreshedAccessToken(): Promise<string | null> {
  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }

  tokenRefreshPromise = executeTokenRefresh().finally(() => {
    tokenRefreshPromise = null;
  });

  return tokenRefreshPromise;
}

function isFormDataBody(body: BodyInit | null | undefined): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

/**
 * Clona FormData antes de un reintento tras 401.
 * Evita reusar un stream de cuerpo ya consumido o bloqueado en el primer intento.
 */
function cloneRequestBodyForRetry(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (body == null) return body;
  if (isFormDataBody(body)) {
    const cloned = new FormData();
    body.forEach((value, key) => {
      if (typeof File !== 'undefined' && value instanceof File) {
        cloned.append(key, value, value.name);
      } else {
        cloned.append(key, value);
      }
    });
    return cloned;
  }
  return body;
}

function resolveApiUrl(path: string): string {
  return path.startsWith('/') ? `${API_BASE_URL}${path}` : `${API_BASE_URL}/${path}`;
}

function buildRequestHeaders(options: RequestInit, accessToken?: string | null): Headers {
  const headers = new Headers(options.headers ?? {});

  if (options.body && !isFormDataBody(options.body) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  return headers;
}

/**
 * fetch autenticado con reintento transparente tras refresh (mutex RTR).
 * Base compartida de apiFetch y descargas PDF/binarias.
 */
async function fetchWithAuthRetry(path: string, options: RequestInit = {}): Promise<Response> {
  const url = resolveApiUrl(path);
  const token = obtenerTokenSesion();
  const headers = buildRequestHeaders(options, token);

  let response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    if (isAuthRefreshPath(path)) {
      const mensaje = await parseUnauthorizedMessage(response);
      failSessionExpired(mensaje);
    }

    const storedRefresh = localStorage.getItem(REFRESH_TOKEN_KEY)?.trim();
    if (!storedRefresh) {
      const mensaje = await parseUnauthorizedMessage(response);
      failSessionExpired(mensaje);
    }

    const newToken = await obtainRefreshedAccessToken();
    if (!newToken) {
      failSessionExpired();
    }

    const retryOptions: RequestInit = {
      ...options,
      body: cloneRequestBodyForRetry(options.body) ?? options.body,
    };
    const retryHeaders = buildRequestHeaders(retryOptions, newToken);
    response = await fetch(url, { ...retryOptions, headers: retryHeaders });

    if (response.status === 401) {
      const mensaje = await parseUnauthorizedMessage(response);
      failSessionExpired(mensaje);
    }
  }

  return response;
}

async function parseUnauthorizedMessage(response: Response): Promise<string> {
  const payload = await response.json().catch(() => ({}));
  return typeof payload?.mensaje === 'string' && payload.mensaje.trim()
    ? payload.mensaje
    : 'Tu sesión expiró. Iniciá sesión de nuevo.';
}

function failSessionExpired(mensaje?: string): never {
  const message = mensaje?.trim() || 'Tu sesión expiró. Iniciá sesión de nuevo.';
  notifySessionExpired();
  showSessionExpiredToast(message);
  throw new SessionExpiredError(message);
}

/** URL autenticada para abrir PDF en pestaña nueva (el navegador usa Content-Disposition). */
export function buildAuthenticatedPdfUrl(path: string): string {
  const token = obtenerTokenSesion();
  if (!token) {
    throw new SessionExpiredError();
  }
  const parsed = new URL(resolveApiAbsoluteUrl(path));
  parsed.searchParams.set('access_token', token);
  return parsed.toString();
}

/**
 * Abre un PDF en pestaña nueva preservando el gesto del usuario (evita bloqueo en móvil).
 * La ventana se abre de forma sincrónica; el PDF se carga tras fetchWithAuthRetry.
 */
export function openPdfEnPestana(path: string): void {
  const nuevaVentana = window.open('about:blank', '_blank');
  if (!nuevaVentana) {
    toast.error('Por favor, habilitá los permisos de ventanas emergentes.');
    return;
  }

  nuevaVentana.document.write(
    '<p style="font-family:sans-serif;text-align:center;margin-top:20%;color:#666;">Generando PDF...</p>'
  );

  fetchWithAuthRetry(path, { method: 'GET' })
    .then(async (response) => {
      if (!response.ok) {
        await manejarErrorPdfResponse(response);
      }
      return response.blob();
    })
    .then((blob) => {
      const urlBlob = URL.createObjectURL(blob);
      nuevaVentana.location.href = urlBlob;
      window.setTimeout(() => URL.revokeObjectURL(urlBlob), 60_000);
    })
    .catch((error: unknown) => {
      nuevaVentana.close();
      if (isSessionExpiredError(error)) return;
      toast.error('Error al generar el archivo PDF.');
    });
}

function abrirBlobEnPestana(blob: Blob): void {
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

async function manejarErrorPdfResponse(response: Response): Promise<never> {
  if (response.status === 401) {
    const payload = await response.json().catch(() => ({}));
    const mensaje =
      typeof payload?.mensaje === 'string' && payload.mensaje.trim()
        ? payload.mensaje
        : 'Tu sesión expiró. Iniciá sesión de nuevo.';
    notifySessionExpired();
    showSessionExpiredToast(mensaje);
    throw new SessionExpiredError(mensaje);
  }
  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.mensaje ?? 'No se pudo descargar el PDF');
  }
  throw new Error('No se pudo descargar el PDF');
}

/** Descarga un PDF desde la API (GET o POST) con autenticación. */
export async function downloadPdfFromApi(
  path: string,
  options: RequestInit = {}
): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetchWithAuthRetry(path, options);

  if (!response.ok) {
    return manejarErrorPdfResponse(response);
  }

  const blob = await response.blob();
  return { blob, fileName: normalizarNombrePdf(parsePdfFileName(response.headers.get('Content-Disposition'))) };
}

/** Genera un PDF (POST) y lo abre en otra pestaña cuando termina. */
export async function generarYAbrirPdf(
  path: string,
  options: RequestInit = {},
  abrir = true
): Promise<void> {
  const response = await fetchWithAuthRetry(path, options);

  if (!response.ok) {
    return manejarErrorPdfResponse(response);
  }

  const actaId = response.headers.get('X-Acta-Id')?.trim();
  if (actaId && /^\d+$/.test(actaId)) {
    await response.arrayBuffer();
    if (abrir) {
      openPdfEnPestana(`/reportes/actas/${actaId}/pdf`);
    }
    return;
  }

  const blob = await response.blob();
  if (abrir) {
    abrirBlobEnPestana(blob);
  }
}

/** Abre un PDF en otra pestaña. */
export function openPdfBlob(blob: Blob, fileName = 'documento.pdf'): void {
  void fileName;
  abrirBlobEnPestana(blob);
}

/** Abre un documento: URL pública, legacy o acta regenerable vía API autenticada. */
export async function abrirDocumento(url: string | null | undefined): Promise<void> {
  if (!url?.trim()) return;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    window.open(trimmed, '_blank', 'noopener,noreferrer');
    return;
  }
  if (esUrlActaRegenerable(trimmed)) {
    openPdfEnPestana(trimmed);
    return;
  }
  window.open(getDocumentoUrl(trimmed), '_blank', 'noopener,noreferrer');
}

/** Disparado en 401 (token ausente, inválido o expirado); `App` escucha y cierra sesión. */
export const UNAUTHORIZED_EVENT = 'app:unauthorized';

const SESSION_EXPIRED_TOAST_ID = 'session-expired';

/** Error lanzado por `apiFetch` ante 401; no volver a mostrar toast en cada `catch` de la página. */
export class SessionExpiredError extends Error {
  readonly sessionExpired = true;

  constructor(message = 'Tu sesión expiró. Iniciá sesión de nuevo.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof SessionExpiredError;
}

let unauthorizedEventPending = false;

export function notifySessionExpired(): void {
  if (unauthorizedEventPending) return;
  unauthorizedEventPending = true;
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  queueMicrotask(() => {
    unauthorizedEventPending = false;
  });
}

/** Tras login exitoso, permite volver a detectar una nueva expiración. */
export function resetSessionExpiredState(): void {
  unauthorizedEventPending = false;
  tokenRefreshPromise = null;
}

/** Un solo toast aunque varias peticiones fallen con 401 a la vez. */
function showSessionExpiredToast(message: string): void {
  toast.error(message, { id: SESSION_EXPIRED_TOAST_ID });
}

/** Toast de error de API; omite duplicar el mensaje si la sesión ya expiró. */
export function toastApiError(error: unknown, fallback: string): void {
  if (isSessionExpiredError(error)) return;
  const msg = error instanceof Error ? error.message : fallback;
  toast.error(msg);
}

/** Limpia tokens y perfil en el navegador (cierre local, CU-03). */
export function clearLocalSession(): void {
  tokenRefreshPromise = null;
  for (const key of TOKEN_KEYS) {
    localStorage.removeItem(key);
  }
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
  clearAsistenciasCursoIdPersistido();
}

/**
 * Revoca refresh en servidor y registra auditoría logout.
 * No usa apiFetch para evitar toast de sesión expirada durante el cierre.
 */
export async function logoutOnServer(): Promise<void> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)?.trim();
  if (!refreshToken) return;

  const accessToken = TOKEN_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  try {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // El cierre local sigue aunque falle la red (RN2 spec CU-03).
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetchWithAuthRetry(path, options);

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.mensaje ?? 'Error de comunicación con el servidor');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

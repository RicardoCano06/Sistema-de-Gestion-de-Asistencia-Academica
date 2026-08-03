import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { sendJsonError } from '../utils/http-errors';
import { aplicarPoliticaAlcanceHttp } from './scope-enforcement.middleware';

export interface AuthPayload {
    usuarioId: string;
    email: string;
    roles: string[];
}

/** Payload JWT puede traer `roles` como array, string o (raro) objeto tipo array de Postgres. */
export function normalizarRolesDesdePayload(roles: unknown): string[] {
    if (Array.isArray(roles)) {
        return roles.map((r) => String(r).trim()).filter((s) => s.length > 0);
    }
    if (roles != null && typeof roles === 'object' && !Array.isArray(roles)) {
        const vals = Object.values(roles as Record<string, unknown>)
            .map((r) => String(r).trim())
            .filter((s) => s.length > 0 && s !== 'null' && s !== 'undefined');
        if (vals.length > 0) return vals;
    }
    if (typeof roles === 'string' && roles.trim()) {
        return [roles.trim()];
    }
    return [];
}

function normalizarRol(rol: string): string {
    return String(rol ?? '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u2044|\u2215/g, '/')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

/** Sinónimos de coordinación de facultad → nombre canónico para comparar con la lista permitida. */
const CANONICO_ROL: Record<string, string> = {
    'coordinador/a de facultad': 'coordinador de facultad',
    'coordinadora de facultad': 'coordinador de facultad',
};

function canonicoRol(rolNormalizado: string): string {
    return CANONICO_ROL[rolNormalizado] ?? rolNormalizado;
}

/** Misma lógica que `autorizarRoles` (para checks manuales en rutas). */
export function normalizarRolComparacion(rol: string): string {
    return canonicoRol(normalizarRol(rol));
}

declare global {
    namespace Express {
        interface Request {
            usuario?: AuthPayload;
        }
    }
}

function extraerTokenAutenticacion(req: Request): string | null {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
        return header.substring(7);
    }
    // Permite abrir PDFs en pestaña nueva (window.open no envía Authorization).
    if (req.method === 'GET') {
        const queryToken = req.query.access_token;
        if (typeof queryToken === 'string' && queryToken.trim()) {
            return queryToken.trim();
        }
    }
    return null;
}

export function autenticar(req: Request, res: Response, next: NextFunction): void {
    const token = extraerTokenAutenticacion(req);
    if (!token) {
        sendJsonError(res, 401, {
            mensaje: 'Token no proporcionado',
            codigo: 'auth_token_ausente'
        });
        return;
    }

    try {
        const decoded = jwt.verify(token, env.JWT_SECRET) as AuthPayload & { roles?: unknown; role?: unknown };
        const roles = normalizarRolesDesdePayload(decoded.roles ?? decoded.role);
        req.usuario = {
            usuarioId: String(decoded.usuarioId ?? ''),
            email: String(decoded.email ?? ''),
            roles
        };
        next();
    } catch {
        sendJsonError(res, 401, {
            mensaje: 'Token inválido o expirado',
            codigo: 'auth_token_invalido'
        });
    }
}

/** JWT + política global de alcance (sobrescribe facultad/carrera en alcance estricto). */
export const autenticarConPoliticaAlcance = [autenticar, aplicarPoliticaAlcanceHttp];

export function autorizarRoles(...rolesPermitidos: string[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const rolesUsuario = normalizarRolesDesdePayload(req.usuario?.roles).map((r) => normalizarRolComparacion(r));
        const permitidos = rolesPermitidos.map((r) => normalizarRolComparacion(r));

        // Excepcion controlada:
        // Permite a Docente generar/descargar SOLO planilla legal.
        const esDocente = rolesUsuario.includes('docente');
        const esGenerarActaLegal =
            req.method === 'POST' &&
            req.path === '/reportes/actas' &&
            normalizarRol(String((req.body as { tipoActa?: unknown } | undefined)?.tipoActa ?? '')) === 'pdf_legal';
        const esDescargaActa =
            req.method === 'GET' &&
            req.path.startsWith('/reportes/actas/descargar/');
        if (esDocente && (esGenerarActaLegal || esDescargaActa)) {
            next();
            return;
        }

        const autorizado = rolesUsuario.some((rol) => permitidos.includes(rol));
        if (!autorizado) {
            sendJsonError(res, 403, {
                mensaje: 'No tienes permisos para esta acción',
                codigo: 'auth_rol_insuficiente'
            });
            return;
        }
        next();
    };
}

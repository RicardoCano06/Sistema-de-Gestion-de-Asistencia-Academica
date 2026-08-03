import { NextFunction, Request, Response } from 'express';
import type { AlcanceMatriculasFacultad } from '../utils/alumnos-scope';
import { ForbiddenScopeError, resolverAlcanceMatriculasFacultad } from '../utils/alumnos-scope';
import { aplicarPoliticaAlcanceEnPeticion, debeOmitirPoliticaAlcanceHttp } from '../utils/scope-policy';
import { sendJsonError } from '../utils/http-errors';

declare global {
    namespace Express {
        interface Request {
            /** Alcance resuelto para la sesión (caché por petición). */
            alcanceMatriculas?: AlcanceMatriculasFacultad;
        }
    }
}

export async function resolverAlcanceEnRequest(req: Request): Promise<AlcanceMatriculasFacultad> {
    if (req.alcanceMatriculas) {
        return req.alcanceMatriculas;
    }
    const usuarioId = req.usuario?.usuarioId;
    const roles = req.usuario?.roles ?? [];
    if (!usuarioId) {
        return { tipo: 'sin_restriccion' };
    }
    const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
    req.alcanceMatriculas = alcance;
    return alcance;
}

/**
 * Middleware global de seguridad de alcance (ejecutar inmediatamente después de `autenticar`).
 * Sobrescribe facultad_id / carrera_id cuando el usuario tiene alcance estricto a una sola entidad.
 */
export async function aplicarPoliticaAlcanceHttp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.usuario?.usuarioId) {
            next();
            return;
        }
        if (debeOmitirPoliticaAlcanceHttp(req.path)) {
            next();
            return;
        }
        const alcance = await resolverAlcanceEnRequest(req);
        aplicarPoliticaAlcanceEnPeticion(req, alcance);
        next();
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            sendJsonError(res, 403, { mensaje: error.message, codigo: 'alcance_no_autorizado' });
            return;
        }
        next(error);
    }
}

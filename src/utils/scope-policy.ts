import type { Request } from 'express';
import type { AlcanceMatriculasFacultad } from './alumnos-scope';
import { ForbiddenScopeError } from './alumnos-scope';

/** Campos de alcance geográfico (facultad/carrera) en body, query o params. */
const FACULTAD_KEYS = ['facultadId', 'facultad_id', 'facultadIds', 'facultad_ids'] as const;
const CARRERA_KEYS = ['carreraId', 'carrera_id', 'carreraIds', 'carrera_ids'] as const;

/**
 * Claves de destino usadas en lotes de importación.
 * Estas claves NO usan el prefijo estándar (facultadId/carreraId) y eran
 * ignoradas por la política de alcance, permitiendo IDOR.
 */
const DESTINO_FACULTAD_KEYS = ['destinoFacultadId', 'destino_facultad_id'] as const;
const DESTINO_CARRERA_KEYS = ['destinoCarreraId', 'destino_carrera_id'] as const;

export type ScopeCarrier = Record<string, unknown>;

function esObjetoRegistro(value: unknown): value is ScopeCarrier {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function parseIdUnico(value: unknown): number | null {
    if (value == null || value === '') return null;
    if (Array.isArray(value)) {
        if (value.length !== 1) return null;
        const n = Number(value[0]);
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function parseIds(value: unknown): number[] {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) {
        return value.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
    }
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? [n] : [];
}

function asignarEnCarrier(carrier: ScopeCarrier, key: string, id: number): void {
    if (key.endsWith('Ids') || key.endsWith('_ids')) {
        carrier[key] = [id];
    } else {
        carrier[key] = id;
    }
}

function eliminarClavesFacultad(carrier: ScopeCarrier): void {
    for (const key of FACULTAD_KEYS) {
        if (key in carrier) delete carrier[key];
    }
    for (const key of DESTINO_FACULTAD_KEYS) {
        if (key in carrier) delete carrier[key];
    }
}

function recorrerCarriers(req: Request, fn: (carrier: ScopeCarrier) => void): void {
    if (esObjetoRegistro(req.body)) fn(req.body as ScopeCarrier);
    if (esObjetoRegistro(req.query)) fn(req.query as ScopeCarrier);
    if (esObjetoRegistro(req.params)) fn(req.params as ScopeCarrier);
}

function idsPresentesEnCarrier(carrier: ScopeCarrier, keys: readonly string[]): number[] {
    const out: number[] = [];
    for (const key of keys) {
        if (!(key in carrier)) continue;
        out.push(...parseIds(carrier[key]));
    }
    return out;
}

function forzarIdEnPeticion(req: Request, keys: readonly string[], id: number): void {
    const singular = keys.filter((k) => !k.endsWith('Ids') && !k.endsWith('_ids'));
    recorrerCarriers(req, (carrier) => {
        for (const key of singular) {
            asignarEnCarrier(carrier, key, id);
        }
    });
}

function validarIdsPermitidos(ids: number[], permitidos: number[], mensaje: string): void {
    for (const id of ids) {
        if (!permitidos.includes(id)) {
            throw new ForbiddenScopeError(mensaje);
        }
    }
}

/**
 * Aplica política de alcance sobre body/query/params:
 * - Alcance estricto (1 facultad o 1 carrera): sobrescribe IDs del cliente (anti-IDOR).
 * - Alcance múltiple: valida que los IDs enviados pertenezcan al alcance; rechaza si no.
 * - Sin restricción: no modifica la petición.
 *
 * Incluye validación de claves destinoFacultadId/destinoCarreraId usadas
 * en importaciones de lotes para prevenir IDOR.
 */
export function aplicarPoliticaAlcanceEnPeticion(req: Request, alcance: AlcanceMatriculasFacultad): void {
    if (alcance.tipo === 'sin_restriccion') {
        return;
    }

    if (alcance.tipo === 'facultades') {
        const permitidas = alcance.facultadIds;
        if (!permitidas.length) {
            throw new ForbiddenScopeError('Tu usuario no tiene facultades asignadas.');
        }
        if (permitidas.length === 1) {
            forzarIdEnPeticion(req, FACULTAD_KEYS, permitidas[0]);
            forzarIdEnPeticion(req, DESTINO_FACULTAD_KEYS, permitidas[0]);
        } else {
            recorrerCarriers(req, (carrier) => {
                validarIdsPermitidos(
                    [
                        ...idsPresentesEnCarrier(carrier, FACULTAD_KEYS),
                        ...idsPresentesEnCarrier(carrier, DESTINO_FACULTAD_KEYS),
                    ],
                    permitidas,
                    'La facultad indicada no está en tu alcance asignado.'
                );
            });
        }
        return;
    }

    const permitidas = alcance.carreraIds;
    if (!permitidas.length) {
        throw new ForbiddenScopeError('Tu usuario no tiene carreras asignadas.');
    }

    // Jefe de carrera: la UI no ofrece filtro por facultad; si el cliente envía facultadId se ignora (no error).
    recorrerCarriers(req, eliminarClavesFacultad);

    if (permitidas.length === 1) {
        forzarIdEnPeticion(req, CARRERA_KEYS, permitidas[0]);
        forzarIdEnPeticion(req, DESTINO_CARRERA_KEYS, permitidas[0]);
    } else {
        recorrerCarriers(req, (carrier) => {
            validarIdsPermitidos(
                [
                    ...idsPresentesEnCarrier(carrier, CARRERA_KEYS),
                    ...idsPresentesEnCarrier(carrier, DESTINO_CARRERA_KEYS),
                ],
                permitidas,
                'La carrera indicada no está en tu alcance asignado.'
            );
        });
    }
}

/** Rutas donde no se debe sobrescribir alcance (auth, gestión de usuarios, salud). */
export function debeOmitirPoliticaAlcanceHttp(path: string): boolean {
    const p = (path ?? '').split('?')[0];
    const omitir = ['/auth', '/health', '/roles', '/usuarios'];
    return omitir.some((pref) => p === pref || p.startsWith(`${pref}/`));
}

export function extraerFiltrosAlcanceDesdePeticion(req: Request): {
    facultadId?: number;
    carreraId?: number;
} {
    const body = esObjetoRegistro(req.body) ? (req.body as ScopeCarrier) : {};
    const query = esObjetoRegistro(req.query) ? (req.query as ScopeCarrier) : {};
    const facultadRaw = body.facultadId ?? body.facultad_id ?? query.facultadId ?? query.facultad_id;
    const carreraRaw = body.carreraId ?? body.carrera_id ?? query.carreraId ?? query.carrera_id;
    const facultadId = parseIdUnico(facultadRaw) ?? undefined;
    const carreraId = parseIdUnico(carreraRaw) ?? undefined;
    return { facultadId, carreraId };
}

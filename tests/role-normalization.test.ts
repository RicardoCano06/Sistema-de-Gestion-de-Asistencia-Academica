import { describe, expect, it } from 'vitest';
import { normalizarRolComparacion, normalizarRolesDesdePayload } from '../src/middlewares/auth.middleware';
import { RBAC, ROLES_CIERRE_MENSUAL_EJECUTAR, ROLES_REPORTES_OPERATIVOS } from '../src/utils/rbac';

const ROLES_PERMITIDOS_ACTAS = [
    'administrador general',
    'jefe de carrera',
    'secretaria academica',
    'coordinador de facultad',
    'docente',
];

function usuarioTieneAlguno(rolesUsuario: string[], rolesObjetivo: string[]): boolean {
    const normObj = rolesObjetivo.map((r) => normalizarRolComparacion(r));
    const normUser = normalizarRolesDesdePayload(rolesUsuario).map((r) => normalizarRolComparacion(r));
    return normUser.some((rol) => normObj.includes(rol));
}

describe('normalización de roles (auth.middleware)', () => {
    it('elimina acentos en Secretaría Académica', () => {
        expect(normalizarRolComparacion('Secretaría Académica')).toBe('secretaria academica');
    });

    it('Secretaría Académica puede generar actas (lista ROLES_PERMITIDOS_ACTAS)', () => {
        expect(usuarioTieneAlguno(['Secretaría Académica'], ROLES_PERMITIDOS_ACTAS)).toBe(true);
    });

    it('Secretaría Académica cuenta como rol administrativo/académico para habilitados', () => {
        const rolesAdmin = [...RBAC.admin, ...RBAC.academic, ...RBAC.director];
        expect(usuarioTieneAlguno(['Secretaría Académica'], rolesAdmin)).toBe(true);
    });

    it('Coordinador de Facultad puede operaciones de reportes (recalcular, actas)', () => {
        expect(usuarioTieneAlguno(['Coordinador de Facultad'], ROLES_REPORTES_OPERATIVOS)).toBe(true);
        expect(usuarioTieneAlguno(['Coordinador/a de Facultad'], ROLES_REPORTES_OPERATIVOS)).toBe(true);
    });

    it('Coordinador de Facultad no puede ejecutar cierre mensual del módulo', () => {
        expect(usuarioTieneAlguno(['Coordinador de Facultad'], ROLES_CIERRE_MENSUAL_EJECUTAR)).toBe(false);
    });
});

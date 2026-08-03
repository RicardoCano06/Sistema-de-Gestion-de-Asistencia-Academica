import { describe, expect, it } from 'vitest';
import { computeAllowedAppViews, computeHomeAppView } from '../src/utils/navigation-policy';

const ADMIN_VIEWS = [
    'panel',
    'importaciones',
    'usuarios',
    'academico',
    'alumnos',
    'reportes',
    'auditoria'
] as const;

describe('navigation-policy (alineado con frontend rbac)', () => {
    it('administrador general: todas las vistas de gestión excepto asistencias', () => {
        expect(computeAllowedAppViews(['Administrador General'])).toEqual([...ADMIN_VIEWS]);
    });

    it('rol legado «Administrador» ya no otorga vistas de administración (usar migración SQL + Administrador General)', () => {
        expect(computeAllowedAppViews(['Administrador'])).toEqual(['importaciones']);
    });

    it('Secretaría Académica: panel, académico, alumnos, importaciones, reportes y usuarios (sin asistencias ni auditoría)', () => {
        expect(computeAllowedAppViews(['Secretaría Académica'])).toEqual([
            'panel',
            'academico',
            'alumnos',
            'importaciones',
            'reportes',
            'usuarios'
        ]);
        expect(computeHomeAppView(['Secretaría Académica'])).toBe('panel');
    });

    it('docente solo asistencias e inicio asistencias', () => {
        expect(computeAllowedAppViews(['Docente'])).toEqual(['asistencias']);
        expect(computeHomeAppView(['Docente'])).toBe('asistencias');
    });

    it('jefe de carrera', () => {
        expect(computeAllowedAppViews(['Jefe de Carrera'])).toEqual(['panel', 'academico', 'alumnos', 'reportes']);
        expect(computeHomeAppView(['Jefe de Carrera'])).toBe('panel');
    });

    it('coordinador de facultad (nombre vigente)', () => {
        expect(computeAllowedAppViews(['Coordinador de Facultad'])).toEqual([
            'panel',
            'academico',
            'alumnos',
            'reportes'
        ]);
        expect(computeHomeAppView(['Coordinador de Facultad'])).toBe('panel');
    });

    it('coordinador de facultad (variante sin barra en BD)', () => {
        expect(computeAllowedAppViews(['Coordinador de Facultad'])).toEqual([
            'panel',
            'academico',
            'alumnos',
            'reportes'
        ]);
    });

    it('sin rol reconocido cae en importaciones', () => {
        expect(computeAllowedAppViews(['Operador'])).toEqual(['importaciones']);
        expect(computeHomeAppView(['Operador'])).toBe('importaciones');
    });

    it('prioridad administración general sobre docente', () => {
        expect(computeAllowedAppViews(['Docente', 'Administrador General'])).toEqual([...ADMIN_VIEWS]);
    });
});

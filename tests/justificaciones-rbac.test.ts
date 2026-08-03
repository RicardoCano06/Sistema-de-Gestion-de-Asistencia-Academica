import { describe, expect, it } from 'vitest';
import {
  coerceRolesToStringArray,
  normalizeRol,
  puedeAprobarJustificaciones,
} from '@frontend/utils/rbac';

describe('RBAC justificaciones (panel / asistencias)', () => {
  it('Administrador General no aprueba ni ve bandeja (solo gestión institucional)', () => {
    expect(puedeAprobarJustificaciones(['Administrador General'])).toBe(false);
  });

  it('Secretaría y jefatura pueden', () => {
    expect(puedeAprobarJustificaciones(['Secretaría Académica'])).toBe(true);
    expect(puedeAprobarJustificaciones(['Jefe de Carrera'])).toBe(true);
  });

  it('Coordinación de facultad puede aprobar (alcance en API)', () => {
    expect(puedeAprobarJustificaciones(['Coordinador de Facultad'])).toBe(true);
    expect(puedeAprobarJustificaciones(['Coordinador/a de Facultad'])).toBe(true);
    expect(puedeAprobarJustificaciones(['Coordinadora de Facultad'])).toBe(true);
  });

  it('Docente no puede aprobar bandeja global', () => {
    expect(puedeAprobarJustificaciones(['Docente'])).toBe(false);
  });

  it('rol legado «Administrador» no cuenta como aprobador', () => {
    expect(puedeAprobarJustificaciones(['Administrador'])).toBe(false);
  });

  it('coerceRolesToStringArray tolera objeto tipo fila', () => {
    expect(coerceRolesToStringArray({ 0: 'Administrador General', 1: 'Docente' })).toEqual([
      'Administrador General',
      'Docente',
    ]);
    expect(puedeAprobarJustificaciones({ 0: 'Administrador General' })).toBe(false);
  });

  it('normalizeRol elimina acentos y caracteres invisibles', () => {
    expect(normalizeRol(' Secretaría Académica\u200B ')).toBe('secretaria academica');
    expect(normalizeRol('Administrador General')).toBe('administrador general');
  });
});

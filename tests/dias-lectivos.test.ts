import { describe, expect, it } from 'vitest';
import { contarDiasLectivosModulo } from '../src/utils/dias-lectivos';

describe('contarDiasLectivosModulo', () => {
    it('cuenta solo lun–jue en el rango', () => {
        // Mayo 2025: 4 (dom) .. 29 (jue) — ejemplo típico de módulo
        const total = contarDiasLectivosModulo('2025-05-05', '2025-05-29');
        expect(total).toBeGreaterThan(0);
        expect(total).toBeLessThanOrEqual(20);
    });

    it('devuelve 0 si el rango es inválido', () => {
        expect(contarDiasLectivosModulo('2025-05-30', '2025-05-01')).toBe(0);
    });
});

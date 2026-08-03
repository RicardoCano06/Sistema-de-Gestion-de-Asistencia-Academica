/** Nombre vigente del rol de coordinación de facultad. */
export const ROL_COORDINADOR_FACULTAD = 'Coordinador de Facultad';

const ALIAS_A_VIGENTE: Record<string, string> = {
    'Coordinador/a de Facultad': ROL_COORDINADOR_FACULTAD,
    'Coordinadora de Facultad': ROL_COORDINADOR_FACULTAD,
    'Director de Facultad': ROL_COORDINADOR_FACULTAD,
};

/** Nombres históricos que equivalen a coordinación de facultad (consultas y filtros). */
export const NOMBRES_LEGACY_COORDINADOR_FACULTAD = [
    'Coordinador/a de Facultad',
    'Coordinadora de Facultad',
    'Director de Facultad',
] as const;

export function nombreRolVigente(nombre: string): string {
    const trimmed = String(nombre ?? '').trim();
    return ALIAS_A_VIGENTE[trimmed] ?? trimmed;
}

/** Variantes a buscar en `roles.nombre` (vigente + legado). */
export function nombresRolParaConsulta(nombre: string): string[] {
    const vigente = nombreRolVigente(nombre);
    if (vigente === ROL_COORDINADOR_FACULTAD) {
        return [ROL_COORDINADOR_FACULTAD, ...NOMBRES_LEGACY_COORDINADOR_FACULTAD];
    }
    return [vigente];
}

export function normalizarNombresRoles(roles: string[]): string[] {
    const vistos = new Set<string>();
    const resultado: string[] = [];
    for (const rol of roles) {
        const vigente = nombreRolVigente(rol);
        if (!vigente || vistos.has(vigente)) continue;
        vistos.add(vigente);
        resultado.push(vigente);
    }
    return resultado;
}

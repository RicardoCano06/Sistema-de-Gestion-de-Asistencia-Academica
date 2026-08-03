/** Etiqueta visible del rol de coordinación de facultad (alineado con BD y formularios). */
export const ROL_COORDINADOR_FACULTAD = 'Coordinador de Facultad';

const ALIAS_A_VIGENTE: Record<string, string> = {
  'Coordinador/a de Facultad': ROL_COORDINADOR_FACULTAD,
  'Coordinadora de Facultad': ROL_COORDINADOR_FACULTAD,
  'Director de Facultad': ROL_COORDINADOR_FACULTAD,
};

/** Texto para mostrar en UI (tablas, badges, sidebar). */
export function etiquetaRol(nombre: string): string {
  const trimmed = String(nombre ?? '').trim();
  return ALIAS_A_VIGENTE[trimmed] ?? trimmed;
}

export function etiquetasRoles(roles: string[]): string[] {
  const vistos = new Set<string>();
  const resultado: string[] = [];
  for (const rol of roles) {
    const etiqueta = etiquetaRol(rol);
    if (!etiqueta || vistos.has(etiqueta)) continue;
    vistos.add(etiqueta);
    resultado.push(etiqueta);
  }
  return resultado;
}

/** Cuenta lun–jue (inclusive) entre fechas ISO YYYY-MM-DD. Alineado a la planilla docente y a contar_dias_lectivos_modulo en PostgreSQL. */
export function contarDiasLectivosModulo(fechaInicio: string, fechaFin: string): number {
    const ini = normalizeIsoDate(fechaInicio);
    const fin = normalizeIsoDate(fechaFin);
    if (!ini || !fin || fin < ini) return 0;

    let count = 0;
    const cursor = new Date(`${ini}T12:00:00`);
    const end = new Date(`${fin}T12:00:00`);

    while (cursor <= end) {
        const dow = cursor.getDay();
        if (dow >= 1 && dow <= 4) count += 1;
        cursor.setDate(cursor.getDate() + 1);
    }

    return count;
}

function normalizeIsoDate(value: string): string {
    return String(value ?? '').slice(0, 10);
}

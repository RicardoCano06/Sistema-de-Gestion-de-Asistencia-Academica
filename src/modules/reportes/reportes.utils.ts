/**
 * Utilidades para generación de nombres de archivos PDF académicos.
 * Estándar: "Título - [Opcionales] - Mes - Año.pdf"
 */

const MES_NOMBRES: Record<string, string> = {
    '01': 'Enero',
    '02': 'Febrero',
    '03': 'Marzo',
    '04': 'Abril',
    '05': 'Mayo',
    '06': 'Junio',
    '07': 'Julio',
    '08': 'Agosto',
    '09': 'Septiembre',
    '10': 'Octubre',
    '11': 'Noviembre',
    '12': 'Diciembre',
};

/**
 * Convierte número de mes (1-12) o string (01-12) a nombre en español.
 */
export function nombreMes(mes: number | string): string {
    const key = String(mes).padStart(2, '0');
    return MES_NOMBRES[key] ?? 'Mes';
}

/**
 * Extrae año y mes de un período en formato YYYY-MM.
 */
export function parsePeriodo(periodo: string): { anio: number; mes: number } | null {
    const match = /^(\d{4})-(\d{2})$/.exec(periodo);
    if (!match) return null;
    return {
        anio: Number(match[1]),
        mes: Number(match[2]),
    };
}

/**
 * Opciones para construcción de nombre de PDF.
 */
interface PdfNamingOptions {
    /** Título principal del documento (obligatorio). */
    titulo: string;
    /** Facultad (opcional). */
    facultad?: string | null;
    /** Carrera (opcional). */
    carrera?: string | null;
    /** Materia/asignatura (opcional). */
    materia?: string | null;
    /** Nombre de alumno (para informes individuales). */
    alumno?: string | null;
    /** Periodo en formato YYYY-MM (se usa para extraer mes/año). */
    periodo?: string | null;
    /** Año lectivo (alternativa a periodo). */
    anioLectivo?: number | string | null;
    /** Mes (alternativa a periodo). */
    mes?: number | string | null;
}

/**
 * Genera nombre de archivo PDF elegante y legible.
 * 
 * Reglas:
 * - Siempre incluye título principal
 * - Incluye facultad, carrera, materia, alumno solo si existen
 * - Siempre incluye mes (en texto) y año al final
 * - Sin IDs técnicos, timestamps o hashes
 * 
 * Formato: "Título - [Facultad] - [Carrera] - [Materia] - [Alumno] - Mes - Año.pdf"
 */
export function generarNombrePdfElegante(options: PdfNamingOptions): string {
    const {
        titulo,
        facultad,
        carrera,
        materia,
        alumno,
        periodo,
        anioLectivo,
        mes,
    } = options;

    const partes: string[] = [];

    // Título principal (siempre)
    if (titulo && titulo.trim()) {
        partes.push(titulo.trim());
    }

    // Datos contextuales (solo si existen)
    if (facultad && facultad.trim()) {
        partes.push(facultad.trim());
    }
    if (carrera && carrera.trim()) {
        partes.push(carrera.trim());
    }
    if (materia && materia.trim()) {
        partes.push(materia.trim());
    }
    if (alumno && alumno.trim()) {
        partes.push(alumno.trim());
    }

    // Determinar mes y año
    let anio: number | string | null = anioLectivo ?? null;
    let mesNum: number | string | null = mes ?? null;

    if (periodo) {
        const parsed = parsePeriodo(periodo);
        if (parsed) {
            anio = parsed.anio;
            mesNum = parsed.mes;
        }
    }

    // Si no hay año/mes, usar fecha actual como fallback
    if (!anio || !mesNum) {
        const now = new Date();
        anio = anio ?? now.getFullYear();
        mesNum = mesNum ?? (now.getMonth() + 1);
    }

    // Agregar mes (en texto) y año al final
    const mesNombre = nombreMes(mesNum);
    partes.push(mesNombre);
    partes.push(String(anio));

    // Unir con separador elegante
    const nombreBase = partes.join(' - ');

    // Sanitizar para nombre de archivo (quitar caracteres problemáticos)
    const nombreSanitizado = nombreBase
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();

    return `${nombreSanitizado}.pdf`;
}

/**
 * Genera nombre de archivo PDF con timestamp para unicidad (solo cuando es estrictamente necesario).
 * Usa formato legible: "Título - DD-MM-YYYY HHmmss.pdf"
 */
export function generarNombrePdfConTimestamp(options: PdfNamingOptions & { timestamp?: Date }): string {
    const { titulo, facultad, carrera, materia, alumno, periodo, anioLectivo, mes, timestamp = new Date() } = options;

    const partes: string[] = [];

    if (titulo && titulo.trim()) {
        partes.push(titulo.trim());
    }
    if (facultad && facultad.trim()) {
        partes.push(facultad.trim());
    }
    if (carrera && carrera.trim()) {
        partes.push(carrera.trim());
    }
    if (materia && materia.trim()) {
        partes.push(materia.trim());
    }
    if (alumno && alumno.trim()) {
        partes.push(alumno.trim());
    }

    // Fecha formateada: DD-MM-YYYY HHmmss
    const dd = String(timestamp.getDate()).padStart(2, '0');
    const mm = String(timestamp.getMonth() + 1).padStart(2, '0');
    const yyyy = timestamp.getFullYear();
    const hh = String(timestamp.getHours()).padStart(2, '0');
    const min = String(timestamp.getMinutes()).padStart(2, '0');
    const ss = String(timestamp.getSeconds()).padStart(2, '0');

    partes.push(`${dd}-${mm}-${yyyy} ${hh}${min}${ss}`);

    const nombreBase = partes.join(' - ');
    const nombreSanitizado = nombreBase
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();

    return `${nombreSanitizado}.pdf`;
}

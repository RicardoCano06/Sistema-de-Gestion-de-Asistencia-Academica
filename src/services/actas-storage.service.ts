import { supabase } from '../config/supabase';

const ACTAS_BUCKET = 'actas';

/**
 * Supabase Storage exige claves seguras (sin espacios, comas, acentos ni caracteres reservados).
 * Convierte el nombre legible del PDF a un slug ASCII compatible.
 */
export function sanitizeStoragePath(fileName: string): string {
    const base = fileName.replace(/\\/g, '/').split('/').pop() ?? 'documento.pdf';
    const stem = base.replace(/\.pdf$/i, '');

    const slug = stem
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();

    return `${slug.slice(0, 200) || 'documento'}.pdf`;
}

/** Sube un PDF en memoria al bucket `actas` y devuelve la URL pública absoluta. */
export async function subirActaPdf(buffer: Buffer, fileName: string): Promise<string> {
    const ruta = sanitizeStoragePath(fileName);

    const { error } = await supabase.storage.from(ACTAS_BUCKET).upload(ruta, buffer, {
        contentType: 'application/pdf',
        upsert: true,
    });

    if (error) {
        throw new Error(`No se pudo subir el PDF a Supabase Storage: ${error.message}`);
    }

    const { data } = supabase.storage.from(ACTAS_BUCKET).getPublicUrl(ruta);
    return data.publicUrl;
}

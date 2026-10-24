import { supabase } from '../config/supabase';
import { env } from '../config/env';
import { sanitizeStoragePath } from '../utils/sanitize-storage-path';

const JUSTIFICATIVOS_BUCKET = 'justificativos';

/** Sube un PDF justificativo al bucket `justificativos` y devuelve la URL pública absoluta. */
export async function subirJustificativoPdf(buffer: Buffer, originalName: string): Promise<string> {
    if (env.storageProvider === 'local') {
        const { subirJustificativoPdfLocal } = await import('./local-storage.service');
        return subirJustificativoPdfLocal(buffer, originalName);
    }

    const slug = sanitizeStoragePath(originalName).replace(/\.pdf$/i, '');
    const ruta = `${Date.now()}-${slug}.pdf`;

    const { error } = await supabase.storage.from(JUSTIFICATIVOS_BUCKET).upload(ruta, buffer, {
        contentType: 'application/pdf',
        upsert: false,
    });

    if (error) {
        throw new Error(`No se pudo subir el justificativo a Supabase Storage: ${error.message}`);
    }

    const { data } = supabase.storage.from(JUSTIFICATIVOS_BUCKET).getPublicUrl(ruta);
    return data.publicUrl;
}

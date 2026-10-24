import { supabase } from '../config/supabase';
import { env } from '../config/env';
import { sanitizeStoragePath } from '../utils/sanitize-storage-path';

const ACTAS_BUCKET = 'actas';

/** Sube un PDF en memoria al bucket `actas` y devuelve la URL pública absoluta. */
export async function subirActaPdf(buffer: Buffer, fileName: string): Promise<string> {
    if (env.storageProvider === 'local') {
        const { subirActaPdfLocal } = await import('./local-storage.service');
        return subirActaPdfLocal(buffer, fileName);
    }

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

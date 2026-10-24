import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env';
import { sanitizeStoragePath } from '../utils/sanitize-storage-path';

function uploadsRoot(): string {
    return path.resolve(process.cwd(), env.localUploadsDir);
}

function publicBase(): string {
    const base = env.publicBaseUrl?.trim() || `http://localhost:${env.PORT}`;
    return base.replace(/\/$/, '');
}

async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
}

/** Guarda un PDF de acta en disco local y devuelve su URL pública local. */
export async function subirActaPdfLocal(buffer: Buffer, fileName: string): Promise<string> {
    const ruta = sanitizeStoragePath(fileName);
    const dir = path.join(uploadsRoot(), 'actas');
    await ensureDir(dir);
    await fs.writeFile(path.join(dir, ruta), buffer);
    return `${publicBase()}/uploads/actas/${ruta}`;
}

/** Guarda un PDF justificativo en disco local y devuelve su URL pública local. */
export async function subirJustificativoPdfLocal(buffer: Buffer, originalName: string): Promise<string> {
    const slug = sanitizeStoragePath(originalName).replace(/\.pdf$/i, '');
    const ruta = `${Date.now()}-${slug}.pdf`;
    const dir = path.join(uploadsRoot(), 'justificativos');
    await ensureDir(dir);
    await fs.writeFile(path.join(dir, ruta), buffer);
    return `${publicBase()}/uploads/justificativos/${ruta}`;
}
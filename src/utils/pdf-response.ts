import type { Response } from 'express';

export function nombreArchivoPdfSeguro(fileName: string): string {
    const base = fileName.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
    return base.endsWith('.pdf') ? base : `${base || 'documento'}.pdf`;
}

function contentDispositionInline(fileName: string): string {
    const safe = nombreArchivoPdfSeguro(fileName);
    const asciiFallback = safe.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
    return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/** Envía un PDF generado en memoria (sin persistir en Storage). */
export function enviarPdfBuffer(res: Response, buffer: Buffer, fileName: string, status = 200): void {
    const safe = nombreArchivoPdfSeguro(fileName);
    res.status(status);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDispositionInline(safe));
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.send(buffer);
}

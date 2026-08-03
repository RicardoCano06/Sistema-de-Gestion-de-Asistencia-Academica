import PDFDocument from 'pdfkit';

type PdfDocumentOptions = ConstructorParameters<typeof PDFDocument>[0];

/** Captura la salida de pdfkit en RAM usando eventos `data` + Buffer.concat (sin disco). */
export function renderPdfDocumentToBuffer(
    build: (doc: PDFKit.PDFDocument) => void,
    options?: PdfDocumentOptions
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument(options);
        const chunks: Buffer[] = [];

        doc.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });
        doc.on('end', () => {
            resolve(Buffer.concat(chunks));
        });
        doc.on('error', reject);

        try {
            build(doc);
            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

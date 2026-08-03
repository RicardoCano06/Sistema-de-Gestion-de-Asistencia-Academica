import PDFKit from 'pdfkit';
import {
    drawInstitutionalHeaderPlanillaLegal,
    PDF_INSTITUTIONAL_HEADER_TOP_REPORTS,
} from '../../utils/pdf-institutional-header-planilla';

// ─── Tipos de entrada ────────────────────────────────────────────────────────

export interface CronogramaSemanaItem {
    contenido: string;
    actividad: string;
}

export interface CronogramaSemana {
    nombre: string;
    horas: number;
    items: CronogramaSemanaItem[];
}

export interface CronogramaPdfData {
    facultad: string;
    carrera: string;
    materia: string;
    semestreAcademico: string;
    docente: string;
    seccion: string;
    turno: string;
    jefatura: string;
    semanas: CronogramaSemana[];
    evaluacionParcial: { fecha: string | null; alcance: string | null };
    evaluacionFinal: { fecha: string | null; alcance: string | null };
}

// ─── Constantes de Layout Horizontal (A4 Landscape) ──────────────────────────

const PAGE_W = 842;  // Ancho horizontal
const PAGE_H = 595;  // Alto horizontal
const MARGIN = 40;
const TABLE_X = MARGIN;
const TABLE_W = PAGE_W - MARGIN * 2; // 762 pt de espacio útil

// Recalibración de coordenadas X y Anchos para aprovechar el ancho horizontal
const COL_X = {
    fecha: 40,
    contenidos: 130,
    actividades: 492,
    horas: 672,
    firma: 722,
} as const;

const COL_W = {
    fecha: 90,
    contenidos: 362,
    actividades: 180,
    horas: 50,
    firma: 80,
} as const;

const EVAL_ROW_H = 30;
const PAGE_BREAK_THRESHOLD = 520;

function fmtDatePdf(iso: string | null): string {
  if (!iso) return '___/___/____';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
} 

// ─── Helpers de dibujo ───────────────────────────────────────────────────────

function drawHLine(doc: PDFKit.PDFDocument, x1: number, x2: number, y: number): void {
    doc.moveTo(x1, y).lineTo(x2, y).strokeColor('#000000').lineWidth(0.5).stroke();
}

function drawRect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number): void {
    doc.lineWidth(0.5).strokeColor('#000000').rect(x, y, w, h).stroke();
}

function drawCellText(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    opts: { bold?: boolean; align?: 'left' | 'center' | 'right'; size?: number } = {},
): void {
    const font = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
    const fontSize = opts.size ?? 9;
    const padX = 5;
    const innerW = w - padX * 2;

    const textH = doc.font(font).fontSize(fontSize).heightOfString(text, { width: innerW });
    const textY = y + Math.max(0, (h - textH) / 2);
    const align = opts.align ?? 'left';

    doc.font(font).fontSize(fontSize).fillColor('#000000');
    doc.text(text, x + padX, textY, { width: innerW, align: align });
}

// ─── Metadatos ───────────────────────────────────────────────────────────────

function drawFullRow(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    label: string,
    value: string,
): number {
    const rowH = 18;
    const labelW = doc.font('Helvetica-Bold').fontSize(9).widthOfString(label) + 8;
    drawRect(doc, x, y, w, rowH);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
    doc.text(label, x + 3, y + 3, { width: labelW, lineBreak: false });
    doc.font('Helvetica').fontSize(9);
    doc.text(value ?? '', x + labelW + 3, y + 3, { width: w - labelW - 6, lineBreak: false });
    return y + rowH;
}

function drawTripleRow(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    items: Array<{ label: string; value: string; ratio: number }>,
): number {
    const rowH = 18;
    const labelW = 55;
    const gap = 4;
    const totalRatio = items.reduce((a, i) => a + i.ratio, 0);
    let cx = x;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const colW = (w - gap * (items.length - 1)) * (item.ratio / totalRatio);
        drawRect(doc, cx, y, colW, rowH);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
        doc.text(item.label, cx + 3, y + 3, { width: labelW, lineBreak: false });
        doc.font('Helvetica').fontSize(9);
        doc.text(item.value ?? '', cx + labelW + 3, y + 3, { width: colW - labelW - 6, lineBreak: false });
        cx += colW + gap;
    }
    return y + rowH;
}

function drawMetaBlock(doc: PDFKit.PDFDocument, data: CronogramaPdfData): number {
    let y = doc.y + 4;

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000');
    doc.text('REGISTRO DE CÁTEDRA', TABLE_X, y, { width: TABLE_W, align: 'center', lineBreak: false });
    y += 18;

    // Fila 1: Asignatura (full width)
    y = drawFullRow(doc, TABLE_X, y, TABLE_W, 'ASIGNATURA:', data.materia);

    // Fila 2: Semestre | Sección | Turno
    y = drawTripleRow(doc, TABLE_X, y, TABLE_W, [
        { label: 'SEMESTRE:', value: data.semestreAcademico, ratio: 1 },
        { label: 'SECCIÓN:', value: data.seccion, ratio: 1 },
        { label: 'TURNO:', value: data.turno, ratio: 1.2 },
    ]);

    // Fila 3: Docente (full width)
    y = drawFullRow(doc, TABLE_X, y, TABLE_W, 'DOCENTE:', data.docente);

    // Fila 4: Jefe y/o Coordinador de Carrera (full width)
    y = drawFullRow(doc, TABLE_X, y, TABLE_W, 'JEFE Y/O COORD. DE CARRERA:', data.jefatura);

    doc.y = y + 6;
    return doc.y;
}

// ─── Encabezado de tabla ─────────────────────────────────────────────────────

function drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
    const h = 18;
    drawRect(doc, COL_X.fecha, y, COL_W.fecha, h);
    drawRect(doc, COL_X.contenidos, y, COL_W.contenidos, h);
    drawRect(doc, COL_X.actividades, y, COL_W.actividades, h);
    drawRect(doc, COL_X.horas, y, COL_W.horas, h);
    drawRect(doc, COL_X.firma, y, COL_W.firma, h);

    drawCellText(doc, COL_X.fecha, y, COL_W.fecha, h, 'FECHA', { bold: true, align: 'center' });
    drawCellText(doc, COL_X.contenidos, y, COL_W.contenidos, h, 'CONTENIDOS', { bold: true, align: 'center' });
    drawCellText(doc, COL_X.actividades, y, COL_W.actividades, h, 'ACTIVIDADES (Especificar)', { bold: true, align: 'center' });
    drawCellText(doc, COL_X.horas, y, COL_W.horas, h, 'HORAS', { bold: true, align: 'center' });
    drawCellText(doc, COL_X.firma, y, COL_W.firma, h, 'FIRMA', { bold: true, align: 'center' });

    return y + h;
}

// ─── Función Principal ───────────────────────────────────────────────────────

export function generateCronogramaBody(doc: PDFKit.PDFDocument, data: CronogramaPdfData): void {
    const totalHoras = data.semanas.reduce((acc, s) => acc + s.horas, 0);

    // ── 0. Encabezado institucional (pasa el ancho horizontal) ──
    const { rowFacultadY } = drawInstitutionalHeaderPlanillaLegal(
        doc, PAGE_W, PDF_INSTITUTIONAL_HEADER_TOP_REPORTS,
    );
    doc.y = rowFacultadY + 4;
    doc.y = drawMetaBlock(doc, data);

    // ── 1. Cabecera de la tabla ──
    let y = drawTableHeader(doc, doc.y);

    // ── 2. Renderizado de Semanas ──
    for (const sem of data.semanas) {
        let alturaTotal = 0;
        const filasInternas: number[] = [];

        for (const item of sem.items) {
            const altoContenido = doc.font('Helvetica').fontSize(9).heightOfString(
                item.contenido || '', { width: COL_W.contenidos - 10 },
            );
            const altoActividad = doc.font('Helvetica').fontSize(9).heightOfString(
                item.actividad || '', { width: COL_W.actividades - 10 },
            );
            const altoFila = Math.max(altoContenido, altoActividad) + 8;
            filasInternas.push(altoFila);
            alturaTotal += altoFila;
        }

        // Altura minima para que el texto de la fecha/horas no se superponga
        const altoFecha = doc.font('Helvetica').fontSize(9).heightOfString(
            sem.nombre, { width: COL_W.fecha - 10 },
        ) + 12;
        if (alturaTotal < altoFecha) alturaTotal = altoFecha;

        // Control de salto de página ajustado a dimensiones horizontales
        if (y + alturaTotal > PAGE_BREAK_THRESHOLD) {
            doc.addPage();
            y = MARGIN;
            y = drawTableHeader(doc, y);
        }

        const semanaY = y;

        // Renderizado de celdas agrupadas (Rowspan matemático)
        drawCellText(doc, COL_X.fecha, semanaY, COL_W.fecha, alturaTotal, sem.nombre, { align: 'center' });
        drawCellText(doc, COL_X.horas, semanaY, COL_W.horas, alturaTotal, String(sem.horas || ''), { align: 'center' });

        let yAux = semanaY;
        for (let i = 0; i < sem.items.length; i++) {
            const item = sem.items[i];
            const altoFila = filasInternas[i];

            drawCellText(doc, COL_X.contenidos, yAux, COL_W.contenidos, altoFila, item.contenido || '');
            drawCellText(doc, COL_X.actividades, yAux, COL_W.actividades, altoFila, item.actividad || '');

            if (i < sem.items.length - 1) {
                drawHLine(doc, COL_X.contenidos, COL_X.actividades + COL_W.actividades, yAux + altoFila);
            }

            yAux += altoFila;
        }

        // Estructuración de bordes externos por bloque de semana
        drawRect(doc, COL_X.fecha, semanaY, COL_W.fecha, alturaTotal);
        drawRect(doc, COL_X.contenidos, semanaY, COL_W.contenidos, alturaTotal);
        drawRect(doc, COL_X.actividades, semanaY, COL_W.actividades, alturaTotal);
        drawRect(doc, COL_X.horas, semanaY, COL_W.horas, alturaTotal);
        drawRect(doc, COL_X.firma, semanaY, COL_W.firma, alturaTotal);

        y += alturaTotal;
    }

    // ── 3. Sección de Evaluaciones de Cierre ──
    if (y + EVAL_ROW_H * 3 + 10 > PAGE_BREAK_THRESHOLD) {
        doc.addPage();
        y = MARGIN;
    }
    y += 4;

    function drawEvalRow(label: string, fecha: string | null, alcance: string | null, topY: number): number {
        drawRect(doc, COL_X.fecha, topY, COL_W.fecha, EVAL_ROW_H);
        drawCellText(doc, COL_X.fecha, topY, COL_W.fecha, EVAL_ROW_H, label, { bold: true, size: 8, align: 'center' });

        const detailX = COL_X.contenidos;
        const detailW = COL_W.contenidos + COL_W.actividades;
        drawRect(doc, detailX, topY, detailW, EVAL_ROW_H);

        doc.font('Helvetica').fontSize(9).fillColor('#000000');
        doc.text(`Fecha: ${fmtDatePdf(fecha)}`, detailX + 6, topY + 4, { width: detailW - 12 });
        doc.text(`Prueba: ${alcance || '____________________________________________________________________'}`, detailX + 6, topY + 16, { width: detailW - 12 });

        drawRect(doc, COL_X.horas, topY, COL_W.horas, EVAL_ROW_H);
        drawRect(doc, COL_X.firma, topY, COL_W.firma, EVAL_ROW_H);

        return topY + EVAL_ROW_H;
    }

    y = drawEvalRow('EVALUACIÓN\nPARCIAL', data.evaluacionParcial.fecha, data.evaluacionParcial.alcance, y);
    y = drawEvalRow('EVALUACIÓN\nFINAL', data.evaluacionFinal.fecha, data.evaluacionFinal.alcance, y);

    // ── Total de horas ──
    const totalLabelW = COL_W.fecha + COL_W.contenidos + COL_W.actividades;
    drawRect(doc, COL_X.fecha, y, totalLabelW, EVAL_ROW_H);
    drawRect(doc, COL_X.horas, y, COL_W.horas, EVAL_ROW_H);
    drawRect(doc, COL_X.firma, y, COL_W.firma, EVAL_ROW_H);

    drawCellText(doc, COL_X.fecha, y, totalLabelW, EVAL_ROW_H, 'TOTAL DE HORAS', { bold: true, size: 10, align: 'left' });
    drawCellText(doc, COL_X.horas, y, COL_W.horas, EVAL_ROW_H, String(totalHoras), { bold: true, size: 11, align: 'center' });
    y += EVAL_ROW_H + 20;

    // ── 4. Sección de Firmas ──
    if (y > 490) {
        doc.addPage();
        y = MARGIN;
    }
    y += 40;

    const fY = y;
    const firmaFont = 'Helvetica';
    const firmaSize = 8;

    // ─── Ajusta estos valores manualmente ──────────────────────────────────
    const sigLeft   = { x: 40,  w: 120 };
    const sigCenter = { x: 331, w: 220 };
    const sigRight  = { x: 622, w: 160 };
    // ───────────────────────────────────────────────────────────────────────

    doc.font(firmaFont).fontSize(firmaSize).fillColor('#000000');

    doc.moveTo(sigLeft.x, fY).lineTo(sigLeft.x + sigLeft.w, fY).strokeColor('#000000').lineWidth(0.5).stroke();
    doc.text('FIRMA DEL DOCENTE', sigLeft.x, fY + 4, { width: sigLeft.w, align: 'center', lineBreak: false });

    doc.moveTo(sigCenter.x, fY).lineTo(sigCenter.x + sigCenter.w, fY).strokeColor('#000000').lineWidth(0.5).stroke();
    doc.text('FIRMA DEL JEFE Y/O COORDINADOR DE CARRERA', sigCenter.x, fY + 4, { width: sigCenter.w, align: 'center', lineBreak: false });

    doc.moveTo(sigRight.x, fY).lineTo(sigRight.x + sigRight.w, fY).strokeColor('#000000').lineWidth(0.5).stroke();
    doc.text('FIRMA DEL DIRECTOR ACADÉMICO', sigRight.x, fY + 4, { width: sigRight.w, align: 'center', lineBreak: false });

    doc.y = y;
}
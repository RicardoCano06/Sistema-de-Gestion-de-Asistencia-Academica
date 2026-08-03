/**
 * Portada y bloques meta compartidos por informes operativos (auditoría, informe alumno, consolidado, etc.).
 * No usar en la planilla legal (`reportes.pdf.ts`).
 */

import PDFKit from 'pdfkit';
import { PDF_BRAND, drawStackedLabelValue } from './pdf-kit-brand';

const SUBTITLE = 'Sistema de Gestión de Asistencia Académica';

type DocWithTextMeasure = PDFKit.PDFDocument & {
  heightOfString(text: string, options?: { width?: number; lineGap?: number }): number;
};

export interface OperativoPdfCoverOpts {
  titulo: string;
  /** Texto ya formateado para “Generado: …” */
  generadoEn: string;
  /** Subtítulo bajo el título; por defecto marca del sistema. */
  subtitulo?: string;
}

/** Título + subtítulo + generado en negro/negrita + línea de acento (mismo criterio que auditoría). */
export function drawOperativoPdfCoverHeader(
  doc: PDFKit.PDFDocument,
  marginX: number,
  contentWidth: number,
  startY: number,
  opts: OperativoPdfCoverOpts
): number {
  const subtitulo = opts.subtitulo ?? SUBTITLE;
  let y = startY;
  doc.fillColor(PDF_BRAND.text).font('Helvetica-Bold').fontSize(16);
  doc.text(opts.titulo, marginX, y, { width: contentWidth, align: 'center' });
  y += 18;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(PDF_BRAND.text);
  doc.text(subtitulo, marginX, y, { width: contentWidth, align: 'center' });
  y += 12;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND.text);
  doc.text(`Generado: ${opts.generadoEn}`, marginX, y, { width: contentWidth, align: 'center' });
  y += 12;
  doc
    .moveTo(marginX, y)
    .lineTo(marginX + contentWidth, y)
    .strokeColor(PDF_BRAND.accent)
    .lineWidth(1)
    .stroke();
  y += 7;
  return y;
}

/** Etiqueta y valor en negro (meta de informes operativos). */
export function drawStackedMetaBlack(
  doc: PDFKit.PDFDocument,
  marginX: number,
  startY: number,
  colWidth: number,
  label: string,
  value: string
): number {
  const lineGap = 0.5;
  const indent = 10;
  const valueW = Math.max(40, colWidth - indent);
  let y = startY;
  const labelText = `${label}:`;
  const d = doc as DocWithTextMeasure;
  doc.fillColor(PDF_BRAND.text).font('Helvetica-Bold').fontSize(9);
  const hLabel = d.heightOfString(labelText, { width: colWidth, lineGap });
  doc.text(labelText, marginX, y, { width: colWidth, lineGap });
  const rawVal = String(value ?? '').trim() || '—';
  doc.fillColor(PDF_BRAND.text).font('Helvetica').fontSize(9);
  const hVal = d.heightOfString(rawVal, { width: valueW, lineGap });
  doc.text(rawVal, marginX + indent, y + hLabel + 2, { width: valueW, lineGap });
  return y + hLabel + 2 + hVal + 8;
}

/** Nombre u otro texto para PDF operativo: sin comas, espacios normalizados. */
export function textoMetaSinComas(text: string): string {
  return String(text ?? '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Una o más líneas: **Etiqueta:** valor (misma línea; el valor puede pasar a líneas siguientes al ancho `contentWidth`).
 */
export function drawInlineMetaBlack(
  doc: PDFKit.PDFDocument,
  marginX: number,
  startY: number,
  contentWidth: number,
  label: string,
  value: string
): number {
  const lineGap = 2;
  const rawVal = String(value ?? '').trim() || '—';
  const labelPart = `${String(label).trim()}: `;
  doc.fillColor(PDF_BRAND.text).font('Helvetica-Bold').fontSize(9);
  doc.text(labelPart, marginX, startY, { lineGap, continued: true });
  const xAfterLabel = doc.x;
  const valueWidth = Math.max(36, marginX + contentWidth - xAfterLabel);
  doc.font('Helvetica').fontSize(9).fillColor(PDF_BRAND.text);
  doc.text(rawVal, { width: valueWidth, lineGap });
  return doc.y + 6;
}

/** Dos columnas meta en negro (~44 % + resto). */
export function drawTwoColumnMetaBlack(
  doc: PDFKit.PDFDocument,
  marginX: number,
  startY: number,
  contentWidth: number,
  left: { label: string; value: string },
  right: { label: string; value: string }
): number {
  const metaGutter = 10;
  let leftW = Math.floor(contentWidth * 0.44);
  leftW = Math.min(leftW, contentWidth - metaGutter - 220);
  leftW = Math.max(220, leftW);
  const rightW = contentWidth - leftW - metaGutter;
  const xRight = marginX + leftW + metaGutter;
  const yL = drawStackedMetaBlack(doc, marginX, startY, leftW, left.label, left.value);
  const yR = drawStackedMetaBlack(doc, xRight, startY, rightW, right.label, right.value);
  return Math.max(yL, yR) + 4;
}

export interface ReportCoverCenteredOpts {
  title: string;
  generadoEn: string;
}

/** Título + subtítulo + generado + línea horizontal (ancho alineado a `width`, típ. ancho tabla 594). */
export function drawReportCoverCentered(
  doc: PDFKit.PDFDocument,
  x: number,
  width: number,
  startY: number,
  opts: ReportCoverCenteredOpts
): number {
  let y = startY;
  doc.fillColor(PDF_BRAND.text).font('Helvetica-Bold').fontSize(16);
  doc.text(opts.title, x, y, { width, align: 'center' });
  y += 18;
  doc.font('Helvetica').fontSize(10).fillColor(PDF_BRAND.muted);
  doc.text(SUBTITLE, x, y, { width, align: 'center' });
  y += 12;
  doc.fontSize(9).text(`Generado: ${opts.generadoEn}`, x, y, { width, align: 'center' });
  y += 12;
  doc.moveTo(x, y).lineTo(x + width, y).strokeColor(PDF_BRAND.accent).lineWidth(1).stroke();
  y += 7;
  return y;
}

export interface MetaColumnPair {
  label: string;
  value: string;
}

/** Dos bloques etiqueta/valor como en auditoría (~44 % izquierda + resto). */
export function drawTwoColumnMeta44Split(
  doc: PDFKit.PDFDocument,
  marginX: number,
  startY: number,
  contentWidth: number,
  left: MetaColumnPair,
  right: MetaColumnPair
): number {
  const metaGutter = 10;
  let leftW = Math.floor(contentWidth * 0.44);
  leftW = Math.min(leftW, contentWidth - metaGutter - 220);
  leftW = Math.max(220, leftW);
  const rightW = contentWidth - leftW - metaGutter;
  const xRight = marginX + leftW + metaGutter;
  const yL = drawStackedLabelValue(doc, marginX, startY, leftW, left.label, left.value);
  const yR = drawStackedLabelValue(doc, xRight, startY, rightW, right.label, right.value);
  return Math.max(yL, yR) + 4;
}

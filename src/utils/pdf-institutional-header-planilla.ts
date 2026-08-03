import fs from 'fs';
import PDFKit from 'pdfkit';
import { PDF_LOGO_PATH } from './pdf-assets';

/**
 * Encabezado institucional alineado al de la planilla PDF legal (banner, lema, LEY 3.688/08, misión).
 * Centralizado para reutilizar en informes. Planilla legal e informes comparten el mismo margen superior
 * (`PDF_INSTITUTIONAL_HEADER_TOP`); `PDF_INSTITUTIONAL_HEADER_TOP_REPORTS` es alias para no romper imports.
 */

/**
 * Distancia desde el borde superior de la página al inicio del bloque institucional (logo).
 * Misma altura en planilla legal y en el resto de PDFs del sistema.
 */
export const PDF_INSTITUTIONAL_HEADER_TOP = 24;

/** Mismo valor que `PDF_INSTITUTIONAL_HEADER_TOP` (imports existentes en informes). */
export const PDF_INSTITUTIONAL_HEADER_TOP_REPORTS = PDF_INSTITUTIONAL_HEADER_TOP;

/** Misma proporción que en planilla legal (331×59). */
const BANNER_W = 150;
const BANNER_H = Math.round((BANNER_W * 59) / 331);

/** Ancho del bloque de misión alineado a la tabla de la planilla (594 pt). */
export const PLANILLA_TABLE_STATIC_WIDTH = 594;

export function planillaTableContentX(pageWidth: number): number {
  return Math.round((pageWidth - PLANILLA_TABLE_STATIC_WIDTH) / 2);
}

export interface InstitutionalHeaderPlanillaResult {
  /** Y donde la planilla legal empieza la fila FACULTAD (tras el bloque misión). */
  rowFacultadY: number;
  tableX: number;
  tableW: number;
}

/**
 * Dibuja logo centrado, lema, ley y misión como en la planilla legal.
 * @param marginTop distancia desde el borde superior de la página (p. ej. `PDF_INSTITUTIONAL_HEADER_TOP`).
 */
export function drawInstitutionalHeaderPlanillaLegal(
  doc: PDFKit.PDFDocument,
  pageWidth: number,
  marginTop: number
): InstitutionalHeaderPlanillaResult {
  const bannerX = pageWidth / 2 - BANNER_W / 2;
  const bannerY = marginTop;

  if (fs.existsSync(PDF_LOGO_PATH)) {
    doc.image(PDF_LOGO_PATH, bannerX, bannerY, { width: BANNER_W, height: BANNER_H });
  } else {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
      .text('UNIVERSIDAD NIHON GAKKO', 0, bannerY + 12, { width: pageWidth, align: 'center' });
  }

  const afterBanner = bannerY + BANNER_H + 4;
  doc.font('Helvetica-BoldOblique').fontSize(10).fillColor('#000')
    .text('"ESFUERZO Y DISCIPLINA PARA EL ÉXITO"', 0, afterBanner, { width: pageWidth, align: 'center' });

  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#000')
    .text('LEY 3.688/08', 0, afterBanner + 14, { width: pageWidth, align: 'center' });

  const misionY = afterBanner + 27;
  const tableX = planillaTableContentX(pageWidth);
  const tableW = PLANILLA_TABLE_STATIC_WIDTH;

  doc.font('Helvetica-Oblique').fontSize(6.2).fillColor('#000')
    .text(
      'Mision : Es una instituciòn educativa de gestion privada, con capital humano altamente calificado y comprometida en ofrecer una educación integral de calidad, en todos los niveles educativos, inspirada en la cultura propia y universal, basada en los valores humanos, la investigación científica, el servicio a la comunidad, el desarrollo artístico y cultural, para la formación de ciudadanos socialmente responsables.',
      tableX,
      misionY,
      { width: tableW, align: 'left', lineGap: 0 }
    );

  const rowFacultadY = misionY + 16;
  return { rowFacultadY, tableX, tableW };
}

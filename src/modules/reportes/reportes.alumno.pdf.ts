import PDFDocument from 'pdfkit';
import {
  drawInstitutionalHeaderPlanillaLegal,
  PDF_INSTITUTIONAL_HEADER_TOP_REPORTS,
} from '../../utils/pdf-institutional-header-planilla';
import { renderPdfDocumentToBuffer } from '../../utils/pdf-buffer';
import {
  PDF_BRAND,
  PDF_BRAND_MARGIN,
  PDF_FOOTER_RESERVED,
  drawFooter,
  drawModernTableHeader,
  drawModernTableRowWrapped,
  drawSectionTitle,
  measureModernTableRowWrappedHeight,
  formatGeneradoParaguay,
  type ModernTableColumn,
} from '../../utils/pdf-kit-brand';
import { drawInlineMetaBlack, drawOperativoPdfCoverHeader } from '../../utils/pdf-report-cover';

interface TrayectoriaPdfItem {
  periodo: string;
  facultad: string;
  carrera: string;
  materia: string;
  estadoAcademico: string;
  porcentajeAsistencia: number;
  faltasAcumuladas: number;
  justificacionesAprobadas: number;
}

interface InformeAlumnoPdfData {
  alumno: {
    id: string;
    nombreCompleto: string;
    numeroDocumento: string;
    facultadReferenciaNombre?: string | null;
    carreraReferenciaNombre?: string | null;
    /** Semestre curricular institucional (1–10). */
    semestreCurricular?: number;
    /** Año de ingreso / cohorte institucional. */
    cohorteAnio?: number | null;
  };
  resumen: {
    totalMatriculas: number;
    activas: number;
    totalAusencias: number;
    totalJustificadas: number;
    promedioPorcentajeAsistenciaMaterias: number;
    anioPromedioAsistencia: number;
    materiasPromedioAnio: number;
  };
  trayectoria: TrayectoriaPdfItem[];
  generadoEn: string;
}

const TABLE_HEADER_ROW_HEIGHT = 22;
const TABLE_ROW_MIN_HEIGHT = 22;

/** Columnas de una línea; Carrera (y facultad/materia) pueden usar varias líneas. */
const ELLIPSIS_COLUMN_KEYS = new Set([
  'periodo',
  'estadoAcademico',
  'porcentajeAsistencia',
  'faltasAcumuladas',
  'justificacionesAprobadas',
]);

function etiquetaEstadoAcademicoPdf(estado: string): string {
  const e = String(estado ?? '').trim().toLowerCase();
  if (e === 'irregular' || e === 'libre') return 'Irregular';
  if (e === 'en_riesgo') return 'En riesgo';
  if (e === 'regular') return 'Regular';
  return String(estado ?? '').trim() || '—';
}

const COLUMNS: ModernTableColumn[] = [
  { key: 'periodo', label: 'Periodo', width: 56, align: 'left' },
  { key: 'facultad', label: 'Facultad', width: 196, align: 'left' },
  { key: 'carrera', label: 'Carrera', width: 120, align: 'left' },
  { key: 'materia', label: 'Materia', width: 150, align: 'left' },
  { key: 'estadoAcademico', label: 'Estado', width: 72, align: 'center' },
  { key: 'porcentajeAsistencia', label: '% Asist.', width: 64, align: 'center' },
  { key: 'faltasAcumuladas', label: 'Faltas', width: 48, align: 'center' },
  { key: 'justificacionesAprobadas', label: 'Justif.', width: 56, align: 'center' },
];

export async function generarInformeAlumnoPdf(data: InformeAlumnoPdfData): Promise<Buffer> {
  return renderPdfDocumentToBuffer(
    (doc) => {
    const margin = PDF_BRAND_MARGIN;
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const contentW = pageW - margin * 2;
    const bottomLimit = pageH - margin - PDF_FOOTER_RESERVED;

    const inst = drawInstitutionalHeaderPlanillaLegal(doc, pageW, PDF_INSTITUTIONAL_HEADER_TOP_REPORTS);
    let y = drawOperativoPdfCoverHeader(doc, margin, contentW, inst.rowFacultadY + 4, {
      titulo: 'INFORME INDIVIDUAL DE ALUMNO',
      generadoEn: formatGeneradoParaguay(data.generadoEn),
    });

    const nombrePdf = String(data.alumno.nombreCompleto ?? '').trim() || '—';
    y = drawInlineMetaBlack(doc, margin, y, contentW, 'Alumno', nombrePdf);
    y = drawInlineMetaBlack(doc, margin, y, contentW, 'CI', data.alumno.numeroDocumento);
    if (data.alumno.facultadReferenciaNombre) {
      y = drawInlineMetaBlack(doc, margin, y, contentW, 'Facultad', data.alumno.facultadReferenciaNombre);
    }
    if (data.alumno.carreraReferenciaNombre) {
      y = drawInlineMetaBlack(doc, margin, y, contentW, 'Carrera', data.alumno.carreraReferenciaNombre);
    }
    const sem = data.alumno.semestreCurricular;
    if (sem != null && Number.isFinite(sem) && sem >= 1 && sem <= 10) {
      y = drawInlineMetaBlack(doc, margin, y, contentW, 'Semestre curricular', `${Math.trunc(sem)}°`);
    }
    const cohorte = data.alumno.cohorteAnio;
    if (cohorte != null && Number.isFinite(cohorte)) {
      y = drawInlineMetaBlack(doc, margin, y, contentW, 'Año ingreso', String(cohorte));
    }
    const resumenTxt = `Matrículas ${data.resumen.totalMatriculas} | Activas ${data.resumen.activas} | Ausencias ${data.resumen.totalAusencias} | Justificadas ${data.resumen.totalJustificadas}`;
    y = drawInlineMetaBlack(doc, margin, y, contentW, 'Resumen', resumenTxt);

    y = drawSectionTitle(doc, margin, y, contentW, 'Trayectoria');

    const wrappedOpts = { ellipsisColumnKeys: ELLIPSIS_COLUMN_KEYS };

    const drawTableHeaderAt = (yy: number) =>
      drawModernTableHeader(doc, margin, yy, COLUMNS, TABLE_HEADER_ROW_HEIGHT, 'print');
    y = drawTableHeaderAt(y);

    let idx = 0;
    for (const row of data.trayectoria) {
      const rec: Record<string, string> = {
        periodo: row.periodo,
        facultad: row.facultad,
        carrera: row.carrera,
        materia: row.materia,
        estadoAcademico: etiquetaEstadoAcademicoPdf(row.estadoAcademico),
        porcentajeAsistencia: `${row.porcentajeAsistencia.toFixed(1)}%`,
        faltasAcumuladas: String(row.faltasAcumuladas),
        justificacionesAprobadas: String(row.justificacionesAprobadas),
      };
      const rowH = measureModernTableRowWrappedHeight(doc, COLUMNS, rec, TABLE_ROW_MIN_HEIGHT, wrappedOpts);
      if (y + rowH > bottomLimit) {
        doc.addPage();
        y = margin;
        y = drawTableHeaderAt(y);
      }
      drawModernTableRowWrapped(doc, margin, y, COLUMNS, rec, rowH, idx % 2 === 1, undefined, wrappedOpts);
      y += rowH;
      idx += 1;
    }

    const nMat = data.resumen.materiasPromedioAnio;
    const anioProm = data.resumen.anioPromedioAsistencia;
    const promBoxH = 30;
    const gapBeforeProm = 12;
    if (nMat > 0) {
      if (y + gapBeforeProm + promBoxH > bottomLimit) {
        doc.addPage();
        y = margin;
      } else {
        y += gapBeforeProm;
      }
      const promPct = data.resumen.promedioPorcentajeAsistenciaMaterias;
      const innerX = margin + 14;
      const rightPad = margin + contentW - 12;
      const pctColW = 86;
      const splitX = rightPad - pctColW;

      doc.rect(margin, y, 3, promBoxH).fill(PDF_BRAND.accent);

      const titleText = `Promedio de Asistencia ${anioProm}`;
      doc.fillColor(PDF_BRAND.text).font('Helvetica-Bold').fontSize(11.5);
      const midY = y + promBoxH / 2;
      doc.text(titleText, innerX, midY, {
        width: Math.max(120, splitX - innerX - 8),
        lineBreak: false,
        baseline: 'middle',
      });

      const fsPct = 14;
      doc.fillColor(PDF_BRAND.text).font('Helvetica-Bold').fontSize(fsPct);
      doc.text(`${promPct.toFixed(1)}%`, splitX, midY, {
        width: pctColW,
        align: 'right',
        lineBreak: false,
        baseline: 'middle',
      });
      y += promBoxH;
    }

    const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        drawFooter(doc, margin, pageH - margin - 8, contentW, {
          pageIndex: i,
          pageTotal: range.count,
        });
      }
    },
    {
      size: 'A4',
      layout: 'landscape',
      margin: 0,
      bufferPages: true,
      info: {
        Title: `Informe alumno - ${data.alumno.nombreCompleto}`,
        Author: 'Sistema de control de asistencia',
      },
    }
  );
}

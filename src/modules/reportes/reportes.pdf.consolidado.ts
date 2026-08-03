import PDFDocument from 'pdfkit';
import {
  drawInstitutionalHeaderPlanillaLegal,
  PDF_INSTITUTIONAL_HEADER_TOP_REPORTS,
} from '../../utils/pdf-institutional-header-planilla';
import { renderPdfDocumentToBuffer } from '../../utils/pdf-buffer';
import {
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

interface ConsolidadoFilaPdf {
  periodo: string;
  facultad: string;
  carrera: string;
  semestre: number;
  materia: string;
  alumno: string;
  documento: string;
  porcentajeAsistencia: number;
  faltasAcumuladas: number;
  estadoConsolidado: 'INHABILITADO';
}

interface ConsolidadoPdfData {
  periodo: string;
  total: number;
  totalInhabilitados: number;
  filas: ConsolidadoFilaPdf[];
}

const TABLE_HEADER_ROW_HEIGHT = 20;
const TABLE_ROW_MIN_HEIGHT = 18;

/** Mismas columnas y proporciones que la tabla en ReportesPage (sin columna Estado). */
const COLUMN_LAYOUT: Array<Pick<ModernTableColumn, 'key' | 'label' | 'align'> & { weight: number }> = [
  { key: 'periodo', label: 'Periodo', weight: 7 },
  { key: 'facultad', label: 'Facultad', weight: 20 },
  { key: 'carrera', label: 'Carrera', weight: 15 },
  { key: 'semestre', label: 'Semestre', align: 'center', weight: 7 },
  { key: 'materia', label: 'Materia', weight: 12 },
  { key: 'alumno', label: 'Alumno', weight: 15 },
  { key: 'documento', label: 'CI', weight: 10 },
  { key: 'porcentajeAsistencia', label: '% Asist.', align: 'center', weight: 8 },
  { key: 'faltasAcumuladas', label: 'Faltas', align: 'center', weight: 6 },
];

const WEIGHT_TOTAL = COLUMN_LAYOUT.reduce((s, c) => s + c.weight, 0);

function buildColumnsLikeReportesPage(contentW: number): ModernTableColumn[] {
  const widths = COLUMN_LAYOUT.map((col) =>
    Math.max(28, Math.round((contentW * col.weight) / WEIGHT_TOTAL))
  );
  let delta = contentW - widths.reduce((a, b) => a + b, 0);
  let i = 0;
  const growOrder = [1, 5, 2, 4, 0, 6, 3, 7, 8]; // facultad, alumno, carrera, materia…
  while (delta !== 0 && i < 500) {
    const idx = growOrder[i % growOrder.length];
    widths[idx] += delta > 0 ? 1 : -1;
    delta += delta > 0 ? -1 : 1;
    i += 1;
  }
  return COLUMN_LAYOUT.map((col, idx) => ({
    key: col.key,
    label: col.label,
    width: widths[idx],
    align: col.align,
  }));
}

function filaToRecord(row: ConsolidadoFilaPdf): Record<string, string> {
  return {
    periodo: row.periodo,
    facultad: row.facultad,
    carrera: row.carrera,
    semestre: row.semestre > 0 ? `${row.semestre}°` : '—',
    materia: row.materia,
    alumno: row.alumno,
    documento: row.documento || '—',
    porcentajeAsistencia: `${row.porcentajeAsistencia.toFixed(1)}%`,
    faltasAcumuladas: String(row.faltasAcumuladas),
  };
}

export async function generarConsolidadoRiesgoPdf(data: ConsolidadoPdfData): Promise<Buffer> {
  return renderPdfDocumentToBuffer(
    (doc) => {
    const margin = PDF_BRAND_MARGIN;
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const contentW = pageW - margin * 2;
    const bottomLimit = pageH - margin - PDF_FOOTER_RESERVED;

    const inst = drawInstitutionalHeaderPlanillaLegal(doc, pageW, PDF_INSTITUTIONAL_HEADER_TOP_REPORTS);
    let y = drawOperativoPdfCoverHeader(doc, margin, contentW, inst.rowFacultadY + 4, {
      titulo: 'REPORTE CONSOLIDADO DE INHABILITADOS',
      generadoEn: formatGeneradoParaguay(new Date()),
    });

    const totalesTxt = `Total inhabilitados: ${data.totalInhabilitados}`;
    y = drawInlineMetaBlack(doc, margin, y, contentW, 'Periodo', data.periodo);
    y = drawInlineMetaBlack(doc, margin, y, contentW, 'Totales', totalesTxt);

    y = drawSectionTitle(doc, margin, y, contentW, 'Detalle');

    const columns = buildColumnsLikeReportesPage(contentW);
    const tableRows = data.filas.map(filaToRecord);

    const drawTableHeaderAt = (yy: number) =>
      drawModernTableHeader(doc, margin, yy, columns, TABLE_HEADER_ROW_HEIGHT, 'print');
    y = drawTableHeaderAt(y);

    let idx = 0;
    for (const rec of tableRows) {
      const rowH = measureModernTableRowWrappedHeight(doc, columns, rec, TABLE_ROW_MIN_HEIGHT);
      if (y + rowH > bottomLimit) {
        doc.addPage();
        y = margin;
        y = drawTableHeaderAt(y);
      }
      drawModernTableRowWrapped(doc, margin, y, columns, rec, rowH, idx % 2 === 1);
      y += rowH;
      idx += 1;
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
        Title: `Consolidado inhabilitados ${data.periodo}`,
        Author: 'Sistema de Gesti�n de Asistencia Acad�mica',
      },
    }
  );
}

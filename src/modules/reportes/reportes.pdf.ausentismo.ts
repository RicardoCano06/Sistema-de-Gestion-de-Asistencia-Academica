import PDFDocument from 'pdfkit';
import {
  drawInstitutionalHeaderPlanillaLegal,
  PDF_INSTITUTIONAL_HEADER_TOP_REPORTS,
} from '../../utils/pdf-institutional-header-planilla';
import { renderPdfDocumentToBuffer } from '../../utils/pdf-buffer';
import {
  PDF_BRAND_MARGIN,
  PDF_FOOTER_RESERVED,
  buildContentFitTableColumns,
  drawFooter,
  drawModernTableHeader,
  drawModernTableRowWrapped,
  drawSectionTitle,
  measureModernTableRowWrappedHeight,
  formatGeneradoParaguay,
  type ContentFitColumnDef,
  type ModernTableColumn,
} from '../../utils/pdf-kit-brand';
import { drawInlineMetaBlack, drawOperativoPdfCoverHeader } from '../../utils/pdf-report-cover';

interface AusentismoFilaPdf {
  facultad: string;
  carrera: string;
  totalCursos: number;
  totalSesiones: number;
  totalFaltas: number;
  promedioAusentismo: number;
  promedioAsistencia: number;
  nivel: string;
}

interface AusentismoResumenPdf {
  totalCarreras: number;
  totalCursos: number;
  totalSesiones: number;
  totalFaltas: number;
  promedioAusentismo: number;
  promedioAsistencia: number;
}

interface AusentismoPdfData {
  periodo: string;
  /** Solo alcance geográfico/institucional (sin repetir el periodo). */
  alcance: string;
  resumen: AusentismoResumenPdf;
  filas: AusentismoFilaPdf[];
}

const TABLE_HEADER_ROW_HEIGHT = 22;
const TABLE_ROW_MIN_HEIGHT = 18;

function formatResumenAusentismoLinea(resumen: AusentismoResumenPdf): string {
  const partes = [
    `${resumen.totalCarreras} carrera${resumen.totalCarreras === 1 ? '' : 's'}`,
    `${resumen.totalCursos} curso${resumen.totalCursos === 1 ? '' : 's'}`,
    `${resumen.promedioAusentismo.toFixed(1)} % de ausentismo (promedio)`,
    `${resumen.totalFaltas} falta${resumen.totalFaltas === 1 ? '' : 's'} totales`,
  ];
  return partes.join('; ');
}

/** Mismas columnas que la tabla en ReportesPage; mínimos evitan encabezados/celdas superpuestos. */
const CONTENT_FIT_DEFS: ContentFitColumnDef[] = [
  { key: 'facultad', label: 'Facultad', minWidth: 140, maxWidth: 300, shrinkResistance: 9 },
  { key: 'carrera', label: 'Carrera', minWidth: 120, maxWidth: 240, shrinkResistance: 8 },
  { key: 'totalCursos', label: 'Cursos', align: 'center', minWidth: 46, maxWidth: 54, shrinkResistance: 2 },
  { key: 'promedioAusentismo', label: '% Ausentismo', align: 'center', minWidth: 80, maxWidth: 92, shrinkResistance: 4 },
  { key: 'promedioAsistencia', label: '% Asistencia', align: 'center', minWidth: 80, maxWidth: 92, shrinkResistance: 4 },
  { key: 'nivel', label: 'Nivel', align: 'center', minWidth: 84, maxWidth: 108, shrinkResistance: 5 },
];

const ELLIPSIS_COLUMN_KEYS = new Set([
  'totalCursos',
  'promedioAusentismo',
  'promedioAsistencia',
  'nivel',
]);

function filaToRecord(row: AusentismoFilaPdf): Record<string, string> {
  return {
    facultad: row.facultad,
    carrera: row.carrera,
    totalCursos: String(row.totalCursos),
    promedioAusentismo: `${row.promedioAusentismo.toFixed(1)}%`,
    promedioAsistencia: `${row.promedioAsistencia.toFixed(1)}%`,
    nivel: row.nivel,
  };
}

export async function generarPdfAusentismoFacultadCarrera(data: AusentismoPdfData): Promise<Buffer> {
  return renderPdfDocumentToBuffer(
    (doc) => {
    const margin = PDF_BRAND_MARGIN;
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const contentW = pageW - margin * 2;
    const bottomLimit = pageH - margin - PDF_FOOTER_RESERVED;

    const inst = drawInstitutionalHeaderPlanillaLegal(doc, pageW, PDF_INSTITUTIONAL_HEADER_TOP_REPORTS);
    let y = drawOperativoPdfCoverHeader(doc, margin, contentW, inst.rowFacultadY + 4, {
      titulo: 'ESTADÍSTICAS DE AUSENTISMO POR FACULTAD / CARRERA',
      generadoEn: formatGeneradoParaguay(new Date()),
    });

    y = drawInlineMetaBlack(doc, margin, y, contentW, 'Periodo', data.periodo);
    y = drawInlineMetaBlack(doc, margin, y, contentW, 'Alcance', data.alcance || '—');
    y = drawInlineMetaBlack(
      doc,
      margin,
      y,
      contentW,
      'Resumen',
      formatResumenAusentismoLinea(data.resumen)
    );

    y = drawSectionTitle(doc, margin, y, contentW, 'Por facultad y carrera');

    const tableRows = data.filas.map(filaToRecord);
    const columns: ModernTableColumn[] = buildContentFitTableColumns(
      doc,
      CONTENT_FIT_DEFS,
      tableRows,
      contentW
    );
    const wrappedOpts = { ellipsisColumnKeys: ELLIPSIS_COLUMN_KEYS };

    const drawTableHeaderAt = (yy: number) =>
      drawModernTableHeader(doc, margin, yy, columns, TABLE_HEADER_ROW_HEIGHT, 'print');
    y = drawTableHeaderAt(y);

    let idx = 0;
    for (const rec of tableRows) {
      const rowH = measureModernTableRowWrappedHeight(doc, columns, rec, TABLE_ROW_MIN_HEIGHT, wrappedOpts);
      if (y + rowH > bottomLimit) {
        doc.addPage();
        y = margin;
        y = drawTableHeaderAt(y);
      }
      drawModernTableRowWrapped(doc, margin, y, columns, rec, rowH, idx % 2 === 1, undefined, wrappedOpts);
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
        Title: `Ausentismo por facultad/carrera ${data.periodo}`,
        Author: 'Sistema de Gesti�n de Asistencia Acad�mica',
      },
    }
  );
}

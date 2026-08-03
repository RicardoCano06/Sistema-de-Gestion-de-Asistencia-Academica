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
  formatFechaHoraCompactaParaguay,
  measureModernTableRowWrappedHeight,
  type ContentFitColumnDef,
  type ModernTableColumn,
} from '../../utils/pdf-kit-brand';
import { etiquetaAccionAuditoria } from '../../utils/auditoria-accion-label';
import { drawOperativoPdfCoverHeader, drawTwoColumnMetaBlack } from '../../utils/pdf-report-cover';

interface EventoAuditoriaPdf {
  /** ISO u otro valor parseable por `Date` (se formatea en PDF como DD/MM/AAAA, HH:mm). */
  fecha_hora: string;
  actor: string;
  modulo: string;
  accion: string;
  recurso: string;
  resultado: 'ok' | 'error';
}

export interface ExportAuditoriaPdfData {
  titulo: string;
  filtros: string;
  /** Total de filas que cumplen el filtro (puede ser mayor que las filas exportadas). */
  total: number;
  generadoEn: string;
  eventos: EventoAuditoriaPdf[];
  /** Máximo de filas permitidas en esta exportación (p. ej. 500). */
  capExportacion: number;
  exportedBy?: string;
  requestId?: string;
}

const TABLE_HEADER_ROW_HEIGHT = 20;
const TABLE_ROW_MIN_HEIGHT = 20;

/**
 * Proporciones como AuditoriaPage: Fecha/Actor/Módulo/Resultado compactos;
 * Acción y Recurso ocupan el resto (colgroup w-[1%] … auto auto … w-[1%]).
 */
const CONTENT_FIT_DEFS: ContentFitColumnDef[] = [
  { key: 'fecha_hora', label: 'Fecha', minWidth: 86, maxWidth: 98, shrinkResistance: 2 },
  { key: 'actor', label: 'Actor', minWidth: 115, maxWidth: 240, shrinkResistance: 7 },
  { key: 'modulo', label: 'Módulo', minWidth: 82, maxWidth: 96, shrinkResistance: 3 },
  { key: 'accion', label: 'Acción', minWidth: 130, maxWidth: 400, shrinkResistance: 9 },
  { key: 'recurso', label: 'Recurso', minWidth: 150, maxWidth: 420, shrinkResistance: 9 },
  { key: 'resultado', label: 'Resultado', minWidth: 58, maxWidth: 72, shrinkResistance: 2 },
];

/** Una sola línea con recorte; Actor y Acción/Recurso permiten salto de línea. */
const ELLIPSIS_COLUMN_KEYS = new Set(['fecha_hora', 'modulo', 'resultado']);

/** Convierte el resumen `clave=valor | …` del servicio en texto legible para el PDF. */
function humanizarFiltrosAuditoria(filtros: string): string {
  if (!filtros || filtros === 'sin filtros') return filtros;
  return filtros
    .split(' | ')
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq === -1) return part;
      const key = part.slice(0, eq).trim();
      const raw = part.slice(eq + 1).trim();
      if (key === 'desde' || key === 'hasta') {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) {
          const etiqueta = key === 'desde' ? 'Desde' : 'Hasta';
          const txt = formatFechaHoraCompactaParaguay(d);
          return `${etiqueta}: ${txt}`;
        }
      }
      const titulo =
        (
          {
            modulo: 'Módulo',
            accion: 'Acción',
            resultado: 'Resultado',
            q: 'Búsqueda',
          } as Record<string, string>
        )[key] ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      return `${titulo}: ${raw}`;
    })
    .join('\n');
}

function eventoToRecord(item: EventoAuditoriaPdf): Record<string, string> {
  return {
    fecha_hora: formatFechaHoraCompactaParaguay(item.fecha_hora),
    actor: item.actor,
    modulo: item.modulo,
    accion: etiquetaAccionAuditoria(item.accion),
    recurso: item.recurso,
    resultado: item.resultado.toUpperCase(),
  };
}

export async function generarAuditoriaEventosPdf(data: ExportAuditoriaPdfData): Promise<Buffer> {
  return renderPdfDocumentToBuffer(
    (doc) => {
      const margin = PDF_BRAND_MARGIN;
      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const contentW = pageW - margin * 2;
      const bottomLimit = pageH - margin - PDF_FOOTER_RESERVED;

      const inst = drawInstitutionalHeaderPlanillaLegal(doc, pageW, PDF_INSTITUTIONAL_HEADER_TOP_REPORTS);
      let y = drawOperativoPdfCoverHeader(doc, margin, contentW, inst.rowFacultadY + 4, {
        titulo: data.titulo,
        generadoEn: data.generadoEn,
      });

      const filasEnPdf = data.eventos.length;
      const alcanceExporte =
        filasEnPdf === data.total
          ? `${data.total} eventos; todos incluidos en este PDF (máx. ${data.capExportacion} filas por archivo).`
          : `${data.total} eventos que coinciden con el filtro; en este PDF se listan ${filasEnPdf} (máx. ${data.capExportacion} filas por archivo).`;

      const filtrosTxt = humanizarFiltrosAuditoria(data.filtros);
      y = drawTwoColumnMetaBlack(
        doc,
        margin,
        y,
        contentW,
        { label: 'Filtros aplicados', value: filtrosTxt },
        { label: 'Alcance del exporte', value: alcanceExporte }
      );

      const tableRows = data.eventos.map(eventoToRecord);
      const columns: ModernTableColumn[] = buildContentFitTableColumns(
        doc,
        CONTENT_FIT_DEFS,
        tableRows,
        contentW
      );
      const wrappedOpts = { ellipsisColumnKeys: ELLIPSIS_COLUMN_KEYS };

      const drawTableHeaderAt = (yy: number) =>
        drawModernTableHeader(doc, margin, yy, columns, TABLE_HEADER_ROW_HEIGHT, 'print');

      y += 4;
      y = drawTableHeaderAt(y);

      let idx = 0;
      for (const row of tableRows) {
        const rowH = measureModernTableRowWrappedHeight(doc, columns, row, TABLE_ROW_MIN_HEIGHT, wrappedOpts);
        if (y + rowH > bottomLimit) {
          doc.addPage();
          y = margin;
          y = drawTableHeaderAt(y);
        }
        drawModernTableRowWrapped(doc, margin, y, columns, row, rowH, idx % 2 === 1, undefined, wrappedOpts);
        y += rowH;
        idx += 1;
      }

      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        drawFooter(doc, margin, pageH - margin - 8, contentW, {
          pageIndex: i,
          pageTotal: range.count,
          exportedBy: data.exportedBy,
          requestId: data.requestId,
        });
      }
    },
    {
      size: 'A4',
      layout: 'landscape',
      margin: 0,
      bufferPages: true,
      info: {
        Title: data.titulo,
        Author: 'Sistema de Gesti�n de Asistencia Acad�mica',
      },
    }
  );
}

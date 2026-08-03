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
  drawModernTableRow,
  drawStackedLabelValue,
  drawSectionTitle,
  formatGeneradoParaguay,
  type ModernTableColumn,
} from '../../utils/pdf-kit-brand';
import { drawOperativoPdfCoverHeader } from '../../utils/pdf-report-cover';

interface ActaHabilitadosAlumno {
  orden: number;
  alumno: string;
  documento: string;
  porcentajeFinal: number;
  estado: 'HABILITADO' | 'NO HABILITADO';
}

interface ActaHabilitadosData {
  periodo: string;
  cursoId: number;
  materia: string;
  docente: string;
  carrera: string;
  facultad: string;
  semestre: number;
  alumnos: ActaHabilitadosAlumno[];
  resumen: {
    total: number;
    habilitados: number;
    noHabilitados: number;
  };
}

const ROW_HEIGHT = 22;

const COLUMNS: ModernTableColumn[] = [
  { key: 'orden', label: '#', width: 38, align: 'center' },
  { key: 'alumno', label: 'Alumno', width: 310, align: 'left' },
  { key: 'documento', label: 'Documento', width: 122, align: 'left' },
  { key: 'porcentajeFinal', label: '% Asistencia', width: 112, align: 'center' },
  { key: 'estado', label: 'Estado', width: 180, align: 'center' },
];

function formatPeriodo(periodo: string): string {
  const [anio, mes] = periodo.split('-').map(Number);
  const mesTxt = new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(anio, (mes || 1) - 1, 1))
  );
  return `${mesTxt.toUpperCase()} ${anio}`;
}

function drawMetaGrid(
  doc: PDFKit.PDFDocument,
  marginX: number,
  startY: number,
  contentWidth: number,
  fields: Array<{ label: string; value: string }>
): number {
  const cols = 3;
  const gutter = 16;
  const colW = (contentWidth - gutter * (cols - 1)) / cols;
  let y = startY;
  for (let row = 0; row < Math.ceil(fields.length / cols); row++) {
    const rowFields = fields.slice(row * cols, row * cols + cols);
    let maxBottom = y;
    for (let c = 0; c < rowFields.length; c++) {
      const f = rowFields[c];
      const x = marginX + c * (colW + gutter);
      const bottom = drawStackedLabelValue(doc, x, y, colW, f.label, f.value);
      maxBottom = Math.max(maxBottom, bottom);
    }
    y = maxBottom;
  }
  return y;
}

export async function generarActaHabilitadosPdf(data: ActaHabilitadosData): Promise<Buffer> {
  return renderPdfDocumentToBuffer(
    (doc) => {
      const margin = PDF_BRAND_MARGIN;
      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const contentW = pageW - margin * 2;
      const bottomLimit = pageH - margin - PDF_FOOTER_RESERVED;

      const inst = drawInstitutionalHeaderPlanillaLegal(doc, pageW, PDF_INSTITUTIONAL_HEADER_TOP_REPORTS);
      let y = drawOperativoPdfCoverHeader(doc, margin, contentW, inst.rowFacultadY + 4, {
        titulo: 'ACTA DE HABILITADOS / NO HABILITADOS',
        generadoEn: formatGeneradoParaguay(new Date()),
      });

      y = drawMetaGrid(doc, margin, y, contentW, [
        { label: 'Periodo', value: formatPeriodo(data.periodo) },
        { label: 'Facultad', value: data.facultad },
        { label: 'Carrera', value: data.carrera },
        { label: 'Semestre Curricular', value: `${Math.trunc(data.semestre)}°` },
        { label: 'Materia', value: data.materia },
        { label: 'Docente', value: data.docente },
      ]);

      y = drawSectionTitle(doc, margin, y, contentW, 'Listado de alumnos');

      const drawTableHeaderAt = (yy: number) =>
        drawModernTableHeader(doc, margin, yy, COLUMNS, ROW_HEIGHT, 'print');

      y = drawTableHeaderAt(y);

      let idx = 0;
      for (const alumno of data.alumnos) {
        if (y + ROW_HEIGHT > bottomLimit) {
          doc.addPage();
          y = margin;
          y = drawTableHeaderAt(y);
        }
        const rec: Record<string, string> = {
          orden: String(alumno.orden),
          alumno: alumno.alumno,
          documento: alumno.documento,
          porcentajeFinal: `${alumno.porcentajeFinal.toFixed(2)}%`,
          estado: alumno.estado,
        };
        drawModernTableRow(doc, margin, y, COLUMNS, rec, ROW_HEIGHT, idx % 2 === 1);
        y += ROW_HEIGHT;
        idx += 1;
      }

      const summaryH = 56;
      if (y + summaryH > bottomLimit) {
        doc.addPage();
        y = margin;
      } else {
        y += 14;
      }

      doc.fillColor(PDF_BRAND.text).font('Helvetica-Bold').fontSize(10);
      doc.text(
        `Resumen: Total ${data.resumen.total} | Habilitados ${data.resumen.habilitados} | No habilitados ${data.resumen.noHabilitados}`,
        margin,
        y,
        { width: contentW }
      );
      y += 36;
      doc.font('Helvetica').fontSize(10);
      doc.text('______________________________', margin, y);
      doc.text('Firma responsable académico/a', margin, y + 14);

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
        Title: `Acta habilitados - ${data.materia}`,
        Author: 'Sistema de Gestión de Asistencia Académica',
      },
    }
  );
}

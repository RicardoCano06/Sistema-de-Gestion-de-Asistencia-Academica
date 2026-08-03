import PDFDocument from 'pdfkit';
import {
  drawInstitutionalHeaderPlanillaLegal,
  PDF_INSTITUTIONAL_HEADER_TOP,
} from '../../utils/pdf-institutional-header-planilla';
import { renderPdfDocumentToBuffer } from '../../utils/pdf-buffer';

interface SesionPdf {
  fecha: string;
  marcadorSuperior: string;
}

interface AlumnoFilaPdf {
  orden: number;
  nombre: string;
  documento: string;
  asistencias: string[];
}

interface PlanillaLegalPdfData {
  facultad: string;
  carrera: string;
  asignatura: string;
  profesor: string;
  cursoLabel: string;
  semestre: string;
  seccion: string;
  anioLectivo: string;
  mesTitulo: string;
  sesiones: SesionPdf[];
  alumnos: AlumnoFilaPdf[];
}

// Página A4 landscape
const PAGE_SIZE: [number, number] = [842, 595];
const MARGIN_TOP = 18;

// Dimensiones de columnas de la tabla
const COL_NUM = 24;
const COL_NAME = 196;   // 798 - 24 - 68 - 30*17 = 196 → tabla llena exacta
const COL_DOC = 68;
const SESSION_COL = 17;
const ROW_HEIGHT = 15;
const MIN_SESSION_COLS = 18; // máximo ~16 clases por mes + 2 de margen
const NAME_COL_FONT_SIZE = 8;
const NAME_LINE_GAP = 0.35;
const NAME_PAD_Y = 4;

// X inicial centrado: (842 - tableW) / 2
const TABLE_W_STATIC = COL_NUM + COL_NAME + COL_DOC + MIN_SESSION_COLS * SESSION_COL; // 594
const CONTENT_X = Math.round((PAGE_SIZE[0] - TABLE_W_STATIC) / 2); // 124

// Y donde empieza la tabla (después del header) — referencia de diseño
const TABLE_TOP = 164;
const FOOTER_GAP = 20;

function formatDocumentNumber(value: string): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '-';
  const reversed = digits.split('').reverse();
  const groups: string[] = [];
  for (let i = 0; i < reversed.length; i += 3) {
    groups.push(reversed.slice(i, i + 3).reverse().join(''));
  }
  return groups.reverse().join('.');
}

function measurePlanillaNombreRowHeight(doc: PDFKit.PDFDocument, nombre: string): number {
  const text = String(nombre ?? '').trim() || '—';
  doc.font('Helvetica').fontSize(NAME_COL_FONT_SIZE);
  const innerW = COL_NAME - 6;
  const h = doc.heightOfString(text, { width: innerW, lineGap: NAME_LINE_GAP });
  return Math.max(ROW_HEIGHT, Math.ceil(h + NAME_PAD_Y + 2));
}

function drawHeader(doc: PDFKit.PDFDocument, data: PlanillaLegalPdfData): number {
  const inst = drawInstitutionalHeaderPlanillaLegal(doc, PAGE_SIZE[0], PDF_INSTITUTIONAL_HEADER_TOP);
  const row0Y = inst.rowFacultadY;
  const tableX = inst.tableX;
  const tableW = inst.tableW;

  // X inicial centrado
  doc.rect(tableX, row0Y, tableW, 14).lineWidth(0.6).stroke('#000');
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000')
    .text(data.facultad.toUpperCase(), tableX, row0Y + 3, { width: tableW, align: 'center' });

  // Columna derecha (25%) ocupa las 3 filas siguientes
  const leftColW = tableW * 0.75;
  const rightColW = tableW - leftColW;
  const infoRowH = 14;
  const anioBoxH = infoRowH * 3; // 42pt

  // --- Fila CARRERA (izq 75%) ---
  const row1Y = row0Y + 14;
  doc.rect(tableX, row1Y, leftColW, infoRowH).lineWidth(0.6).stroke('#000');
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('CARRERA:', tableX + 3, row1Y + 3);
  doc.font('Helvetica').text(data.carrera, tableX + 53, row1Y + 2, { width: leftColW - 57, ellipsis: true });

  // SEMESTRE centrado en celda derecha fila 1
  doc.rect(tableX + leftColW, row1Y, rightColW, infoRowH).lineWidth(0.6).stroke('#000');
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000')
    .text('SEMESTRE: ' + data.semestre, tableX + leftColW, row1Y + 2, { width: rightColW, align: 'center' });

  // --- Fila ASIGNATURA (izq 75%) ---
  const row2Y = row1Y + infoRowH;
  doc.rect(tableX, row2Y, leftColW, infoRowH).lineWidth(0.6).stroke('#000');
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('ASIGNATURA:', tableX + 3, row2Y + 2);
  doc.font('Helvetica').text(data.asignatura, tableX + 66, row2Y + 2, { width: leftColW - 70, ellipsis: true });

  // --- Fila PROFESOR/A (izq 75%) ---
  const row3Y = row2Y + infoRowH;
  doc.rect(tableX, row3Y, leftColW, infoRowH).lineWidth(0.6).stroke('#000');
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('PROFESOR/A:', tableX + 3, row3Y + 2);
  doc.font('Helvetica').text(data.profesor, tableX + 66, row3Y + 2, { width: leftColW - 70, ellipsis: true });

  // --- AÑO: cuadro derecho que abarca filas 2 y 3 (debajo del SEMESTRE) ---
  const anioBoxY = row2Y;
  const anioBoxHAct = infoRowH * 2; // 28pt (filas ASIGNATURA + PROFESOR)
  doc.rect(tableX + leftColW, anioBoxY, rightColW, anioBoxHAct).lineWidth(0.6).stroke('#000');
  const anioTextY = anioBoxY + (anioBoxHAct / 2) - 9;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000')
    .text('AÑO:', tableX + leftColW, anioTextY, { width: rightColW, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#000')
    .text(data.anioLectivo, tableX + leftColW, anioTextY + 12, { width: rightColW, align: 'center' });

  // Retorna el Y donde empieza la tabla
  return row3Y + 14;
}

function drawTableHeader(doc: PDFKit.PDFDocument, startY: number, data: PlanillaLegalPdfData): {
  tableX: number; totalWidth: number; sessionStartX: number; sessionTableWidth: number; headerHeight: number;
} {
  const tableX = CONTENT_X;
  const nameX = tableX + COL_NUM;
  const docX = nameX + COL_NAME;
  const sessionStartX = docX + COL_DOC;
  const colCount = Math.max(data.sesiones.length, MIN_SESSION_COLS);
  const sessionTableWidth = colCount * SESSION_COL;
  const totalWidth = COL_NUM + COL_NAME + COL_DOC + sessionTableWidth;

  // Encabezado de tabla en 3 filas: banda top / marcador / día
  const row0H = 18; // "Nº", "Apellidos y Nombres", "Cédula…", "MES"
  const row1H = 14; // marcador (letra o símbolo)
  const row2H = 14; // número de día
  const totalH = row0H + row1H + row2H;

  // Borde exterior completo del header (sin relleno gris)
  doc.rect(tableX, startY, totalWidth, totalH).lineWidth(0.6).stroke('#000');

  // Líneas verticales principales (span completo totalH)
  doc.moveTo(nameX, startY).lineTo(nameX, startY + totalH).stroke();
  doc.moveTo(docX, startY).lineTo(docX, startY + totalH).stroke();
  doc.moveTo(sessionStartX, startY).lineTo(sessionStartX, startY + totalH).stroke();

  // Líneas horizontales SOLO en la zona de sesiones (no tocan Nº / Apellidos / Cédula)
  doc.moveTo(sessionStartX, startY + row0H).lineTo(tableX + totalWidth, startY + row0H).stroke();
  doc.moveTo(sessionStartX, startY + row0H + row1H).lineTo(tableX + totalWidth, startY + row0H + row1H).stroke();

  // Textos: Nº y Apellidos centrados verticalmente en totalH
  const vCenterFix = (totalH - 9) / 2 - 2;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000')
    .text('Nº', tableX, startY + vCenterFix, { width: COL_NUM, align: 'center' })
    .text('Apellidos y Nombres', nameX, startY + vCenterFix, { width: COL_NAME, align: 'center' })
    .text('Cédula de\nIdentidad Civil', docX, startY + (totalH / 2) - 10, { width: COL_DOC, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(8.5)
    .text(data.mesTitulo, sessionStartX, startY + 5, { width: sessionTableWidth, align: 'center' });

  // Columnas de sesiones
  for (let i = 0; i < colCount; i++) {
    const colX = sessionStartX + i * SESSION_COL;
    doc.moveTo(colX, startY + row0H).lineTo(colX, startY + totalH).stroke();
    if (i < data.sesiones.length) {
      doc.font('Helvetica').fontSize(9)
        .text(data.sesiones[i].marcadorSuperior, colX, startY + row0H + 2, { width: SESSION_COL, align: 'center' });
      const day = String(new Date(`${data.sesiones[i].fecha}T00:00:00`).getDate());
      doc.text(day, colX, startY + row0H + row1H + 2, { width: SESSION_COL, align: 'center' });
    }
  }
  // Borde derecho columnas
  doc.moveTo(sessionStartX + sessionTableWidth, startY + row0H).lineTo(sessionStartX + sessionTableWidth, startY + totalH).stroke();

  return { tableX, totalWidth, sessionStartX, sessionTableWidth, headerHeight: totalH };
}

function drawRows(doc: PDFKit.PDFDocument, startY: number, data: PlanillaLegalPdfData) {
  let currentY = startY;
  let rowIndex = 0;
  let isFirstPage = true;

  const tableX = CONTENT_X;
  const nameX = tableX + COL_NUM;
  const docX = nameX + COL_NAME;
  const sessionStartX = docX + COL_DOC;
  const colCount = Math.max(data.sesiones.length, MIN_SESSION_COLS);
  const sessionTableWidth = colCount * SESSION_COL;
  const totalWidth = COL_NUM + COL_NAME + COL_DOC + sessionTableWidth;
  const rowBottomLimit = PAGE_SIZE[1] - MARGIN_TOP - FOOTER_GAP;

  while (rowIndex < data.alumnos.length) {
    let bodyY: number;

    if (isFirstPage) {
      const { headerHeight } = drawTableHeader(doc, currentY, data);
      bodyY = currentY + headerHeight;
      isFirstPage = false;
    } else {
      bodyY = currentY;
      doc.moveTo(tableX, bodyY).lineTo(tableX + totalWidth, bodyY).lineWidth(0.4).stroke('#000');
    }

    let cursorY = bodyY;
    while (rowIndex < data.alumnos.length) {
      const alumno = data.alumnos[rowIndex];
      const rowH = measurePlanillaNombreRowHeight(doc, alumno.nombre);
      if (cursorY + rowH > rowBottomLimit) {
        break;
      }
      const rowBottom = cursorY + rowH;

      doc.moveTo(tableX, rowBottom).lineTo(tableX + totalWidth, rowBottom).lineWidth(0.4).stroke('#000');
      doc.moveTo(nameX, cursorY).lineTo(nameX, rowBottom).lineWidth(0.4).stroke('#000');
      doc.moveTo(docX, cursorY).lineTo(docX, rowBottom).stroke();
      doc.moveTo(sessionStartX, cursorY).lineTo(sessionStartX, rowBottom).stroke();
      doc.moveTo(tableX, cursorY).lineTo(tableX, rowBottom).stroke();
      doc.moveTo(tableX + totalWidth, cursorY).lineTo(tableX + totalWidth, rowBottom).stroke();

      const midY = cursorY + (rowH - 9) / 2 - 0.5;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000')
        .text(String(alumno.orden), tableX, midY, { width: COL_NUM, align: 'center' });
      doc.font('Helvetica').fontSize(NAME_COL_FONT_SIZE).fillColor('#000')
        .text(String(alumno.nombre ?? '').trim() || '—', nameX + 3, cursorY + 2, {
          width: COL_NAME - 6,
          lineGap: NAME_LINE_GAP,
          align: 'left',
        });
      doc.font('Helvetica').fontSize(9)
        .text(formatDocumentNumber(alumno.documento), docX + 2, midY, { width: COL_DOC - 4, align: 'center' });

      for (let i = 0; i < colCount; i++) {
        const colX = sessionStartX + i * SESSION_COL;
        doc.moveTo(colX, cursorY).lineTo(colX, rowBottom).lineWidth(0.4).stroke('#000');
        if (i < data.sesiones.length) {
          doc.font('Helvetica').fontSize(9).fillColor('#000')
            .text(alumno.asistencias[i] ?? '', colX, midY, { width: SESSION_COL, align: 'center' });
        }
      }
      doc.moveTo(sessionStartX + colCount * SESSION_COL, cursorY)
        .lineTo(sessionStartX + colCount * SESSION_COL, rowBottom)
        .lineWidth(0.4)
        .stroke('#000');

      cursorY = rowBottom;
      rowIndex++;
    }

    if (rowIndex < data.alumnos.length) {
      doc.addPage({ size: PAGE_SIZE, margin: 0 });
      currentY = MARGIN_TOP + 5;
    }
  }
}

export async function generarPlanillaLegalPdf(data: PlanillaLegalPdfData): Promise<Buffer> {
  return renderPdfDocumentToBuffer(
    (doc) => {
      const tableStartY = drawHeader(doc, data);
      drawRows(doc, tableStartY, data);
    },
    {
      size: PAGE_SIZE,
      margin: 0,
      info: {
        Title: `Planilla legal - ${data.asignatura}`,
        Author: 'Sistema de Gestión de Asistencia Académica',
      },
    }
  );
}

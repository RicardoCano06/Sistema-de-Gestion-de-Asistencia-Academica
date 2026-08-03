import { renderPdfDocumentToBuffer } from '../../utils/pdf-buffer';
import {
    drawInstitutionalHeaderPlanillaLegal,
    PDF_INSTITUTIONAL_HEADER_TOP_REPORTS,
} from '../../utils/pdf-institutional-header-planilla';
import {
    PDF_BRAND_MARGIN,
    PDF_FOOTER_RESERVED,
    drawFooter,
    drawModernTableHeader,
    drawModernTableRow,
    drawSectionTitle,
    type ModernTableColumn,
} from '../../utils/pdf-kit-brand';
import { drawOperativoPdfCoverHeader, drawStackedMetaBlack } from '../../utils/pdf-report-cover';

export interface UsuarioPdfRow {
    nombres: string;
    apellidos: string;
    email: string;
    usuario: string;
    telefono: string;
    estado: string;
    roles: string;
}

export interface ExportUsuariosPdfData {
    titulo: string;
    filtros: string;
    generadoEn: string;
    usuarios: UsuarioPdfRow[];
    exportedBy?: string;
    requestId?: string;
}

const ROW_HEIGHT = 18;

function humanizarFiltrosUsuarios(filtros: string): string {
    if (!filtros || filtros === 'sin filtros') return filtros;
    return filtros
        .split(' | ')
        .map((part) => {
            const eq = part.indexOf('=');
            if (eq === -1) return part;
            const key = part.slice(0, eq).trim();
            const raw = part.slice(eq + 1).trim();
            const titulo =
                (
                    {
                        estado: 'Estado',
                        q: 'Búsqueda',
                        rol: 'Rol exacto',
                        rolCategoria: 'Categoría de rol (vista)',
                    } as Record<string, string>
                )[key] ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
            return `${titulo}: ${raw}`;
        })
        .join('\n');
}

export async function generarListadoUsuariosPdf(data: ExportUsuariosPdfData): Promise<Buffer> {
    const columns: ModernTableColumn[] = [
        { key: 'nombres', label: 'Nombres', width: 90, align: 'left' },
        { key: 'apellidos', label: 'Apellidos', width: 95, align: 'left' },
        { key: 'email', label: 'Correo', width: 168, align: 'left' },
        { key: 'usuario', label: 'Usuario', width: 72, align: 'left' },
        { key: 'telefono', label: 'Teléfono', width: 78, align: 'left' },
        { key: 'estado', label: 'Estado', width: 58, align: 'center' },
        { key: 'roles', label: 'Roles', width: 201, align: 'left' },
    ];

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

            const filtrosTxt = humanizarFiltrosUsuarios(data.filtros);
            y = drawStackedMetaBlack(doc, margin, y, contentW, 'Filtros aplicados', filtrosTxt);
            y = drawSectionTitle(doc, margin, y, contentW, 'Usuarios');

            const drawTableHeaderAt = (yy: number) =>
                drawModernTableHeader(doc, margin, yy, columns, ROW_HEIGHT, 'print');

            y = drawTableHeaderAt(y);

            let idx = 0;
            for (const item of data.usuarios) {
                if (y + ROW_HEIGHT > bottomLimit) {
                    doc.addPage();
                    y = margin;
                    y = drawTableHeaderAt(y);
                }
                const row = {
                    nombres: item.nombres,
                    apellidos: item.apellidos,
                    email: item.email,
                    usuario: item.usuario,
                    telefono: item.telefono,
                    estado: item.estado,
                    roles: item.roles,
                };
                drawModernTableRow(doc, margin, y, columns, row, ROW_HEIGHT, idx % 2 === 1);
                y += ROW_HEIGHT;
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
                Author: 'Sistema de Gestión de Asistencia Académica',
            },
        }
    );
}

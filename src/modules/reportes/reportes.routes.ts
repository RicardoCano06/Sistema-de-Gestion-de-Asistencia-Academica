import { Router } from 'express';
import {
    obtenerChecklistCierreMensual,
    cerrarModuloMensual,
    listarAlertas,
    actualizarEstadoAlerta,
    listarResumenCursos,
    listarEstadisticasAusentismo,
    listarActas,
    crearActa,
    recalcularEstadisticaCurso,
    obtenerResumenGeneral,
    obtenerHistorialAlumnoReporte,
    listarJustificacionesAlumnoReporte,
    generarPdfInformeAlumno,
    listarConsolidadoRiesgoInhabilitados,
    generarPdfConsolidadoRiesgoInhabilitados,
    generarPdfEstadisticasAusentismoFacultadCarrera,
    listarAusentismoAgregadoFacultadCarrera,
    validarCarreraEnAlcanceFacultades,
    regenerarPdfActaGenerada,
    buildCronogramaPdfBuffer,
} from './reportes.service';
import { enviarPdfBuffer } from '../../utils/pdf-response';
import { autenticarConPoliticaAlcance, autorizarRoles, normalizarRolComparacion, normalizarRolesDesdePayload } from '../../middlewares/auth.middleware';
import {
    RBAC,
    ROLES_ADMIN_O_ACADEMICOS,
    ROLES_ALUMNOS,
    ROLES_CIERRE_MENSUAL_EJECUTAR,
    ROLES_CONSULTA_ASISTENCIAS,
    ROLES_LECTURA_DIRECCION,
    ROLES_REPORTES_OPERATIVOS
} from '../../utils/rbac';
import type { AlcanceMatriculasFacultad } from '../../utils/alumnos-scope';
import { assertCursoEnAlcance, ForbiddenScopeError, resolverAlcanceMatriculasFacultad } from '../../utils/alumnos-scope';
import { construirContextoAuditoria, registrarEventoAuditoriaSegura } from '../auditoria/auditoria.service';
import { verificarPasswordUsuarioAutenticado } from '../auth/auth.service';
import { pool } from '../../config/database';

const router = Router();

async function validarFiltrosGeograficosReportes(
    alcance: AlcanceMatriculasFacultad,
    filtros: { facultadId?: number; carreraId?: number; cursoId?: number }
): Promise<void> {
    if (alcance.tipo === 'sin_restriccion') return;
    if (alcance.tipo === 'facultades') {
        if (!alcance.facultadIds.length) {
            throw new ForbiddenScopeError(
                'Tu usuario no tiene facultades asignadas. Un administrador debe configurar tu alcance en Usuarios.'
            );
        }
        if (filtros.facultadId != null && !alcance.facultadIds.includes(filtros.facultadId)) {
            throw new ForbiddenScopeError('La facultad seleccionada no está en tu alcance.');
        }
        if (filtros.carreraId != null) {
            await validarCarreraEnAlcanceFacultades(filtros.carreraId, alcance);
        }
        if (filtros.cursoId != null && !Number.isNaN(filtros.cursoId)) {
            await assertCursoEnAlcance(filtros.cursoId, alcance);
        }
        return;
    }
    if (!alcance.carreraIds.length) {
        throw new ForbiddenScopeError(
            'Tu usuario no tiene carreras asignadas. Un administrador debe configurar tu alcance en Usuarios.'
        );
    }
    if (filtros.carreraId != null && !alcance.carreraIds.includes(filtros.carreraId)) {
        throw new ForbiddenScopeError('La carrera seleccionada no está en tu alcance.');
    }
    if (filtros.cursoId != null && !Number.isNaN(filtros.cursoId)) {
        await assertCursoEnAlcance(filtros.cursoId, alcance);
    }
}

router.use(...autenticarConPoliticaAlcance);

router.get('/reportes/alertas', autorizarRoles(...ROLES_LECTURA_DIRECCION), async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        const { estado, tipo, cursoId, facultadId, carreraId, limit } = req.query;
        const cursoIdNum = cursoId ? Number(cursoId) : undefined;
        const filtros = {
            facultadId: facultadId ? Number(facultadId) : undefined,
            carreraId: carreraId ? Number(carreraId) : undefined,
            cursoId: cursoIdNum
        };
        await validarFiltrosGeograficosReportes(alcance, filtros);
        const alertas = await listarAlertas(
            {
                estado: estado ? String(estado) : undefined,
                tipo: tipo ? String(tipo) : undefined,
                cursoId: cursoIdNum,
                facultadId: filtros.facultadId,
                carreraId: filtros.carreraId,
                limit: limit ? Number(limit) : undefined
            },
            alcance
        );
        res.json({ total: alertas.length, datos: alertas });
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.patch('/reportes/alertas/:alertaId', autorizarRoles(...ROLES_ADMIN_O_ACADEMICOS), async (req, res, next) => {
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const alertaId = Number(req.params.alertaId);
        const { estado } = req.body ?? {};

        if (!alertaId) {
            return res.status(400).json({ mensaje: 'alertaId inválido' });
        }

        if (!estado) {
            return res.status(400).json({ mensaje: 'estado es obligatorio' });
        }

        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        const alerta = await actualizarEstadoAlerta(alertaId, { estado }, alcance);

        await registrarEventoAuditoriaSegura({
            modulo: 'reportes',
            accion: 'actualizar_alerta',
            recursoTipo: 'alerta_asistencia',
            recursoId: alertaId,
            detalle: { estado },
            despues: alerta,
            contexto: contextoAuditoria
        });

        res.json(alerta);
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.get('/reportes/resumen-general', autorizarRoles(...ROLES_LECTURA_DIRECCION), async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        const { facultadId, carreraId } = req.query;
        const filtros = {
            facultadId: facultadId ? Number(facultadId) : undefined,
            carreraId: carreraId ? Number(carreraId) : undefined
        };
        await validarFiltrosGeograficosReportes(alcance, filtros);
        const resumen = await obtenerResumenGeneral(alcance, filtros);
        res.json(resumen);
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.get('/reportes/resumen-cursos', autorizarRoles(...ROLES_LECTURA_DIRECCION), async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        const { cursoId, anio, mes, facultadId, carreraId, limit } = req.query;
        const filtros = {
            facultadId: facultadId ? Number(facultadId) : undefined,
            carreraId: carreraId ? Number(carreraId) : undefined,
            cursoId: cursoId ? Number(cursoId) : undefined
        };
        await validarFiltrosGeograficosReportes(alcance, filtros);
        const resumenes = await listarResumenCursos(
            {
                cursoId: filtros.cursoId,
                anio: anio ? Number(anio) : undefined,
                mes: mes ? Number(mes) : undefined,
                facultadId: filtros.facultadId,
                carreraId: filtros.carreraId,
                limit: limit ? Number(limit) : undefined
            },
            alcance
        );
        res.json({ total: resumenes.length, datos: resumenes });
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.get('/reportes/estadisticas', autorizarRoles(...ROLES_LECTURA_DIRECCION), async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        const { cursoId, periodo, facultadId, carreraId, limit } = req.query;
        const filtros = {
            facultadId: facultadId ? Number(facultadId) : undefined,
            carreraId: carreraId ? Number(carreraId) : undefined,
            cursoId: cursoId ? Number(cursoId) : undefined
        };
        await validarFiltrosGeograficosReportes(alcance, filtros);
        const estadisticas = await listarEstadisticasAusentismo(
            {
                cursoId: filtros.cursoId,
                periodo: periodo ? String(periodo) : undefined,
                facultadId: filtros.facultadId,
                carreraId: filtros.carreraId,
                limit: limit ? Number(limit) : undefined
            },
            alcance
        );
        res.json({ total: estadisticas.length, datos: estadisticas });
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.post('/reportes/estadisticas/recalcular', autorizarRoles(...ROLES_REPORTES_OPERATIVOS), async (req, res, next) => {
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        const { cursoId, periodo } = req.body ?? {};
        if (!cursoId) {
            return res.status(400).json({ mensaje: 'Debe seleccionar un curso' });
        }

        await assertCursoEnAlcance(Number(cursoId), alcance);

        const resultado = await recalcularEstadisticaCurso(
            Number(cursoId),
            periodo ? String(periodo) : undefined
        );

        await registrarEventoAuditoriaSegura({
            modulo: 'reportes',
            accion: 'recalcular_estadistica',
            recursoTipo: 'estadistica_ausentismo',
            recursoId: Number(cursoId),
            detalle: { cursoId: Number(cursoId), periodo: periodo ? String(periodo) : undefined },
            despues: resultado,
            contexto: contextoAuditoria
        });

        res.json(resultado);
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.get('/reportes/estadisticas/ausentismo/agregado', autorizarRoles(...ROLES_LECTURA_DIRECCION), async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        const { periodo, facultadId, carreraId } = req.query;
        const filtros = {
            facultadId: facultadId ? Number(facultadId) : undefined,
            carreraId: carreraId ? Number(carreraId) : undefined,
        };
        await validarFiltrosGeograficosReportes(alcance, filtros);
        const resultado = await listarAusentismoAgregadoFacultadCarrera(
            { periodo: periodo ? String(periodo) : undefined, ...filtros },
            alcance
        );
        res.json({ total: resultado.filas.length, periodo: resultado.periodo, datos: resultado.filas });
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.post('/reportes/estadisticas/ausentismo/pdf', autorizarRoles(...ROLES_REPORTES_OPERATIVOS), async (req, res, next) => {
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        const { periodo, facultadId, carreraId } = req.body ?? {};
        const filtros = {
            facultadId: facultadId ? Number(facultadId) : undefined,
            carreraId: carreraId ? Number(carreraId) : undefined
        };
        await validarFiltrosGeograficosReportes(alcance, filtros);
        const pdf = await generarPdfEstadisticasAusentismoFacultadCarrera(
            {
                periodo: periodo ? String(periodo) : undefined,
                facultadId: filtros.facultadId,
                carreraId: filtros.carreraId
            },
            alcance,
            usuarioId
        );

        await registrarEventoAuditoriaSegura({
            modulo: 'reportes',
            accion: 'generar_estadisticas_ausentismo_pdf',
            recursoTipo: 'reporte_ausentismo',
            detalle: { periodo, facultadId, carreraId },
            despues: { actaId: pdf.acta.id, url_documento: pdf.acta.url_documento },
            contexto: contextoAuditoria
        });

        res.setHeader('X-Acta-Id', String(pdf.acta.id));
        enviarPdfBuffer(res, pdf.buffer, pdf.fileName, 201);
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.get('/reportes/actas', autorizarRoles(...ROLES_LECTURA_DIRECCION), async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        const { cursoId, tipo, limit } = req.query;
        const cursoIdNum = cursoId ? Number(cursoId) : undefined;
        await validarFiltrosGeograficosReportes(alcance, { cursoId: cursoIdNum });
        const actas = await listarActas(
            {
                cursoId: cursoIdNum,
                tipoActa: tipo ? String(tipo) : undefined,
                limit: limit ? Number(limit) : undefined,
                generadoPorUsuarioId: usuarioId
            },
            alcance
        );
        res.json({ total: actas.length, datos: actas });
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.get('/reportes/consolidado-riesgo', autorizarRoles(...ROLES_LECTURA_DIRECCION), async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        const { periodo, anio, semestre, facultadId, carreraId, cursoId, estado, search, orderBy, limit } = req.query;
        const filtros = {
            facultadId: facultadId ? Number(facultadId) : undefined,
            carreraId: carreraId ? Number(carreraId) : undefined,
            cursoId: cursoId ? Number(cursoId) : undefined
        };
        await validarFiltrosGeograficosReportes(alcance, filtros);
        const rows = await listarConsolidadoRiesgoInhabilitados(
            {
                periodo: periodo ? String(periodo) : undefined,
                anio: anio != null && anio !== '' ? Number(anio) : undefined,
                semestre: semestre != null && semestre !== '' ? Number(semestre) : undefined,
                facultadId: filtros.facultadId,
                carreraId: filtros.carreraId,
                cursoId: filtros.cursoId,
                estado: estado ? String(estado).toUpperCase() as 'RIESGO' | 'INHABILITADO' : undefined,
                search: search ? String(search) : undefined,
                orderBy: orderBy ? String(orderBy) as 'faltas_desc' | 'asistencia_asc' | 'alumno_asc' : undefined,
                limit: limit ? Number(limit) : undefined,
            },
            alcance
        );
        res.json({ total: rows.length, datos: rows });
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.post('/reportes/consolidado-riesgo/pdf', autorizarRoles(...ROLES_REPORTES_OPERATIVOS), async (req, res, next) => {
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        const { periodo, anio, semestre, facultadId, carreraId, cursoId, estado, search, orderBy, limit } = req.body ?? {};
        const filtros = {
            facultadId: facultadId ? Number(facultadId) : undefined,
            carreraId: carreraId ? Number(carreraId) : undefined,
            cursoId: cursoId ? Number(cursoId) : undefined
        };
        await validarFiltrosGeograficosReportes(alcance, filtros);
        const pdf = await generarPdfConsolidadoRiesgoInhabilitados(
            {
                periodo: periodo ? String(periodo) : undefined,
                anio: anio != null && anio !== '' ? Number(anio) : undefined,
                semestre: semestre != null && semestre !== '' ? Number(semestre) : undefined,
                facultadId: filtros.facultadId,
                carreraId: filtros.carreraId,
                cursoId: filtros.cursoId,
                estado: estado ? String(estado).toUpperCase() as 'RIESGO' | 'INHABILITADO' : undefined,
                search: search ? String(search) : undefined,
                orderBy: orderBy ? String(orderBy) as 'faltas_desc' | 'asistencia_asc' | 'alumno_asc' : undefined,
                limit: limit ? Number(limit) : undefined
            },
            alcance,
            usuarioId
        );
        await registrarEventoAuditoriaSegura({
            modulo: 'reportes',
            accion: 'generar_consolidado_riesgo_pdf',
            recursoTipo: 'reporte_consolidado',
            detalle: { periodo, anio, semestre, facultadId, carreraId, cursoId, estado, search, orderBy },
            despues: { actaId: pdf.acta.id, url_documento: pdf.acta.url_documento },
            contexto: contextoAuditoria
        });
        res.setHeader('X-Acta-Id', String(pdf.acta.id));
        enviarPdfBuffer(res, pdf.buffer, pdf.fileName, 201);
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.get('/reportes/alumnos/:alumnoId/historial', autorizarRoles(...ROLES_ALUMNOS), async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        if (alcance.tipo === 'facultades' && alcance.facultadIds.length === 0) {
            return res.status(403).json({
                mensaje: 'Tu usuario no tiene facultades asignadas. Un administrador debe configurar tu alcance en Usuarios.'
            });
        }
        if (alcance.tipo === 'carreras' && alcance.carreraIds.length === 0) {
            return res.status(403).json({
                mensaje: 'Tu usuario no tiene carreras asignadas. Un administrador debe configurar tu alcance en Usuarios.'
            });
        }
        const alumnoId = String(req.params.alumnoId ?? '').trim();
        if (!alumnoId) {
            return res.status(400).json({ mensaje: 'alumnoId inválido' });
        }
        const historial = await obtenerHistorialAlumnoReporte(alumnoId, alcance);
        res.json(historial);
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.get(
    '/reportes/alumnos/:alumnoId/justificaciones',
    autorizarRoles(...ROLES_ALUMNOS),
    async (req, res, next) => {
        try {
            const usuarioId = req.usuario?.usuarioId;
            const roles = req.usuario?.roles ?? [];
            if (!usuarioId) {
                return res.status(401).json({ mensaje: 'No autenticado' });
            }
            const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
            if (alcance.tipo === 'facultades' && alcance.facultadIds.length === 0) {
                return res.status(403).json({
                    mensaje: 'Tu usuario no tiene facultades asignadas. Un administrador debe configurar tu alcance en Usuarios.'
                });
            }
            if (alcance.tipo === 'carreras' && alcance.carreraIds.length === 0) {
                return res.status(403).json({
                    mensaje: 'Tu usuario no tiene carreras asignadas. Un administrador debe configurar tu alcance en Usuarios.'
                });
            }
            const alumnoId = String(req.params.alumnoId ?? '').trim();
            if (!alumnoId) {
                return res.status(400).json({ mensaje: 'alumnoId inválido' });
            }
            const datos = await listarJustificacionesAlumnoReporte(alumnoId, alcance);
            res.json({ total: datos.length, datos });
        } catch (error) {
            if (error instanceof ForbiddenScopeError) {
                return res.status(403).json({ mensaje: error.message });
            }
            if (error instanceof Error) {
                return res.status(400).json({ mensaje: error.message });
            }
            next(error);
        }
    }
);

router.post('/reportes/alumnos/:alumnoId/informe-pdf', autorizarRoles(...ROLES_ALUMNOS), async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        if (alcance.tipo === 'facultades' && alcance.facultadIds.length === 0) {
            return res.status(403).json({
                mensaje: 'Tu usuario no tiene facultades asignadas. Un administrador debe configurar tu alcance en Usuarios.'
            });
        }
        if (alcance.tipo === 'carreras' && alcance.carreraIds.length === 0) {
            return res.status(403).json({
                mensaje: 'Tu usuario no tiene carreras asignadas. Un administrador debe configurar tu alcance en Usuarios.'
            });
        }
        const contextoAuditoria = construirContextoAuditoria(req);
        const alumnoId = String(req.params.alumnoId ?? '').trim();
        if (!alumnoId) {
            return res.status(400).json({ mensaje: 'alumnoId inválido' });
        }
        const pdf = await generarPdfInformeAlumno(alumnoId, alcance, usuarioId);
        await registrarEventoAuditoriaSegura({
            modulo: 'reportes',
            accion: 'generar_informe_alumno_pdf',
            recursoTipo: 'alumno',
            recursoId: alumnoId,
            detalle: { alumnoId, tipoDocumento: 'informe_individual' },
            despues: { actaId: pdf.acta.id, url_documento: pdf.acta.url_documento },
            contexto: contextoAuditoria
        });
        res.setHeader('X-Acta-Id', String(pdf.acta.id));
        enviarPdfBuffer(res, pdf.buffer, pdf.fileName, 201);
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

// Roles autorizados a consultar/descargar actas (incluye Docente para su planilla legal).
const ROLES_PERMITIDOS_ACTAS = [
    'administrador general',
    'jefe de carrera',
    'secretaria academica',
    'coordinador de facultad',
    'docente',
];

function tieneAlgunoDeLosRoles(req: import('express').Request, rolesObjetivo: string[]): boolean {
    const normObj = rolesObjetivo.map((r) => normalizarRolComparacion(r));
    const rolesUsuario = normalizarRolesDesdePayload(req.usuario?.roles).map((r) => normalizarRolComparacion(r));
    return rolesUsuario.some((rol) => normObj.includes(rol));
}

async function docenteOwnCurso(usuarioId: string, cursoId: number): Promise<boolean> {
    const { rows } = await pool.query<{ existe: boolean }>(
        `SELECT TRUE AS existe
         FROM cursos c
         JOIN docentes d ON d.id = c.docente_id
         WHERE c.id = $1 AND d.usuario_id = $2
         LIMIT 1`,
        [cursoId, usuarioId]
    );
    return rows.length > 0;
}

router.get('/reportes/actas/:actaId/pdf', async (req, res, next) => {
    try {
        if (!tieneAlgunoDeLosRoles(req, ROLES_PERMITIDOS_ACTAS)) {
            return res.status(403).json({ mensaje: 'No tienes permisos para esta acción' });
        }

        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }

        const actaId = Number(req.params.actaId);
        if (!Number.isFinite(actaId) || actaId <= 0) {
            return res.status(400).json({ mensaje: 'actaId inválido' });
        }

        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        const { buffer, fileName } = await regenerarPdfActaGenerada(actaId, alcance);
        enviarPdfBuffer(res, buffer, fileName);
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

/** Compatibilidad con URLs legacy de Storage (actas antiguas en Supabase). */
router.get('/reportes/actas/descargar/:fileName', async (req, res) => {
    if (!tieneAlgunoDeLosRoles(req, ROLES_PERMITIDOS_ACTAS)) {
        return res.status(403).json({ mensaje: 'No tienes permisos para esta acción' });
    }

    const rawFileName = String(req.params.fileName ?? '').trim();
    if (!rawFileName) {
        return res.status(400).json({ mensaje: 'fileName es obligatorio' });
    }

    const decodedFileName = decodeURIComponent(rawFileName);
    const safeFileName = decodedFileName.replace(/\\/g, '/').split('/').pop() ?? '';
    if (!safeFileName || decodedFileName.includes('..')) {
        return res.status(400).json({ mensaje: 'fileName inválido' });
    }

    const { supabase } = await import('../../config/supabase');
    const { data } = supabase.storage.from('actas').getPublicUrl(safeFileName);
    return res.redirect(data.publicUrl);
});

router.post('/reportes/actas', async (req, res, next) => {
    try {
        if (!tieneAlgunoDeLosRoles(req, ROLES_PERMITIDOS_ACTAS)) {
            return res.status(403).json({ mensaje: 'No tienes permisos para esta acción' });
        }

        const contextoAuditoria = construirContextoAuditoria(req);
        const usuarioId = req.usuario?.usuarioId;
        if (!usuarioId) {
            return res.status(400).json({ mensaje: 'No se pudo determinar el usuario autenticado' });
        }

        const { cursoId, tipoActa, urlDocumento, periodo } = req.body ?? {};
        if (!cursoId || !tipoActa) {
            return res.status(400).json({ mensaje: 'Debe seleccionar el curso y el tipo de acta' });
        }

        const tipoActaNormalizado = String(tipoActa).trim().toLowerCase().replace(/\s+/g, '_');
        const rolesAdminAcademicoDirector = [...RBAC.admin, ...RBAC.academic, ...RBAC.director].map((r) =>
            normalizarRolComparacion(r)
        );
        const esAdminOAcademicoODirector = tieneAlgunoDeLosRoles(req, rolesAdminAcademicoDirector);

        // Docente solo puede generar pdf_legal y solo de cursos que le pertenecen.
        if (!esAdminOAcademicoODirector) {
            if (tipoActaNormalizado !== 'pdf_legal') {
                return res.status(403).json({
                    mensaje: 'Solo usuarios administrativos pueden generar este tipo de acta',
                });
            }
            const owns = await docenteOwnCurso(usuarioId, Number(cursoId));
            if (!owns) {
                return res.status(403).json({
                    mensaje: 'No puedes generar la planilla legal de un curso que no te pertenece',
                });
            }
        }

        const rolesParaAlcance = req.usuario?.roles ?? [];
        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, rolesParaAlcance);
        await assertCursoEnAlcance(Number(cursoId), alcance);

        const pdf = await crearActa({
            cursoId: Number(cursoId),
            tipoActa: String(tipoActa),
            periodo: periodo ? String(periodo) : undefined
        }, usuarioId);

        await registrarEventoAuditoriaSegura({
            modulo: 'reportes',
            accion: 'crear_acta',
            recursoTipo: 'acta_generada',
            recursoId: pdf.acta.id,
            detalle: {
                cursoId: Number(cursoId),
                tipoActa: String(tipoActa),
                periodo: periodo ? String(periodo) : undefined
            },
            despues: pdf.acta,
            contexto: contextoAuditoria
        });

        res.setHeader('X-Acta-Id', String(pdf.acta.id));
        enviarPdfBuffer(res, pdf.buffer, pdf.fileName, 201);
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.get('/reportes/cierre-mensual', autorizarRoles(...ROLES_LECTURA_DIRECCION), async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        const cursoId = Number(req.query.cursoId);
        const periodo = req.query.periodo ? String(req.query.periodo) : undefined;

        if (!cursoId) {
            return res.status(400).json({ mensaje: 'Debe seleccionar un curso' });
        }

        await assertCursoEnAlcance(cursoId, alcance);
        const checklist = await obtenerChecklistCierreMensual(cursoId, periodo);
        res.json(checklist);
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.post('/reportes/cierre-mensual', autorizarRoles(...ROLES_CIERRE_MENSUAL_EJECUTAR), async (req, res, next) => {
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        if (!usuarioId) {
            return res.status(400).json({ mensaje: 'No se pudo determinar el usuario autenticado' });
        }

        const { cursoId, periodo, password } = req.body ?? {};
        if (!cursoId) {
            return res.status(400).json({ mensaje: 'Debe seleccionar un curso' });
        }
        if (!password || !String(password).trim()) {
            return res.status(400).json({ mensaje: 'La contraseña es obligatoria para confirmar el cierre' });
        }

        try {
            await verificarPasswordUsuarioAutenticado(usuarioId, String(password));
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'No se pudo verificar la contraseña';
            const status = msg === 'Contraseña incorrecta' ? 403 : 400;
            return res.status(status).json({ mensaje: msg });
        }

        const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
        await assertCursoEnAlcance(Number(cursoId), alcance);

        const resultado = await cerrarModuloMensual(Number(cursoId), periodo ? String(periodo) : undefined, usuarioId);

        await registrarEventoAuditoriaSegura({
            modulo: 'reportes',
            accion: 'cierre_mensual',
            recursoTipo: 'modulo_academico',
            recursoId: Number(cursoId),
            detalle: { cursoId: Number(cursoId), periodo: periodo ? String(periodo) : undefined },
            despues: resultado,
            contexto: contextoAuditoria
        });

        res.json(resultado);
    } catch (error) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.post('/reportes/cursos/:cursoId/cronograma-pdf', async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        const roles = req.usuario?.roles ?? [];
        const cursoId = Number(req.params.cursoId);
        if (!cursoId) return res.status(400).json({ mensaje: 'cursoId inválido' });
        if (!usuarioId) return res.status(401).json({ mensaje: 'No autenticado' });

        const alcance = req.alcanceMatriculas as import('../../utils/alumnos-scope').AlcanceMatriculasFacultad | undefined;
        if (!alcance) return res.status(403).json({ mensaje: 'No se pudo determinar tu alcance académico.' });

        const { buffer, fileName } = await buildCronogramaPdfBuffer(cursoId, alcance);
        enviarPdfBuffer(res, buffer, fileName, 200);
    } catch (error: any) {
        if (error instanceof ForbiddenScopeError) {
            return res.status(403).json({ mensaje: error.message });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

export default router;

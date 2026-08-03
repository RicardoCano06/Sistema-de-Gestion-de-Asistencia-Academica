import { Router } from 'express';
import multer from 'multer';
import {
    listarPlanillasAsignadas,
    obtenerPlanillaConPermisos,
    obtenerResumenCurso,
    obtenerHabilitados,
    registrarAsistenciaDocente,
    registrarAsistenciasLote,
    registrarJustificacionDocente,
    crearSesionDocente,
    cerrarSesionDocente,
    anularSesionDocente,
    listarSesionesCurso,
    listarJustificaciones,
    resolverJustificacion,
    actualizarModalidadSesion,
    listarAusenciasCurso,
    listarAlumnosCurso,
    marcarTodosPresentesSesionDocente,
    obtenerEstadoJustificacionAuditoria,
    obtenerCronogramaParaDocente,
    firmarSemanaCronograma,
    firmarEvaluacionCronograma,
    firmarTodoCronograma,
    obtenerEtiquetaCurso
} from './asistencias.service';
import { autenticarConPoliticaAlcance, autorizarRoles } from '../../middlewares/auth.middleware';
import {
    ROLES_ADMIN_O_ACADEMICOS,
    ROLES_APROBADORES_JUSTIFICACIONES,
    ROLES_CONSULTA_ASISTENCIAS,
    ROLES_CONSULTA_JUSTIFICACIONES,
    ROLES_OPERADORES_ASISTENCIAS,
    ROLES_REGISTRO_JUSTIFICACIONES
} from '../../utils/rbac';
import { construirContextoAuditoria, registrarEventoAuditoriaSegura } from '../auditoria/auditoria.service';
import { ForbiddenScopeError } from '../../utils/alumnos-scope';
import { subirJustificativoPdf } from '../../services/justificativos-storage.service';

const router = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos PDF'));
        }
    }
});

function normalizarRolContexto(value: string): string {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function obtenerContexto(req: any) {
    const roles = req.usuario?.roles ?? [];
    const set = new Set(roles.map((r: string) => normalizarRolContexto(r)));
    const sinRestriccionAlcance =
        set.has('administrador general') || set.has('secretaria academica');
    const puedeGestionarTodos = roles.some((rol: string) => ROLES_ADMIN_O_ACADEMICOS.includes(rol));
    return {
        usuarioId: req.usuario?.usuarioId,
        roles,
        sinRestriccionAlcance,
        puedeGestionarTodos,
        alcance: req.alcanceMatriculas as import('../../utils/alumnos-scope').AlcanceMatriculasFacultad | undefined,
    };
}

router.get(
    '/asistencias/mis-planillas',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_CONSULTA_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const fecha = req.query.fecha ? String(req.query.fecha) : undefined;
            const contexto = obtenerContexto(req);
            const planillas = await listarPlanillasAsignadas(contexto, { fecha });
            res.json({ total: planillas.length, datos: planillas });
        } catch (error) {
            next(error);
        }
    }
);

router.get(
    '/asistencias/planilla',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_CONSULTA_ASISTENCIAS),
    async (req, res, next) => {
    try {
        const cursoId = Number(req.query.cursoId);
        const fecha = req.query.fecha ? String(req.query.fecha) : undefined;

        if (!cursoId) {
            return res.status(400).json({ mensaje: 'Debe seleccionar un curso' });
        }

        const contexto = obtenerContexto(req);
        const { curso, datos } = await obtenerPlanillaConPermisos({ cursoId, fecha }, contexto);
        res.json({ curso, total: datos.length, datos });
    } catch (error) {
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
    }
);

router.get(
    '/asistencias/resumen/:cursoId',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_CONSULTA_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const cursoId = Number(req.params.cursoId);
            if (!cursoId) {
                return res.status(400).json({ mensaje: 'cursoId inválido' });
            }

            const resumen = await obtenerResumenCurso(cursoId);
            if (!resumen) {
                return res.status(404).json({ mensaje: 'Curso no encontrado' });
            }

            res.json(resumen);
        } catch (error) {
            next(error);
        }
    }
);

router.get(
    '/asistencias/habilitados/:cursoId',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_CONSULTA_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const cursoId = Number(req.params.cursoId);
            if (!cursoId) {
                return res.status(400).json({ mensaje: 'cursoId inválido' });
            }

            const habilitados = await obtenerHabilitados(cursoId);
            res.json({ total: habilitados.length, datos: habilitados });
        } catch (error) {
            next(error);
        }
    }
);

router.get(
    '/asistencias/sesiones',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_CONSULTA_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const cursoId = Number(req.query.cursoId);
            const estado = req.query.estado ? String(req.query.estado) : undefined;
            if (!cursoId) {
                return res.status(400).json({ mensaje: 'Debe seleccionar un curso' });
            }

            const contexto = obtenerContexto(req);
            const sesiones = await listarSesionesCurso(cursoId, contexto, estado);
            res.json({ total: sesiones.length, datos: sesiones });
        } catch (error) {
            next(error);
        }
    }
);

router.post(
    '/asistencias/sesiones',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_OPERADORES_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const contextoAuditoria = construirContextoAuditoria(req);
            const { cursoId, fecha, observaciones, modalidad } = req.body ?? {};
            if (!cursoId || !fecha) {
                return res.status(400).json({ mensaje: 'cursoId y fecha son obligatorios' });
            }

            const contexto = obtenerContexto(req);
            const sesion = await crearSesionDocente(
                { cursoId: Number(cursoId), fecha: String(fecha), observaciones, modalidad },
                contexto
            );

            const etiqueta = await obtenerEtiquetaCurso(Number(cursoId));
            await registrarEventoAuditoriaSegura({
                modulo: 'asistencias',
                accion: 'crear_sesion',
                recursoTipo: 'sesion_clase',
                recursoId: sesion.id,
                recursoResumen: `Sesión de clase · ${etiqueta} · ${fecha}`,
                detalle: { cursoId: Number(cursoId), fecha: String(fecha) },
                despues: sesion,
                contexto: contextoAuditoria
            });

            res.status(201).json(sesion);
        } catch (error) {
            if (error instanceof Error) {
                return res.status(400).json({ mensaje: error.message });
            }
            next(error);
        }
    }
);

router.post(
    '/asistencias/sesiones/:sesionId/cierre',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_OPERADORES_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const contextoAuditoria = construirContextoAuditoria(req);
            const sesionId = Number(req.params.sesionId);
            if (!sesionId) {
                return res.status(400).json({ mensaje: 'sesionId inválido' });
            }

            const contexto = obtenerContexto(req);
            const { sesion, matriculas } = await cerrarSesionDocente(sesionId, contexto);

            const etiquetaCerrar = await obtenerEtiquetaCurso(sesion.curso_id);
            await registrarEventoAuditoriaSegura({
                modulo: 'asistencias',
                accion: 'cerrar_sesion',
                recursoTipo: 'sesion_clase',
                recursoId: sesionId,
                recursoResumen: `Cierre de sesión · ${etiquetaCerrar} · ${String(sesion.fecha).slice(0, 10)}`,
                detalle: { cursoId: sesion.curso_id },
                despues: sesion,
                contexto: contextoAuditoria
            });

            res.json({ ...sesion, matriculas });
        } catch (error) {
            if (error instanceof Error) {
                return res.status(400).json({ mensaje: error.message });
            }
            next(error);
        }
    }
);

router.post(
    '/asistencias/sesiones/:sesionId/anular',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_OPERADORES_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const contextoAuditoria = construirContextoAuditoria(req);
            const sesionId = Number(req.params.sesionId);
            if (!sesionId) {
                return res.status(400).json({ mensaje: 'sesionId inválido' });
            }

            const contexto = obtenerContexto(req);
            const resultado = await anularSesionDocente(sesionId, contexto);

            const etiquetaAnular = await obtenerEtiquetaCurso(resultado.cursoId);
            await registrarEventoAuditoriaSegura({
                modulo: 'asistencias',
                accion: 'anular_sesion',
                recursoTipo: 'sesion_clase',
                recursoId: sesionId,
                recursoResumen: `Anulación de sesión · ${etiquetaAnular}`,
                detalle: { cursoId: resultado.cursoId },
                despues: resultado,
                contexto: contextoAuditoria
            });

            res.json(resultado);
        } catch (error) {
            if (error instanceof Error) {
                return res.status(400).json({ mensaje: error.message });
            }
            next(error);
        }
    }
);

router.post(
    '/asistencias/registro',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_OPERADORES_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const contextoAuditoria = construirContextoAuditoria(req);
            const { sesionId, matriculaId, estado, justificada, observaciones } = req.body ?? {};
            if (!sesionId || !matriculaId || !estado) {
                return res.status(400).json({ mensaje: 'La sesión, matrícula y estado de asistencia son obligatorios' });
            }

            const sesionNum = Number(sesionId);
            const matriculaNum = Number(matriculaId);

            const contexto = obtenerContexto(req);
            const asistencia = await registrarAsistenciaDocente(
                {
                    sesionId: sesionNum,
                    matriculaId: matriculaNum,
                    estado,
                    justificada,
                    observaciones
                },
                contexto
            );

            res.json(asistencia);
        } catch (error) {
            if (error instanceof Error) {
                return res.status(400).json({ mensaje: error.message });
            }
            next(error);
        }
    }
);

router.post(
    '/asistencias/registro-lote',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_OPERADORES_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const contextoAuditoria = construirContextoAuditoria(req);
            const { sesionId, registros } = req.body ?? {};
            if (!sesionId || !Array.isArray(registros) || !registros.length) {
                return res.status(400).json({ mensaje: 'sesionId y un array de registros son obligatorios' });
            }

            const contexto = obtenerContexto(req);
            const resultado = await registrarAsistenciasLote(
                {
                    sesionId: Number(sesionId),
                    registros: registros.map((r: any) => ({
                        matriculaId: Number(r.matriculaId),
                        estado: r.estado,
                        justificada: Boolean(r.justificada ?? false),
                        observaciones: r.observaciones ?? undefined
                    }))
                },
                contexto
            );

            await registrarEventoAuditoriaSegura({
                modulo: 'asistencias',
                accion: 'registrar_asistencias_lote',
                recursoTipo: 'sesion_clase',
                recursoId: resultado.sesionId,
                detalle: {
                    sesionId: resultado.sesionId,
                    cursoId: resultado.cursoId,
                    procesados: resultado.procesados,
                    omitidos: resultado.omitidos
                },
                contexto: contextoAuditoria
            });

            res.json(resultado);
        } catch (error) {
            if (error instanceof Error) {
                return res.status(400).json({ mensaje: error.message });
            }
            next(error);
        }
    }
);

router.post(
    '/asistencias/sesiones/:sesionId/marcar-todos-presentes',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_OPERADORES_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const contextoAuditoria = construirContextoAuditoria(req);
            const sesionId = Number(req.params.sesionId);
            if (!sesionId) {
                return res.status(400).json({ mensaje: 'sesionId inválido' });
            }

            const contexto = obtenerContexto(req);
            const resultado = await marcarTodosPresentesSesionDocente(sesionId, contexto);

            await registrarEventoAuditoriaSegura({
                modulo: 'asistencias',
                accion: 'marcar_todos_presentes',
                recursoTipo: 'sesion_clase',
                recursoId: sesionId,
                detalle: { cursoId: resultado.cursoId, actualizados: resultado.actualizados },
                despues: resultado,
                contexto: contextoAuditoria
            });

            res.json(resultado);
        } catch (error) {
            if (error instanceof Error) {
                return res.status(400).json({ mensaje: error.message });
            }
            next(error);
        }
    }
);

router.post(
    '/asistencias/justificaciones',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_REGISTRO_JUSTIFICACIONES),
    async (req, res, next) => {
        try {
            const contextoAuditoria = construirContextoAuditoria(req);
            const { asistenciaId, sesionId, matriculaId, motivo, documentoUrl } = req.body ?? {};
            if ((!asistenciaId && (!sesionId || !matriculaId)) || !motivo || !documentoUrl) {
                return res.status(400).json({ mensaje: 'El motivo, el documento y la referencia a la asistencia son obligatorios' });
            }

            const contexto = obtenerContexto(req);
            const justificacion = await registrarJustificacionDocente(
                {
                    asistenciaId: asistenciaId ? Number(asistenciaId) : null,
                    sesionId: sesionId ? Number(sesionId) : null,
                    matriculaId: matriculaId ? Number(matriculaId) : null,
                    motivo,
                    documentoUrl
                },
                contexto
            );

            await registrarEventoAuditoriaSegura({
                modulo: 'asistencias',
                accion: 'registrar_justificacion',
                recursoTipo: 'justificacion',
                recursoId: justificacion.id,
                detalle: { asistenciaId: justificacion.asistencia_id },
                despues: justificacion,
                contexto: contextoAuditoria
            });

            res.json(justificacion);
        } catch (error) {
            if (error instanceof Error) {
                return res.status(400).json({ mensaje: error.message });
            }
            next(error);
        }
    }
);

router.get(
    '/asistencias/justificaciones',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_CONSULTA_JUSTIFICACIONES),
    async (req, res, next) => {
        try {
            const cursoId = req.query.cursoId ? Number(req.query.cursoId) : undefined;
            const estado = req.query.estado ? String(req.query.estado) : undefined;
            if (cursoId !== undefined && Number.isNaN(cursoId)) {
                return res.status(400).json({ mensaje: 'cursoId inválido' });
            }

            const contexto = obtenerContexto(req);
            const rolesNorm = (contexto.roles ?? []).map((r: string) => normalizarRolContexto(r));
            const esAprobadorJustificaciones = ROLES_APROBADORES_JUSTIFICACIONES.some((rol) =>
                rolesNorm.includes(normalizarRolContexto(rol))
            );
            if (
                !contexto.sinRestriccionAlcance &&
                !contexto.puedeGestionarTodos &&
                !esAprobadorJustificaciones &&
                cursoId === undefined
            ) {
                return res.status(400).json({ mensaje: 'Debe seleccionar un curso (docente)' });
            }

            const justificaciones = await listarJustificaciones(
                { cursoId, estado },
                contexto
            );
            res.json({ total: justificaciones.length, datos: justificaciones });
        } catch (error) {
            if (error instanceof ForbiddenScopeError) {
                return res.status(403).json({ mensaje: error.message });
            }
            next(error);
        }
    }
);

router.post(
    '/asistencias/justificaciones/:justificacionId/resolucion',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_APROBADORES_JUSTIFICACIONES),
    async (req, res, next) => {
        try {
            const contextoAuditoria = construirContextoAuditoria(req);
            const justificacionId = Number(req.params.justificacionId);
            const { accion, comentarios } = req.body ?? {};

            if (!justificacionId || Number.isNaN(justificacionId)) {
                return res.status(400).json({ mensaje: 'El identificador de justificación no es válido' });
            }

            if (!accion || !['aprobar', 'rechazar'].includes(accion)) {
                return res.status(400).json({ mensaje: 'La acción debe ser aprobar o rechazar' });
            }

            const contexto = obtenerContexto(req);
            const antes = await obtenerEstadoJustificacionAuditoria(justificacionId);
            const resultado = await resolverJustificacion(
                { justificacionId, accion, comentarios },
                contexto
            );
            const despues = await obtenerEstadoJustificacionAuditoria(justificacionId);
            const estadoRevisionAnterior = (antes?.estado_revision as string | undefined) ?? null;
            const estadoRevisionNuevo = (despues?.estado_revision as string | undefined) ?? null;

            await registrarEventoAuditoriaSegura({
                modulo: 'asistencias',
                accion: 'resolver_justificacion',
                recursoTipo: 'justificacion',
                recursoId: justificacionId,
                detalle: {
                    accion,
                    estado_revision_anterior: estadoRevisionAnterior,
                    estado_revision_nuevo: estadoRevisionNuevo,
                },
                antes,
                despues: despues ?? resultado,
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
    }
);

router.patch(
    '/asistencias/sesiones/:sesionId/modalidad',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_OPERADORES_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const sesionId = Number(req.params.sesionId);
            const { modalidad } = req.body ?? {};
            if (!sesionId) {
                return res.status(400).json({ mensaje: 'sesionId inválido' });
            }
            if (!modalidad || !['presencial', 'virtual'].includes(modalidad)) {
                return res.status(400).json({ mensaje: 'modalidad debe ser presencial o virtual' });
            }

            const contexto = obtenerContexto(req);
            const sesion = await actualizarModalidadSesion(sesionId, modalidad, contexto);
            res.json(sesion);
        } catch (error) {
            if (error instanceof Error) {
                return res.status(400).json({ mensaje: error.message });
            }
            next(error);
        }
    }
);

// --- Todos los alumnos matriculados en un curso ---
router.get(
    '/asistencias/alumnos-curso',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_CONSULTA_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const cursoId = Number(req.query.cursoId);
            if (!cursoId) {
                return res.status(400).json({ mensaje: 'Debe seleccionar un curso' });
            }
            const contexto = obtenerContexto(req);
            const alumnos = await listarAlumnosCurso(cursoId, contexto);
            res.json({ total: alumnos.length, datos: alumnos });
        } catch (error) {
            if (error instanceof Error) {
                return res.status(400).json({ mensaje: error.message });
            }
            next(error);
        }
    }
);

// --- Ausencias sin justificar de un curso ---
router.get(
    '/asistencias/ausentes',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_CONSULTA_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const cursoId = Number(req.query.cursoId);
            if (!cursoId) {
                return res.status(400).json({ mensaje: 'Debe seleccionar un curso' });
            }
            const contexto = obtenerContexto(req);
            const ausencias = await listarAusenciasCurso(cursoId, contexto);
            res.json({ total: ausencias.length, datos: ausencias });
        } catch (error) {
            if (error instanceof Error) {
                return res.status(400).json({ mensaje: error.message });
            }
            next(error);
        }
    }
);

// --- Upload de PDF justificativo ---
router.post(
    '/asistencias/justificaciones/upload',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_REGISTRO_JUSTIFICACIONES),
    upload.single('archivo'),
    async (req, res, next) => {
        try {
            if (!req.file) {
                return res.status(400).json({ mensaje: 'No se recibió ningún archivo PDF' });
            }
            const url = await subirJustificativoPdf(req.file.buffer, req.file.originalname);
            res.json({ url, filename: req.file.originalname });
        } catch (error) {
            next(error);
        }
    }
);

// ─── Cronograma de Cátedra (vista docente) ────────────────────────────

router.get(
    '/asistencias/cronograma/:cursoId',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_CONSULTA_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const cursoId = Number(req.params.cursoId);
            if (!cursoId) return res.status(400).json({ mensaje: 'cursoId inválido' });
            const contexto = obtenerContexto(req);
            const cronograma = await obtenerCronogramaParaDocente(cursoId, contexto);
            res.json(cronograma);
        } catch (error) {
            if (error instanceof Error) return res.status(400).json({ mensaje: error.message });
            next(error);
        }
    }
);

router.post(
    '/asistencias/cronograma/semanas/:semanaId/firmar',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_OPERADORES_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const contextoAuditoria = construirContextoAuditoria(req);
            const semanaId = Number(req.params.semanaId);
            if (!semanaId) return res.status(400).json({ mensaje: 'semanaId inválido' });
            const contexto = obtenerContexto(req);
            const resultado = await firmarSemanaCronograma(semanaId, contexto);
            await registrarEventoAuditoriaSegura({
                modulo: 'asistencias',
                accion: 'firmar_semana_cronograma',
                recursoTipo: 'curso_cronograma_semanas',
                recursoId: semanaId,
                detalle: { semanaId, firmado_en: resultado.firmado_en },
                contexto: contextoAuditoria,
            });
            res.json(resultado);
        } catch (error) {
            if (error instanceof Error) return res.status(400).json({ mensaje: error.message });
            next(error);
        }
    }
);

router.post(
    '/asistencias/cronograma/evaluaciones/:evaluacionId/firmar',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_OPERADORES_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const contextoAuditoria = construirContextoAuditoria(req);
            const evaluacionId = Number(req.params.evaluacionId);
            if (!evaluacionId) return res.status(400).json({ mensaje: 'evaluacionId inválido' });
            const contexto = obtenerContexto(req);
            const resultado = await firmarEvaluacionCronograma(evaluacionId, contexto);
            await registrarEventoAuditoriaSegura({
                modulo: 'asistencias',
                accion: 'firmar_evaluacion_cronograma',
                recursoTipo: 'curso_evaluaciones',
                recursoId: evaluacionId,
                detalle: { evaluacionId, firmado_en: resultado.firmado_en },
                contexto: contextoAuditoria,
            });
            res.json(resultado);
        } catch (error) {
            if (error instanceof Error) return res.status(400).json({ mensaje: error.message });
            next(error);
        }
    }
);

router.post(
    '/asistencias/cronograma/:cursoId/firmar-todo',
    ...autenticarConPoliticaAlcance,
    autorizarRoles(...ROLES_OPERADORES_ASISTENCIAS),
    async (req, res, next) => {
        try {
            const contextoAuditoria = construirContextoAuditoria(req);
            const cursoId = Number(req.params.cursoId);
            if (!cursoId) return res.status(400).json({ mensaje: 'cursoId inválido' });
            const contexto = obtenerContexto(req);
            const resultado = await firmarTodoCronograma(cursoId, contexto);
            await registrarEventoAuditoriaSegura({
                modulo: 'asistencias',
                accion: 'firmar_todo_cronograma',
                recursoTipo: 'curso',
                recursoId: cursoId,
                detalle: { cursoId, firmados: resultado.firmados, total: resultado.total },
                contexto: contextoAuditoria,
            });
            res.json(resultado);
        } catch (error) {
            if (error instanceof Error) return res.status(400).json({ mensaje: error.message });
            next(error);
        }
    }
);

export default router;

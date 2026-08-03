import { Router } from 'express';
import {
    crearLote,
    listarLotes,
    obtenerDetalleLote,
    agregarRegistrosLote,
    listarRegistrosLote,
    actualizarEstadoLote,
    confirmarLote,
    eliminarLotePendiente,
    descartarLotePendienteSinRegistros,
    listarDestinosAcademicos,
    esLoteDelUsuario,
    validarCargaAlumnosPrevia
} from './importaciones.service';
import { autenticarConPoliticaAlcance, autorizarRoles } from '../../middlewares/auth.middleware';
import { ROLES_ADMIN_O_ACADEMICOS } from '../../utils/rbac';
import { construirContextoAuditoria, registrarEventoAuditoriaSegura } from '../auditoria/auditoria.service';

const router = Router();

/** Sub-router: auth + roles solo bajo `/importaciones/*` (no interceptar `/reportes`, etc.). */
const importacionesApi = Router();
importacionesApi.use(...autenticarConPoliticaAlcance, autorizarRoles(...ROLES_ADMIN_O_ACADEMICOS));

importacionesApi.get('/lotes', async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const { estado, tipo, limit } = req.query;
        const lotes = await listarLotes({
            estado: estado ? String(estado) : undefined,
            tipoLote: tipo ? String(tipo) : undefined,
            limit: limit ? Number(limit) : undefined,
            ejecutadoPorUsuarioId: usuarioId
        });
        res.json({ total: lotes.length, datos: lotes });
    } catch (error) {
        next(error);
    }
});

importacionesApi.get('/destinos-academicos', async (_req, res, next) => {
    try {
        const catalogo = await listarDestinosAcademicos();
        res.json(catalogo);
    } catch (error) {
        next(error);
    }
});

importacionesApi.post('/validar-carga-alumnos', async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const body = req.body ?? {};
        const registros = Array.isArray(body.registros) ? body.registros : [];
        if (!registros.length) {
            return res.status(400).json({ mensaje: 'Los registros son obligatorios' });
        }
        if (registros.length > 5000) {
            return res.status(400).json({ mensaje: 'Máximo 5000 registros por validación' });
        }

        const cohorteAnioRaw = body.cohorteAnio;
        if (cohorteAnioRaw === '' || cohorteAnioRaw === undefined || cohorteAnioRaw === null) {
            return res.status(400).json({ mensaje: 'El año de ingreso es un campo obligatorio.' });
        }
        const cohorteAnio = Number(cohorteAnioRaw);
        if (!Number.isFinite(cohorteAnio) || cohorteAnio < 1990 || cohorteAnio > 2100) {
            return res.status(400).json({ mensaje: 'El año de ingreso debe estar entre 1990 y 2100.' });
        }

        await validarCargaAlumnosPrevia(
            {
                tipoLote: 'alumnos',
                descripcion: body.descripcion,
                archivoFuente: body.archivoFuente,
                destinoFacultad: body.destinoFacultad,
                destinoCarrera: body.destinoCarrera,
                destinoFacultadId: body.destinoFacultadId ? Number(body.destinoFacultadId) : undefined,
                destinoCarreraId: body.destinoCarreraId ? Number(body.destinoCarreraId) : undefined,
                cohorteAnio,
                registros
            },
            usuarioId
        );
        res.json({ ok: true });
    } catch (error) {
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

importacionesApi.post('/lotes', async (req, res, next) => {
    try {
        const {
            tipoLote,
            descripcion,
            archivoFuente,
            totalRegistros,
            destinoFacultad,
            destinoCarrera,
            destinoFacultadId,
            destinoCarreraId,
            cursoDestinoId,
            cohorteAnio
        } = req.body ?? {};
        if (!tipoLote) {
            return res.status(400).json({ mensaje: 'El tipo de lote es obligatorio' });
        }

        if (cohorteAnio === '' || cohorteAnio === undefined || cohorteAnio === null) {
            return res.status(400).json({ mensaje: 'El año de ingreso es un campo obligatorio.' });
        }
        const cohorteAnioNum = Number(cohorteAnio);
        if (!Number.isFinite(cohorteAnioNum) || cohorteAnioNum < 1990 || cohorteAnioNum > 2100) {
            return res.status(400).json({ mensaje: 'El año de ingreso debe estar entre 1990 y 2100.' });
        }

        const usuarioId = req.usuario?.usuarioId;
        if (!usuarioId) {
            return res.status(400).json({ mensaje: 'No se pudo determinar el usuario autenticado' });
        }

        const lote = await crearLote(
            {
                tipoLote,
                descripcion,
                archivoFuente,
                totalRegistros,
                destinoFacultad,
                destinoCarrera,
                destinoFacultadId: destinoFacultadId ? Number(destinoFacultadId) : undefined,
                destinoCarreraId: destinoCarreraId ? Number(destinoCarreraId) : undefined,
                cursoDestinoId: cursoDestinoId ? Number(cursoDestinoId) : undefined,
                cohorteAnio: cohorteAnioNum
            },
            usuarioId
        );
        res.status(201).json(lote);
    } catch (error) {
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

importacionesApi.get('/lotes/:loteId', async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const loteId = Number(req.params.loteId);
        if (!loteId) {
            return res.status(400).json({ mensaje: 'El identificador de lote no es válido' });
        }

        if (!(await esLoteDelUsuario(loteId, usuarioId))) {
            return res.status(404).json({ mensaje: 'Lote no encontrado' });
        }
        const lote = await obtenerDetalleLote(loteId);
        if (!lote) {
            return res.status(404).json({ mensaje: 'Lote no encontrado' });
        }

        res.json(lote);
    } catch (error) {
        next(error);
    }
});

importacionesApi.get('/lotes/:loteId/registros', async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const loteId = Number(req.params.loteId);
        if (!loteId) {
            return res.status(400).json({ mensaje: 'El identificador de lote no es válido' });
        }

        if (!(await esLoteDelUsuario(loteId, usuarioId))) {
            return res.status(404).json({ mensaje: 'Lote no encontrado' });
        }
        const { valido, limit, offset } = req.query;
        const registros = await listarRegistrosLote(loteId, {
            valido: typeof valido === 'string' ? valido === 'true' : undefined,
            limit: limit ? Number(limit) : undefined,
            offset: offset ? Number(offset) : undefined
        });

        res.json({ total: registros.length, datos: registros });
    } catch (error) {
        next(error);
    }
});

importacionesApi.post('/lotes/:loteId/registros', async (req, res, next) => {
    const loteId = Number(req.params.loteId);
    try {
        const usuarioId = req.usuario?.usuarioId;
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }

        if (!loteId || Number.isNaN(loteId)) {
            return res.status(400).json({ mensaje: 'El identificador de lote no es válido' });
        }

        if (!(await esLoteDelUsuario(loteId, usuarioId))) {
            return res.status(404).json({ mensaje: 'Lote no encontrado' });
        }

        const registros = Array.isArray(req.body?.registros) ? req.body.registros : [];
        if (!registros.length) {
            return res.status(400).json({ mensaje: 'Los registros son obligatorios' });
        }

        if (registros.length > 500) {
            return res.status(400).json({ mensaje: 'Máximo 500 registros por solicitud' });
        }

        const insertados = await agregarRegistrosLote(loteId, registros);
        res.status(201).json({ total: insertados.length, datos: insertados });
    } catch (error) {
        // Intentamos limpiar el lote si falló la carga (solo si el ID es válido)
        if (loteId) {
            await descartarLotePendienteSinRegistros(loteId).catch(() => {});
        }

        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

importacionesApi.delete('/lotes/:loteId', async (req, res, next) => {
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const usuarioId = req.usuario?.usuarioId;
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const loteId = Number(req.params.loteId);
        if (!loteId) {
            return res.status(400).json({ mensaje: 'El identificador de lote no es válido' });
        }

        if (!(await esLoteDelUsuario(loteId, usuarioId))) {
            return res.status(404).json({ mensaje: 'Lote no encontrado' });
        }

        await eliminarLotePendiente(loteId);
        await registrarEventoAuditoriaSegura({
            modulo: 'importaciones',
            accion: 'descartar_lote',
            recursoTipo: 'lote_importacion',
            recursoId: loteId,
            detalle: {},
            contexto: contextoAuditoria
        });
        res.status(204).end();
    } catch (error) {
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

importacionesApi.post('/lotes/:loteId/confirmar', async (req, res, next) => {
    const loteId = Number(req.params.loteId);
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const usuarioId = req.usuario?.usuarioId;
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }

        if (!loteId || Number.isNaN(loteId)) {
            return res.status(400).json({ mensaje: 'El identificador de lote no es válido' });
        }

        if (!(await esLoteDelUsuario(loteId, usuarioId))) {
            return res.status(404).json({ mensaje: 'Lote no encontrado' });
        }

        const resultado = await confirmarLote(loteId);
        await registrarEventoAuditoriaSegura({
            modulo: 'importaciones',
            accion: 'confirmar_lote',
            recursoTipo: 'lote_alumnos',
            recursoId: loteId,
            detalle: {
                procesados: resultado.procesados,
                errores: resultado.errores,
                estado: resultado.estado
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
});

importacionesApi.patch('/lotes/:loteId', async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const loteId = Number(req.params.loteId);
        if (!loteId) {
            return res.status(400).json({ mensaje: 'El identificador de lote no es válido' });
        }

        if (!(await esLoteDelUsuario(loteId, usuarioId))) {
            return res.status(404).json({ mensaje: 'Lote no encontrado' });
        }

        const { estado, procesados, errores, totalRegistros, descripcion } = req.body ?? {};
        const actualizado = await actualizarEstadoLote(loteId, {
            estado,
            procesados,
            errores,
            totalRegistros,
            descripcion
        });

        res.json(actualizado);
    } catch (error) {
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.use('/importaciones', importacionesApi);

export default router;

import { Router } from 'express';
import { autenticar, autorizarRoles } from '../../middlewares/auth.middleware';
import { ROLES_LECTURA_DIRECCION, ROLES_GESTION_USUARIOS, ROLES_ELIMINAR_USUARIOS } from '../../utils/rbac';
import { pool } from '../../config/database';
import { construirContextoAuditoria, registrarEventoAuditoriaSegura } from '../auditoria/auditoria.service';
import { enviarPdfBuffer } from '../../utils/pdf-response';
import type { EstadoUsuario } from './usuarios.service';
import {
    actualizarDatosUsuario,
    actualizarEstadoUsuario,
    actualizarRolesUsuario,
    actualizarScopesUsuario,
    crearUsuario,
    eliminarUsuario,
    exportarUsuariosPdf,
    listarUsuarios,
    obtenerUsuarioPorId,
    resetearPasswordUsuario
} from './usuarios.service';

const router = Router();

const adminAuth = [autenticar, autorizarRoles(...ROLES_GESTION_USUARIOS)];
const lecturaAuth = [autenticar, autorizarRoles(...ROLES_LECTURA_DIRECCION)];

const ESTADOS: EstadoUsuario[] = ['activo', 'inactivo'];

/** Rutas bajo `/usuarios` (auth admin solo en este prefijo, no en toda la API). */
const usuariosApi = Router();

usuariosApi.get('/', async (req, res, next) => {
    try {
        const { estado, rol, q, limit } = req.query;
        const estadoFiltrado = typeof estado === 'string' && ESTADOS.includes(estado as EstadoUsuario)
            ? (estado as EstadoUsuario)
            : undefined;
        const usuarios = await listarUsuarios({
            estado: estadoFiltrado,
            rol: rol ? String(rol) : undefined,
            busqueda: q ? String(q) : undefined,
            limit: limit ? Number(limit) : undefined
        });
        res.json({ total: usuarios.length, datos: usuarios });
    } catch (error) {
        next(error);
    }
});

const ROL_CATEGORIAS = new Set(['admins', 'secretaria', 'directores', 'docentes']);

usuariosApi.post('/export/pdf', autorizarRoles(...ROLES_GESTION_USUARIOS), async (req, res, next) => {
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const { estado, rol, q, rolCategoria, orden } = req.body ?? {};

        const estadoFiltrado =
            typeof estado === 'string' && ESTADOS.includes(estado as EstadoUsuario) ? (estado as EstadoUsuario) : undefined;

        const cat =
            typeof rolCategoria === 'string' && ROL_CATEGORIAS.has(rolCategoria)
                ? (rolCategoria as 'admins' | 'secretaria' | 'directores' | 'docentes')
                : undefined;

        const usuarioId = contextoAuditoria.actorUsuarioId;
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }

        const exportacion = await exportarUsuariosPdf(
            {
                estado: estadoFiltrado,
                rol: typeof rol === 'string' && rol.trim() ? rol.trim() : undefined,
                busqueda: typeof q === 'string' && q.trim() ? q.trim() : undefined,
                rolCategoria: cat,
                orden: typeof orden === 'string' ? orden : undefined,
            },
            {
                exportedBy: contextoAuditoria.actorEmail ?? contextoAuditoria.actorUsuarioId,
                requestId: contextoAuditoria.requestId,
            },
            usuarioId
        );

        await registrarEventoAuditoriaSegura({
            modulo: 'usuarios',
            accion: 'exportar_usuarios_pdf',
            recursoTipo: 'reporte_usuarios',
            detalle: {
                filtros: { estado: estadoFiltrado, rol, q, rolCategoria: cat },
                total: exportacion.total,
            },
            despues: { actaId: exportacion.acta.id, url_documento: exportacion.acta.url_documento },
            contexto: contextoAuditoria,
        });

        res.setHeader('X-Acta-Id', String(exportacion.acta.id));
        enviarPdfBuffer(res, exportacion.buffer, exportacion.fileName, 201);
    } catch (error) {
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

usuariosApi.post('/', autorizarRoles(...ROLES_GESTION_USUARIOS), async (req, res, next) => {
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const { nombres, apellidos, email, username, usuario: usuarioAlias, telefono, password, roles, estado, persona, permisos, scope } = req.body ?? {};
        const usernameNormalizado = username ?? usuarioAlias;

        const usuarioCreado = await crearUsuario({
            nombres,
            apellidos,
            email,
            username: usernameNormalizado,
            telefono,
            password,
            roles,
            estado,
            persona,
            permisos,
            scope: scope ?? undefined
        });

        await registrarEventoAuditoriaSegura({
            modulo: 'usuarios',
            accion: 'crear_usuario',
            recursoTipo: 'usuario',
            recursoId: usuarioCreado.id,
            detalle: {
                email: usuarioCreado.email,
                roles: usuarioCreado.roles,
                estado: usuarioCreado.estado
            },
            despues: usuarioCreado,
            contexto: contextoAuditoria
        });

        res.status(201).json(usuarioCreado);
    } catch (error: any) {
        if (error?.code === '23505') {
            const detail: string = error?.detail ?? '';
            const errors: string[] = [];
            if (detail.includes('(email)')) {
                errors.push('El email ya se encuentra registrado.');
            }
            if (detail.includes('(username)')) {
                errors.push('El nombre de usuario ya está en uso.');
            }
            if (detail.includes('(telefono)') || detail.includes('telefono')) {
                errors.push('El número de teléfono ya está registrado.');
            }
            if (!errors.length) {
                errors.push('Ya existe un usuario con uno de los campos únicos duplicados.');
            }
            return res.status(409).json({ mensaje: errors.join(' '), errores: errors });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

usuariosApi.patch('/:usuarioId', autorizarRoles(...ROLES_GESTION_USUARIOS), async (req, res, next) => {
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const usuarioId = String(req.params.usuarioId);
        const usuarioAnterior = await obtenerUsuarioPorId(usuarioId);
        const { nombres, apellidos, telefono, email, username, usuario: usuarioAlias, permisos } = req.body ?? {};
        const usernameNormalizado = username ?? usuarioAlias;
        const usuarioActualizado = await actualizarDatosUsuario(usuarioId, {
            nombres,
            apellidos,
            telefono,
            email,
            username: usernameNormalizado,
            permisos
        });

        await registrarEventoAuditoriaSegura({
            modulo: 'usuarios',
            accion: 'actualizar_usuario',
            recursoTipo: 'usuario',
            recursoId: usuarioId,
            detalle: {
                campos: Object.keys(req.body ?? {})
            },
            antes: usuarioAnterior,
            despues: usuarioActualizado,
            contexto: contextoAuditoria
        });

        res.json(usuarioActualizado);
    } catch (error: any) {
        if (error?.code === '23505') {
            const detail: string = error?.detail ?? '';
            const errors: string[] = [];
            if (detail.includes('(email)')) {
                errors.push('El email ya se encuentra registrado.');
            }
            if (detail.includes('(username)')) {
                errors.push('El nombre de usuario ya está en uso.');
            }
            if (detail.includes('(telefono)') || detail.includes('telefono')) {
                errors.push('El número de teléfono ya está registrado.');
            }
            if (!errors.length) {
                errors.push('Ya existe un usuario con uno de los campos únicos duplicados.');
            }
            return res.status(409).json({ mensaje: errors.join(' '), errores: errors });
        }
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

usuariosApi.patch('/:usuarioId/scopes', autorizarRoles(...ROLES_GESTION_USUARIOS), async (req, res, next) => {
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const usuarioId = String(req.params.usuarioId);
        const usuarioAnterior = await obtenerUsuarioPorId(usuarioId);
        const { facultad_ids, carrera_ids } = req.body ?? {};
        const facultadIds = Array.isArray(facultad_ids) ? facultad_ids.map((n: unknown) => Number(n)).filter((n) => !Number.isNaN(n)) : [];
        const carreraIds = Array.isArray(carrera_ids) ? carrera_ids.map((n: unknown) => Number(n)).filter((n) => !Number.isNaN(n)) : [];
        const usuario = await actualizarScopesUsuario(usuarioId, {
            facultad_ids: facultadIds,
            carrera_ids: carreraIds
        });

        await registrarEventoAuditoriaSegura({
            modulo: 'usuarios',
            accion: 'actualizar_scopes_usuario',
            recursoTipo: 'usuario',
            recursoId: usuarioId,
            detalle: {
                facultad_ids: facultadIds,
                carrera_ids: carreraIds
            },
            antes: usuarioAnterior,
            despues: usuario,
            contexto: contextoAuditoria
        });

        res.json(usuario);
    } catch (error) {
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

usuariosApi.patch('/:usuarioId/estado', autorizarRoles(...ROLES_GESTION_USUARIOS), async (req, res, next) => {
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const usuarioId = String(req.params.usuarioId);
        const { estado } = req.body ?? {};
        if (!estado) {
            return res.status(400).json({ mensaje: 'estado es obligatorio' });
        }
        const usuarioAnterior = await obtenerUsuarioPorId(usuarioId);
        const usuario = await actualizarEstadoUsuario(usuarioId, estado);
        const nombreUsuario = usuarioAnterior
            ? `${usuarioAnterior.nombres} ${usuarioAnterior.apellidos}`.trim() || usuarioAnterior.email
            : null;
        const etiquetaEstado = (e: string | null | undefined) => {
            const x = (e ?? '').toLowerCase();
            if (x === 'activo') return 'Activo';
            if (x === 'inactivo' || x === 'suspendido') return 'Inactivo';
            return e?.trim() || '(sin estado)';
        };
        const recursoResumenEstado =
            nombreUsuario && usuarioAnterior
                ? `${nombreUsuario}: ${etiquetaEstado(usuarioAnterior.estado)} → ${etiquetaEstado(usuario.estado)}`
                : null;

        await registrarEventoAuditoriaSegura({
            modulo: 'usuarios',
            accion: 'actualizar_estado_usuario',
            recursoTipo: 'usuario',
            recursoId: usuarioId,
            recursoResumen: recursoResumenEstado,
            detalle: {
                estadoAnterior: usuarioAnterior?.estado ?? null,
                estadoNuevo: usuario.estado,
                nombreCompleto: nombreUsuario
            },
            antes: usuarioAnterior,
            despues: usuario,
            contexto: contextoAuditoria
        });

        res.json(usuario);
    } catch (error) {
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

usuariosApi.put('/:usuarioId/roles', autorizarRoles(...ROLES_GESTION_USUARIOS), async (req, res, next) => {
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const usuarioId = String(req.params.usuarioId);
        const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];
        if (!roles.length) {
            return res.status(400).json({ mensaje: 'roles es obligatorio' });
        }
        const usuarioAnterior = await obtenerUsuarioPorId(usuarioId);
        const usuario = await actualizarRolesUsuario(usuarioId, roles);

        await registrarEventoAuditoriaSegura({
            modulo: 'usuarios',
            accion: 'actualizar_roles_usuario',
            recursoTipo: 'usuario',
            recursoId: usuarioId,
            detalle: {
                rolesAnteriores: usuarioAnterior?.roles ?? [],
                rolesNuevos: usuario.roles
            },
            antes: usuarioAnterior,
            despues: usuario,
            contexto: contextoAuditoria
        });

        res.json(usuario);
    } catch (error) {
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

usuariosApi.post('/:usuarioId/reset-password', autorizarRoles(...ROLES_GESTION_USUARIOS), async (req, res, next) => {
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const usuarioId = String(req.params.usuarioId);
        const nuevaPassword = typeof req.body?.nuevaPassword === 'string' ? req.body.nuevaPassword : undefined;
        const usuarioAnterior = await obtenerUsuarioPorId(usuarioId);

        const resultado = await resetearPasswordUsuario(usuarioId, nuevaPassword);
        const usuarioPosterior = await obtenerUsuarioPorId(usuarioId);

        await registrarEventoAuditoriaSegura({
            modulo: 'usuarios',
            accion: 'reset_password_usuario',
            recursoTipo: 'usuario',
            recursoId: usuarioId,
            detalle: {
                temporalGenerada: !nuevaPassword
            },
            antes: usuarioAnterior,
            despues: usuarioPosterior,
            contexto: contextoAuditoria
        });

        res.json({ mensaje: 'Contraseña actualizada correctamente', ...resultado });
    } catch (error) {
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

usuariosApi.delete('/:usuarioId', autorizarRoles(...ROLES_ELIMINAR_USUARIOS), async (req, res, next) => {
    try {
        const contextoAuditoria = construirContextoAuditoria(req);
        const usuarioId = String(req.params.usuarioId);
        const usuarioAnterior = await obtenerUsuarioPorId(usuarioId);
        const nombreEliminado = usuarioAnterior
            ? `${usuarioAnterior.nombres} ${usuarioAnterior.apellidos}`.trim() || usuarioAnterior.email
            : null;
        await eliminarUsuario(usuarioId);

        await registrarEventoAuditoriaSegura({
            modulo: 'usuarios',
            accion: 'eliminar_usuario',
            recursoTipo: 'usuario',
            recursoId: usuarioId,
            recursoResumen: nombreEliminado ? `Usuario eliminado: ${nombreEliminado}` : null,
            detalle: {
                email: usuarioAnterior?.email ?? null,
                nombreCompleto: nombreEliminado
            },
            antes: usuarioAnterior,
            contexto: contextoAuditoria
        });

        res.status(204).send();
    } catch (error) {
        if (error instanceof Error) {
            return res.status(400).json({ mensaje: error.message });
        }
        next(error);
    }
});

router.use('/usuarios', ...lecturaAuth, usuariosApi);

const facultadesApi = Router();
facultadesApi.get('/', async (_req, res, next) => {
    try {
        const { rows } = await pool.query<{ id: number; nombre: string }>(
            `SELECT id, nombre FROM facultades WHERE estado = TRUE ORDER BY nombre`
        );
        res.json(rows);
    } catch (error) {
        next(error);
    }
});
router.use('/facultades', ...lecturaAuth, facultadesApi);

const carrerasApi = Router();
carrerasApi.get('/', async (req, res, next) => {
    try {
        const facultadId = req.query.facultad_id ? Number(req.query.facultad_id) : undefined;
        const { rows } = await pool.query<{ id: number; nombre: string; facultad_id: number }>(
            `SELECT id, nombre, facultad_id FROM carreras
             ${facultadId ? 'WHERE facultad_id = $1' : ''}
             ORDER BY nombre`,
            facultadId ? [facultadId] : []
        );
        res.json(rows);
    } catch (error) {
        next(error);
    }
});
router.use('/carreras', ...lecturaAuth, carrerasApi);

const scopesApi = Router();
scopesApi.get('/mis-alcances', autenticar, async (req, res, next) => {
    try {
        const usuarioId = req.usuario?.usuarioId;
        if (!usuarioId) {
            return res.status(401).json({ mensaje: 'No autenticado' });
        }
        const { rows } = await pool.query<{ facultad_id: number | null; carrera_id: number | null; facultad_nombre: string | null; carrera_nombre: string | null }>(
            `SELECT us.facultad_id, us.carrera_id, f.nombre AS facultad_nombre, c.nombre AS carrera_nombre
             FROM usuario_scopes us
             LEFT JOIN facultades f ON f.id = us.facultad_id
             LEFT JOIN carreras c ON c.id = us.carrera_id
             WHERE us.usuario_id = $1
             ORDER BY f.nombre, c.nombre`,
            [usuarioId]
        );
        const facultadesUnicas = new Map<number, string>();
        const carrerasUnicas = new Map<number, string>();
        for (const row of rows) {
            if (row.facultad_id != null && row.facultad_nombre) {
                facultadesUnicas.set(row.facultad_id, row.facultad_nombre);
            }
            if (row.carrera_id != null && row.carrera_nombre) {
                carrerasUnicas.set(row.carrera_id, row.carrera_nombre);
            }
        }
        res.json({
            facultades: Array.from(facultadesUnicas.entries()).map(([id, nombre]) => ({ id, nombre })),
            carreras: Array.from(carrerasUnicas.entries()).map(([id, nombre]) => ({ id, nombre })),
        });
    } catch (error) {
        next(error);
    }
});
router.use('/scopes', scopesApi);

export default router;

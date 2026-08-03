import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { env } from '../../config/env';
import { AuthPayload } from '../../middlewares/auth.middleware';
import { AuditoriaContexto, registrarEventoAuditoriaSegura } from '../auditoria/auditoria.service';
import { computeAllowedAppViews, computeHomeAppView } from '../../utils/navigation-policy';
import { normalizarNombresRoles } from '../../utils/role-names';

interface UsuarioDB {
    id: string;
    nombres: string;
    apellidos: string;
    email: string;
    usuario: string | null;
    password_hash: string;
    estado: string;
    roles: string[];
}

async function obtenerUsuarioPorIdentificador(identificador: string) {
    const trimmed = identificador.trim();

    if (trimmed.includes('@')) {
        const { rows } = await pool.query<UsuarioDB>(
            `SELECT u.id,
                    u.nombres,
                    u.apellidos,
                    u.email,
                    u.username AS usuario,
                    u.password_hash,
                    u.estado,
                    COALESCE(array_agg(r.nombre) FILTER (WHERE r.nombre IS NOT NULL), '{}') AS roles
             FROM usuarios u
             LEFT JOIN usuarios_roles ur ON ur.usuario_id = u.id
             LEFT JOIN roles r ON r.id = ur.rol_id
             WHERE u.email = $1
             GROUP BY u.id`,
            [trimmed]
        );
        const row = rows[0];
        return row ? { ...row, roles: normalizarNombresRoles(row.roles) } : null;
    }

    const normalizado = trimmed.toLowerCase();
    const { rows } = await pool.query<UsuarioDB>(
        `SELECT u.id,
                u.nombres,
                u.apellidos,
                u.email,
                u.username AS usuario,
                u.password_hash,
                u.estado,
                COALESCE(array_agg(r.nombre) FILTER (WHERE r.nombre IS NOT NULL), '{}') AS roles
         FROM usuarios u
         LEFT JOIN usuarios_roles ur ON ur.usuario_id = u.id
         LEFT JOIN roles r ON r.id = ur.rol_id
         WHERE u.username IS NOT NULL AND LOWER(u.username) = $1
         GROUP BY u.id`,
        [normalizado]
    );
    const row = rows[0];
    return row ? { ...row, roles: normalizarNombresRoles(row.roles) } : null;
}

async function obtenerUsuarioPorId(id: string) {
    const { rows } = await pool.query<UsuarioDB>(
        `SELECT u.id,
                u.nombres,
                u.apellidos,
                u.email,
                u.username AS usuario,
                u.password_hash,
                u.estado,
                COALESCE(array_agg(r.nombre) FILTER (WHERE r.nombre IS NOT NULL), '{}') AS roles
         FROM usuarios u
         LEFT JOIN usuarios_roles ur ON ur.usuario_id = u.id
         LEFT JOIN roles r ON r.id = ur.rol_id
         WHERE u.id = $1
         GROUP BY u.id`,
        [id]
    );
    const row = rows[0];
    return row ? { ...row, roles: normalizarNombresRoles(row.roles) } : null;
}

function generarTokenAcceso(usuario: UsuarioDB) {
    const payload: AuthPayload = {
        usuarioId: usuario.id,
        email: usuario.email,
        roles: usuario.roles
    };

    const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${env.JWT_EXP_MIN}m` });
    return { token, payload };
}

async function crearTokenRefresco(usuarioId: string) {
    const tokenId = randomUUID();
    const expiracion = new Date(Date.now() + env.JWT_REFRESH_EXP_DAYS * 24 * 60 * 60 * 1000);

    await pool.query(
        `INSERT INTO tokens_refresco (usuario_id, token, expiracion) VALUES ($1, $2, $3)`,
        [usuarioId, tokenId, expiracion]
    );

    const refreshToken = jwt.sign({ tokenId, usuarioId }, env.JWT_REFRESH_SECRET, {
        expiresIn: `${env.JWT_REFRESH_EXP_DAYS}d`
    });

    return refreshToken;
}

async function revocarTokenRefresco(tokenId: string) {
    await pool.query(`UPDATE tokens_refresco SET revocado = TRUE WHERE token = $1`, [tokenId]);
}

async function validarTokenRefresco(token: string) {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as { tokenId: string; usuarioId: string };
    const { rows } = await pool.query(
        `SELECT token, usuario_id, expiracion, revocado
         FROM tokens_refresco
         WHERE token = $1 AND usuario_id = $2 AND revocado = FALSE AND expiracion > NOW()`,
        [decoded.tokenId, decoded.usuarioId]
    );

    const registro = rows[0];
    if (!registro) {
        throw new Error('Refresh token inválido o expirado');
    }

    return { tokenId: decoded.tokenId, usuarioId: decoded.usuarioId };
}

export async function autenticarUsuario(identificador: string, password: string, contexto?: AuditoriaContexto) {
    const usuario = await obtenerUsuarioPorIdentificador(identificador);
    if (!usuario) {
        await registrarEventoAuditoriaSegura({
            modulo: 'auth',
            accion: 'login',
            recursoTipo: 'sesion',
            resultado: 'error',
            severidad: 'media',
            detalle: {
                identificador,
                motivo: 'credenciales_invalidas'
            },
            contexto
        });
        throw new Error('Credenciales inválidas');
    }

    if (usuario.estado !== 'activo') {
        await registrarEventoAuditoriaSegura({
            modulo: 'auth',
            accion: 'login',
            recursoTipo: 'sesion',
            recursoId: usuario.id,
            resultado: 'error',
            severidad: 'media',
            detalle: {
                identificador,
                motivo: 'usuario_no_activo',
                estado: usuario.estado
            },
            contexto: {
                ...contexto,
                actorUsuarioId: usuario.id,
                actorEmail: usuario.email,
                actorUsername: usuario.usuario ?? undefined,
                actorRoles: usuario.roles
            }
        });
        throw new Error('Usuario inactivo o suspendido');
    }

    const coincide = await bcrypt.compare(password, usuario.password_hash);
    if (!coincide) {
        await registrarEventoAuditoriaSegura({
            modulo: 'auth',
            accion: 'login',
            recursoTipo: 'sesion',
            recursoId: usuario.id,
            resultado: 'error',
            severidad: 'media',
            detalle: {
                identificador,
                motivo: 'credenciales_invalidas'
            },
            contexto: {
                ...contexto,
                actorUsuarioId: usuario.id,
                actorEmail: usuario.email,
                actorUsername: usuario.usuario ?? undefined,
                actorRoles: usuario.roles
            }
        });
        throw new Error('Credenciales inválidas');
    }

    const { token } = generarTokenAcceso(usuario);
    const refreshToken = await crearTokenRefresco(usuario.id);

    const datosPublicos = {
        id: usuario.id,
        nombres: usuario.nombres,
        apellidos: usuario.apellidos,
        email: usuario.email,
        usuario: usuario.usuario ?? usuario.email,
        roles: usuario.roles,
        vistasPermitidas: computeAllowedAppViews(usuario.roles),
        vistaInicio: computeHomeAppView(usuario.roles)
    };

    await registrarEventoAuditoriaSegura({
        modulo: 'auth',
        accion: 'login',
        recursoTipo: 'sesion',
        recursoId: usuario.id,
        resultado: 'ok',
        severidad: 'baja',
        detalle: {
            identificador,
            roles: usuario.roles
        },
        contexto: {
            ...contexto,
            actorUsuarioId: usuario.id,
            actorEmail: usuario.email,
            actorUsername: usuario.usuario ?? undefined,
            actorRoles: usuario.roles
        }
    });

    return { token, refreshToken, usuario: datosPublicos };
}

export async function refrescarSesion(refreshToken: string, contexto?: AuditoriaContexto) {
    const { tokenId, usuarioId } = await validarTokenRefresco(refreshToken);

    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');

        const { rowCount } = await cliente.query(
            `UPDATE tokens_refresco SET revocado = TRUE WHERE token = $1 AND revocado = FALSE`,
            [tokenId]
        );
        if (!rowCount) {
            await cliente.query('ROLLBACK');
            throw new Error('Refresh token ya revocado o no encontrado');
        }

        const { rows } = await cliente.query<UsuarioDB>(
            `SELECT u.id,
                    u.nombres,
                    u.apellidos,
                    u.email,
                    u.username AS usuario,
                    u.password_hash,
                    u.estado,
                    COALESCE(array_agg(r.nombre) FILTER (WHERE r.nombre IS NOT NULL), '{}') AS roles
             FROM usuarios u
             LEFT JOIN usuarios_roles ur ON ur.usuario_id = u.id
             LEFT JOIN roles r ON r.id = ur.rol_id
             WHERE u.id = $1
             GROUP BY u.id`,
            [usuarioId]
        );
        const usuario = rows[0] ? { ...rows[0], roles: normalizarNombresRoles(rows[0].roles) } : null;

        if (!usuario || usuario.estado !== 'activo') {
            await cliente.query('ROLLBACK');
            await registrarEventoAuditoriaSegura({
                modulo: 'auth',
                accion: 'refresh_token',
                recursoTipo: 'sesion',
                recursoId: usuarioId,
                resultado: 'error',
                severidad: 'media',
                detalle: {
                    motivo: 'usuario_no_disponible'
                },
                contexto: {
                    ...contexto,
                    actorUsuarioId: usuarioId
                }
            });
            throw new Error('Usuario no disponible');
        }

        const nuevoTokenId = randomUUID();
        const expiracion = new Date(Date.now() + env.JWT_REFRESH_EXP_DAYS * 24 * 60 * 60 * 1000);
        await cliente.query(
            `INSERT INTO tokens_refresco (usuario_id, token, expiracion) VALUES ($1, $2, $3)`,
            [usuario.id, nuevoTokenId, expiracion]
        );

        await cliente.query('COMMIT');

        const { token } = generarTokenAcceso(usuario);
        const nuevoRefresh = jwt.sign({ tokenId: nuevoTokenId, usuarioId: usuario.id }, env.JWT_REFRESH_SECRET, {
            expiresIn: `${env.JWT_REFRESH_EXP_DAYS}d`
        });

        const datosPublicos = {
            id: usuario.id,
            nombres: usuario.nombres,
            apellidos: usuario.apellidos,
            email: usuario.email,
            usuario: usuario.usuario ?? usuario.email,
            roles: usuario.roles,
            vistasPermitidas: computeAllowedAppViews(usuario.roles),
            vistaInicio: computeHomeAppView(usuario.roles)
        };

        return { token, refreshToken: nuevoRefresh, usuario: datosPublicos };
    } catch (error) {
        try { await cliente.query('ROLLBACK'); } catch (_e) { /* already rolled back or committed */ }
        throw error;
    } finally {
        cliente.release();
    }
}

export async function cerrarSesion(refreshToken: string, contexto?: AuditoriaContexto) {
    try {
        const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { tokenId: string; usuarioId?: string };
        await revocarTokenRefresco(decoded.tokenId);

        await registrarEventoAuditoriaSegura({
            modulo: 'auth',
            accion: 'logout',
            recursoTipo: 'sesion',
            recursoId: decoded.usuarioId,
            resultado: 'ok',
            severidad: 'baja',
            detalle: {
                tokenRevocado: true
            },
            contexto: {
                ...contexto,
                actorUsuarioId: contexto?.actorUsuarioId ?? decoded.usuarioId
            }
        });
    } catch (error) {
        await registrarEventoAuditoriaSegura({
            modulo: 'auth',
            accion: 'logout',
            recursoTipo: 'sesion',
            resultado: 'error',
            severidad: 'media',
            detalle: {
                motivo: error instanceof Error ? error.message : 'error_desconocido'
            },
            contexto
        });
        throw error;
    }
}

/**
 * Comprueba la contraseña del usuario ya autenticado (reautenticación antes de acciones sensibles).
 */
export async function verificarPasswordUsuarioAutenticado(usuarioId: string, password: string): Promise<void> {
    const raw = password != null ? String(password) : '';
    if (!raw.trim()) {
        throw new Error('La contraseña es obligatoria');
    }
    const usuario = await obtenerUsuarioPorId(usuarioId);
    if (!usuario) {
        throw new Error('No se pudo verificar la contraseña');
    }
    if (usuario.estado !== 'activo') {
        throw new Error('Usuario inactivo');
    }
    const coincide = await bcrypt.compare(raw, usuario.password_hash);
    if (!coincide) {
        throw new Error('Contraseña incorrecta');
    }
}

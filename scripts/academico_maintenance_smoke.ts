/*
 * Smoke de mantenimiento académico: crea/actualiza/borra módulo y curso.
 * Requiere: SUPABASE_DB_URL, JWT secrets ya cargados (.env). Usa datos de muestra si no hay SMOKE_*.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from '../src/config/database';
import {
    crearModulo,
    actualizarModulo,
    eliminarModulo,
    crearCurso,
    actualizarCurso,
    eliminarCurso
} from '../src/modules/academico/academico.service';

const FALLBACK_EMAIL = 'smoke+docente@demo.local';
const FALLBACK_USER = 'smoke-docente';

function readInt(name: string): number | null {
    const v = Number(process.env[name]);
    if (Number.isNaN(v)) return null;
    return v || null;
}

function readString(name: string): string | null {
    const v = process.env[name];
    return v || null;
}

async function ensureSampleData(): Promise<{ materiaId: number; docenteId: string }> {
    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');

        const { rows: facRows } = await cliente.query(
            `INSERT INTO facultades (nombre, estado)
             VALUES ($1, TRUE)
             ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
             RETURNING id`,
            ['Facultad Smoke']
        );
        const facultadId = facRows[0].id as number;

        const { rows: carrRows } = await cliente.query(
            `INSERT INTO carreras (facultad_id, nombre, codigo)
             VALUES ($1, $2, $3)
             ON CONFLICT (facultad_id, nombre) DO UPDATE SET codigo = EXCLUDED.codigo
             RETURNING id`,
            [facultadId, 'Carrera Smoke', 'SMK']
        );
        const carreraId = carrRows[0].id as number;

        const { rows: planRows } = await cliente.query(
            `INSERT INTO planes_estudio (carrera_id, nombre, resolucion)
             VALUES ($1, $2, $3)
             ON CONFLICT (carrera_id, nombre) DO UPDATE SET resolucion = EXCLUDED.resolucion
             RETURNING id`,
            [carreraId, 'Plan Smoke', 'SMK-2026']
        );
        const planId = planRows[0].id as number;

        const { rows: materiaRows } = await cliente.query(
            `INSERT INTO materias (plan_id, nombre, codigo, carga_horaria)
             VALUES ($1, $2, $3, 60)
             ON CONFLICT (plan_id, codigo) DO UPDATE SET nombre = EXCLUDED.nombre
             RETURNING id`,
            [planId, 'Materia Smoke', 'SMK-101']
        );
        const materiaId = materiaRows[0].id as number;

        const { rows: userRows } = await cliente.query(
            `INSERT INTO usuarios (nombres, apellidos, email, username, password_hash, estado, permisos_especiales)
             VALUES ($1, $2, $3, $4, $5, 'activo', '{}'::jsonb)
             ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username
             RETURNING id`,
            ['Smoke', 'Docente', FALLBACK_EMAIL, FALLBACK_USER, bcrypt.hashSync('demo', 8)]
        );
        const usuarioId = userRows[0].id as string;

        const { rows: docenteRows } = await cliente.query(
            `INSERT INTO docentes (usuario_id, legajo, titulo_academico)
             VALUES ($1, $2, $3)
             ON CONFLICT (usuario_id) DO UPDATE SET titulo_academico = EXCLUDED.titulo_academico
             RETURNING id`,
            [usuarioId, 'SMK-LEG', 'Profesor Smoke']
        );
        const docenteId = docenteRows[0].id as string;

        await cliente.query('COMMIT');
        return { materiaId, docenteId };
    } catch (error) {
        await cliente.query('ROLLBACK');
        throw error;
    } finally {
        cliente.release();
    }
}

function pickMonthAvoiding(current: number): number {
    // Usa el mes siguiente para reducir chances de duplicados.
    const next = ((current % 12) + 1);
    return next;
}

async function main() {
    const fallback = await ensureSampleData();
    const baseYear = new Date().getUTCFullYear();
    const baseMonth = new Date().getUTCMonth() + 1;
    const anio = readInt('SMOKE_ANIO') ?? baseYear;
    const mesCandidate = readInt('SMOKE_MES') ?? pickMonthAvoiding(baseMonth);
    const materiaId = readInt('SMOKE_MATERIA_ID') ?? fallback.materiaId;
    const docenteId = readString('SMOKE_DOCENTE_ID') ?? fallback.docenteId;

    let moduloId: number | null = null;
    let cursoId: number | null = null;

    try {
        console.log('--- Crear módulo');
        let mes = mesCandidate;
        for (let intento = 0; intento < 3; intento++) {
            try {
                const modulo = await crearModulo({
                    materiaId,
                    anio,
                    mes,
                    fechaInicio: `${anio}-${String(mes).padStart(2, '0')}-01`,
                    fechaFin: `${anio}-${String(mes).padStart(2, '0')}-28`,
                    estado: 'planificado'
                });
                moduloId = modulo.id;
                console.log('Módulo creado:', modulo);
                break;
            } catch (err) {
                if (err instanceof Error && err.message.includes('Ya existe un módulo')) {
                    mes = ((mes % 12) + 1);
                    continue;
                }
                throw err;
            }
        }
        if (!moduloId) {
            throw new Error('No se pudo crear un módulo tras varios intentos');
        }

        console.log('--- Crear curso');
        const curso = await crearCurso({
            moduloId,
            docenteId,
            aula: 'Lab Smoke',
            horarioInicio: '19:00',
            horarioFin: '21:00',
            cupo: 30,
            notas: 'Curso smoke'
        });
        cursoId = curso.id;
        console.log('Curso creado:', curso);

        console.log('--- Actualizar curso (aula/cupo)');
        const cursoUpd = await actualizarCurso(cursoId!, { aula: 'Lab 99', cupo: 35 });
        console.log('Curso actualizado:', cursoUpd);

        console.log('--- Cerrar módulo');
        const moduloCerrado = await actualizarModulo(moduloId, { estado: 'cerrado' });
        console.log('Módulo actualizado:', moduloCerrado);

        console.log('--- Intentar crear curso con módulo cerrado (debe fallar)');
        try {
            await crearCurso({ moduloId, docenteId, aula: 'No debería', horarioInicio: '10:00', horarioFin: '12:00' });
            throw new Error('Se esperaba fallo al crear curso en módulo cerrado');
        } catch (err) {
            if (err instanceof Error && err.message.includes('cerrado')) {
                console.log('Validación correcta al crear curso en módulo cerrado');
            } else {
                throw err;
            }
        }

        console.log('--- Eliminar curso');
        await eliminarCurso(cursoId!);
        cursoId = null;
        console.log('Curso eliminado');

        console.log('--- Eliminar módulo');
        await eliminarModulo(moduloId);
        moduloId = null;
        console.log('Módulo eliminado');

        console.log('Smoke de mantenimiento: OK');
    } finally {
        if (cursoId) {
            await eliminarCurso(cursoId).catch(() => undefined);
        }
        if (moduloId) {
            await eliminarModulo(moduloId).catch(() => undefined);
        }
        await pool.end();
    }
}

main().catch((err) => {
    console.error('Smoke mantenimiento falló:', err);
    process.exitCode = 1;
});

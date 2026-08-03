/*
 * Smoke test para módulo académico: crea módulo mensual, curso y (opcional) copia matrículas.
 * Requiere variables de entorno:
 *   SUPABASE_DB_URL, JWT_SECRET, JWT_REFRESH_SECRET (por compatibilidad con carga de env)
 *   SMOKE_MATERIA_ID (int)
 *   SMOKE_ANIO (int, ej 2026)
 *   SMOKE_MES (int 1-12)
 *   SMOKE_DOCENTE_ID (uuid de docentes.id)
 *   SMOKE_CURSO_ORIGEN_ID (opcional, int) para copiar matrículas al curso nuevo
 * Uso: npm run smoke:academico
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from '../src/config/database';
import {
    crearModulo,
    crearCurso,
    copiarMatriculasDesdeCurso
} from '../src/modules/academico/academico.service';

const FALLBACK_EMAIL = 'smoke+docente@demo.local';
const FALLBACK_USER = 'smoke-docente';

function readInt(name: string): number | null {
    const value = Number(process.env[name]);
    if (Number.isNaN(value)) return null;
    return value || null;
}

function readString(name: string): string | null {
    const value = process.env[name];
    return value || null;
}

function lastDayOfMonth(year: number, month: number): string {
    const end = new Date(Date.UTC(year, month, 0)); // month es 1-12; 0 = último día del mes previo
    return end.toISOString().slice(0, 10);
}

function firstDayOfMonth(year: number, month: number): string {
    const start = new Date(Date.UTC(year, month - 1, 1));
    return start.toISOString().slice(0, 10);
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

async function main() {
    const fallback = await ensureSampleData();

    const materiaId = readInt('SMOKE_MATERIA_ID') ?? fallback.materiaId;
    const anio = readInt('SMOKE_ANIO') ?? new Date().getUTCFullYear();
    const mes = readInt('SMOKE_MES') ?? new Date().getUTCMonth() + 1;
    const docenteId = readString('SMOKE_DOCENTE_ID') ?? fallback.docenteId;
    const cursoOrigenId = readInt('SMOKE_CURSO_ORIGEN_ID');

    console.log('--- Smoke académico: creando módulo');
    let modulo;
    let mesIntento = mes;
    for (let intento = 0; intento < 3; intento++) {
        try {
            modulo = await crearModulo({
                materiaId,
                anio,
                mes: mesIntento,
                fechaInicio: firstDayOfMonth(anio, mesIntento),
                fechaFin: lastDayOfMonth(anio, mesIntento),
                estado: 'planificado'
            });
            break;
        } catch (error) {
            if (error instanceof Error && error.message.includes('Ya existe un módulo')) {
                mesIntento = ((mesIntento % 12) + 1);
                continue;
            }
            throw error;
        }
    }

    if (!modulo) {
        throw new Error('No se pudo crear módulo tras varios intentos');
    }

    console.log('Módulo creado:', modulo);

    console.log('--- Creando curso asociado');
    const curso = await crearCurso({
        moduloId: modulo.id,
        docenteId,
        aula: 'Aula de prueba',
        horarioInicio: '18:00',
        horarioFin: '20:00',
        cupo: 60,
        notas: 'Smoke test'
    });
    console.log('Curso creado:', curso);

    if (cursoOrigenId) {
        console.log('--- Copiando matrículas desde curso origen', cursoOrigenId);
        const resultado = await copiarMatriculasDesdeCurso(curso.id, cursoOrigenId);
        console.log('Resultado copia:', resultado);
    } else {
        console.log('No se indicó SMOKE_CURSO_ORIGEN_ID; se omite copia de matrículas.');
    }
}

main()
    .catch((err) => {
        console.error('Smoke académico falló:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });

import { pool } from '../../config/database';

interface ListOptions {
  limit?: number;
}

interface FacultadListOptions extends ListOptions {
  /** Solo estas facultades (ids). */
  ids?: number[];
}

interface CarreraListOptions extends ListOptions {
  facultadId?: number;
  /** Carreras cuya facultad esté en la lista. */
  facultadIds?: number[];
  /** Solo estas carreras (ids). */
  carreraIds?: number[];
}

interface PlanListOptions extends ListOptions {
  carreraId?: number;
  facultadIds?: number[];
  carreraIds?: number[];
}

interface MateriaListOptions extends ListOptions {
  planId?: number;
  facultadIds?: number[];
  carreraIds?: number[];
}

function normalizeLimit(limit?: number, max = 2_000_000_000): number {
  if (!limit || Number.isNaN(limit)) return 2_000_000_000;
  return Math.min(Math.max(limit, 1), max);
}

export async function listarFacultades(options: FacultadListOptions = {}) {
  const limit = normalizeLimit(options.limit);
  const values: Array<number | number[]> = [];
  const conditions: string[] = [];

  const ids = options.ids?.filter((n) => Number.isFinite(n)) ?? [];
  if (ids.length > 0) {
    values.push(ids);
    conditions.push(`id = ANY($${values.length}::int[])`);
  }

  values.push(limit);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT id, nombre, estado, creado_en
     FROM facultades
     ${where}
     ORDER BY nombre ASC
     LIMIT $${values.length}`,
    values
  );
  return rows;
}

/** Facultades que contienen al menos una de las carreras indicadas (p. ej. alcance jefe/coord. de carrera). */
export async function listarFacultadesPorCarreraIds(carreraIds: number[]) {
  const ids = carreraIds.filter((n) => Number.isFinite(n));
  if (!ids.length) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT f.id, f.nombre, f.estado, f.creado_en
     FROM facultades f
     INNER JOIN carreras c ON c.facultad_id = f.id
     WHERE c.id = ANY($1::int[])
     ORDER BY f.nombre ASC`,
    [ids]
  );
  return rows;
}

export async function crearFacultad(input: { nombre: string; estado?: boolean }) {
  const { rows } = await pool.query(
    `INSERT INTO facultades (nombre, estado)
     VALUES ($1, $2)
     RETURNING id, nombre, estado, creado_en`,
    [input.nombre.trim(), input.estado ?? true]
  );
  return rows[0];
}

export async function actualizarFacultad(
  facultadId: number,
  input: { nombre?: string; estado?: boolean }
) {
  const sets: string[] = [];
  const values: Array<string | boolean | number> = [];

  if (input.nombre !== undefined) {
    values.push(input.nombre.trim());
    sets.push(`nombre = $${values.length}`);
  }

  if (input.estado !== undefined) {
    values.push(input.estado);
    sets.push(`estado = $${values.length}`);
  }

  if (!sets.length) {
    throw new Error('No hay campos para actualizar');
  }

  values.push(facultadId);

  const { rows } = await pool.query(
    `UPDATE facultades
     SET ${sets.join(', ')}
     WHERE id = $${values.length}
     RETURNING id, nombre, estado, creado_en`,
    values
  );

  if (!rows[0]) {
    throw new Error('Facultad no encontrada');
  }

  return rows[0];
}

export async function eliminarFacultad(facultadId: number) {
  const { rowCount } = await pool.query('DELETE FROM facultades WHERE id = $1', [facultadId]);
  if (!rowCount) {
    throw new Error('Facultad no encontrada');
  }
}

export async function listarCarreras(options: CarreraListOptions = {}) {
  const values: Array<number | number[]> = [];
  const conditions: string[] = [];

  if (options.facultadId) {
    values.push(options.facultadId);
    conditions.push(`c.facultad_id = $${values.length}`);
  }

  const facIds = options.facultadIds?.filter((n) => Number.isFinite(n)) ?? [];
  if (facIds.length > 0) {
    values.push(facIds);
    conditions.push(`c.facultad_id = ANY($${values.length}::int[])`);
  }

  const carIds = options.carreraIds?.filter((n) => Number.isFinite(n)) ?? [];
  if (carIds.length > 0) {
    values.push(carIds);
    conditions.push(`c.id = ANY($${values.length}::int[])`);
  }

  const limit = normalizeLimit(options.limit);
  values.push(limit);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT c.id, c.facultad_id, f.nombre AS facultad, c.nombre, c.codigo, c.creado_en
     FROM carreras c
     JOIN facultades f ON f.id = c.facultad_id
     ${where}
     ORDER BY f.nombre ASC, c.nombre ASC
     LIMIT $${values.length}`,
    values
  );

  return rows;
}

export async function crearCarrera(input: { facultadId: number; nombre: string; codigo?: string }) {
  const { rows } = await pool.query(
    `INSERT INTO carreras (facultad_id, nombre, codigo)
     VALUES ($1, $2, $3)
     RETURNING id, facultad_id, nombre, codigo, creado_en`,
    [input.facultadId, input.nombre.trim(), input.codigo?.trim() || null]
  );
  return rows[0];
}

export async function actualizarCarrera(
  carreraId: number,
  input: { facultadId?: number; nombre?: string; codigo?: string | null }
) {
  const sets: string[] = [];
  const values: Array<number | string | null> = [];

  if (input.facultadId !== undefined) {
    values.push(input.facultadId);
    sets.push(`facultad_id = $${values.length}`);
  }

  if (input.nombre !== undefined) {
    values.push(input.nombre.trim());
    sets.push(`nombre = $${values.length}`);
  }

  if (input.codigo !== undefined) {
    values.push(input.codigo ? input.codigo.trim() : null);
    sets.push(`codigo = $${values.length}`);
  }

  if (!sets.length) {
    throw new Error('No hay campos para actualizar');
  }

  values.push(carreraId);

  const { rows } = await pool.query(
    `UPDATE carreras
     SET ${sets.join(', ')}
     WHERE id = $${values.length}
     RETURNING id, facultad_id, nombre, codigo, creado_en`,
    values
  );

  if (!rows[0]) {
    throw new Error('Carrera no encontrada');
  }

  return rows[0];
}

export async function eliminarCarrera(carreraId: number) {
  const { rowCount } = await pool.query('DELETE FROM carreras WHERE id = $1', [carreraId]);
  if (!rowCount) {
    throw new Error('Carrera no encontrada');
  }
}

export async function listarPlanes(options: PlanListOptions = {}) {
  const values: Array<number | number[]> = [];
  const conditions: string[] = [];

  if (options.carreraId) {
    values.push(options.carreraId);
    conditions.push(`p.carrera_id = $${values.length}`);
  }

  const facIds = options.facultadIds?.filter((n) => Number.isFinite(n)) ?? [];
  if (facIds.length > 0) {
    values.push(facIds);
    conditions.push(`c.facultad_id = ANY($${values.length}::int[])`);
  }

  const carIds = options.carreraIds?.filter((n) => Number.isFinite(n)) ?? [];
  if (carIds.length > 0) {
    values.push(carIds);
    conditions.push(`p.carrera_id = ANY($${values.length}::int[])`);
  }

  const limit = normalizeLimit(options.limit);
  values.push(limit);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT p.id, p.carrera_id, c.nombre AS carrera, p.nombre, p.resolucion, p.anio_vigencia
     FROM planes_estudio p
     JOIN carreras c ON c.id = p.carrera_id
     ${where}
     ORDER BY c.nombre ASC, p.nombre ASC
     LIMIT $${values.length}`,
    values
  );

  return rows;
}

type FacultadMini = { id: number; nombre: string; estado: boolean };

type QueryExecutor = Pick<typeof pool, 'query'>;

/** Si `facultadId` no existe o es ≤ 0, busca o crea por `facultadNombre`. */
async function resolverFacultadIdParaPlan(
  exec: QueryExecutor,
  input: {
    facultadId?: number;
    facultadNombre?: string;
  }
): Promise<{ id: number; facultadResuelta?: FacultadMini }> {
  const fidIn = input.facultadId;
  if (fidIn != null && fidIn > 0) {
    const ex = await exec.query<FacultadMini>(
      'SELECT id, nombre, estado FROM facultades WHERE id = $1',
      [fidIn]
    );
    if (ex.rowCount) {
      return { id: fidIn };
    }
  }
  const nombre = input.facultadNombre?.trim();
  if (!nombre) {
    throw new Error('No se pudo identificar la facultad. Elegí facultad y carrera en los desplegables.');
  }
  const found = await exec.query<FacultadMini>(
    `SELECT id, nombre, estado FROM facultades WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))`,
    [nombre]
  );
  if (found.rowCount) {
    const r = found.rows[0];
    return { id: r.id, facultadResuelta: r };
  }
  try {
    const ins = await exec.query<FacultadMini>(
      `INSERT INTO facultades (nombre, estado) VALUES ($1, true)
       RETURNING id, nombre, estado`,
      [nombre]
    );
    const r = ins.rows[0];
    return { id: r.id, facultadResuelta: r };
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err?.code === '23505') {
      const again = await exec.query<FacultadMini>(
        `SELECT id, nombre, estado FROM facultades WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))`,
        [nombre]
      );
      if (!again.rowCount) throw e;
      const r = again.rows[0];
      return { id: r.id, facultadResuelta: r };
    }
    throw e;
  }
}

export async function crearPlan(input: {
  carreraId: number;
  /** Si `carreraId` ≤ 0 (sugerencia UI), obligatorio junto con `nombreCarrera` para crear/buscar la carrera en BD. */
  facultadId?: number;
  /** Si la facultad es sugerencia (id ≤ 0) o no existe, se usa para buscar/crear la facultad. */
  facultadNombre?: string;
  nombreCarrera?: string;
  nombre: string;
  resolucion?: string;
  anioVigencia?: number;
}): Promise<{
  plan: {
    id: number;
    carrera_id: number;
    nombre: string;
    resolucion: string | null;
    anio_vigencia: number | null;
  };
  carreraResuelta?: { id: number; facultad_id: number; nombre: string; codigo: string | null; creado_en?: Date };
  facultadResuelta?: FacultadMini;
}> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');

    let carreraResuelta: { id: number; facultad_id: number; nombre: string; codigo: string | null; creado_en?: Date } | undefined;
    let facultadResuelta: FacultadMini | undefined;
    let cid = input.carreraId;

    if (input.carreraId > 0) {
      const existe = await cliente.query('SELECT 1 FROM carreras WHERE id = $1', [input.carreraId]);
      if (!existe.rowCount) {
        await cliente.query('ROLLBACK');
        throw new Error(
          'La carrera no existe en la base de datos. Registrá la carrera en el sistema antes de crear un plan de estudio.'
        );
      }
    } else {
      const nombreCarrera = input.nombreCarrera?.trim();
      if (!nombreCarrera) {
        await cliente.query('ROLLBACK');
        throw new Error('Falta el nombre de la carrera para registrarla automáticamente al crear el plan.');
      }
      const { id: facultadRealId, facultadResuelta: facRow } = await resolverFacultadIdParaPlan(cliente, {
        facultadId: input.facultadId,
        facultadNombre: input.facultadNombre,
      });
      if (facRow) facultadResuelta = facRow;

      const found = await cliente.query(
        `SELECT id, facultad_id, nombre, codigo, creado_en FROM carreras
         WHERE facultad_id = $1 AND LOWER(TRIM(nombre)) = LOWER(TRIM($2))`,
        [facultadRealId, nombreCarrera]
      );
      let row: { id: number; facultad_id: number; nombre: string; codigo: string | null; creado_en?: Date };
      if (found.rowCount) {
        row = found.rows[0] as (typeof row);
        cid = row.id;
      } else {
        const codigo = `AUTO-${facultadRealId}-${Date.now().toString(36)}`.slice(0, 20);
        try {
          const ins = await cliente.query(
            `INSERT INTO carreras (facultad_id, nombre, codigo)
             VALUES ($1, $2, $3)
             RETURNING id, facultad_id, nombre, codigo, creado_en`,
            [facultadRealId, nombreCarrera, codigo]
          );
          row = ins.rows[0] as (typeof row);
          cid = row.id;
        } catch (e: unknown) {
          const err = e as { code?: string };
          if (err?.code === '23505') {
            const again = await cliente.query(
              `SELECT id, facultad_id, nombre, codigo, creado_en FROM carreras
               WHERE facultad_id = $1 AND LOWER(TRIM(nombre)) = LOWER(TRIM($2))`,
              [facultadRealId, nombreCarrera]
            );
            if (!again.rowCount) throw e;
            row = again.rows[0] as (typeof row);
            cid = row.id;
          } else {
            throw e;
          }
        }
      }
      carreraResuelta = row;
    }

    const { rows } = await cliente.query(
      `INSERT INTO planes_estudio (carrera_id, nombre, resolucion, anio_vigencia)
       VALUES ($1, $2, $3, $4)
       RETURNING id, carrera_id, nombre, resolucion, anio_vigencia`,
      [cid, input.nombre.trim(), input.resolucion?.trim() || null, input.anioVigencia ?? null]
    );

    await cliente.query('COMMIT');
    return { plan: rows[0], carreraResuelta, facultadResuelta };
  } catch (error) {
    try { await cliente.query('ROLLBACK'); } catch (_e) { /* already rolled back or committed */ }
    throw error;
  } finally {
    cliente.release();
  }
}

export async function actualizarPlan(
  planId: number,
  input: { carreraId?: number; nombre?: string; resolucion?: string | null; anioVigencia?: number | null }
) {
  const sets: string[] = [];
  const values: Array<number | string | null> = [];

  if (input.carreraId !== undefined) {
    const existe = await pool.query('SELECT 1 FROM carreras WHERE id = $1', [input.carreraId]);
    if (!existe.rowCount) {
      throw new Error('La carrera indicada no existe en la base de datos.');
    }
    values.push(input.carreraId);
    sets.push(`carrera_id = $${values.length}`);
  }

  if (input.nombre !== undefined) {
    values.push(input.nombre.trim());
    sets.push(`nombre = $${values.length}`);
  }

  if (input.resolucion !== undefined) {
    values.push(input.resolucion ? input.resolucion.trim() : null);
    sets.push(`resolucion = $${values.length}`);
  }

  if (input.anioVigencia !== undefined) {
    values.push(input.anioVigencia ?? null);
    sets.push(`anio_vigencia = $${values.length}`);
  }

  if (!sets.length) {
    throw new Error('No hay campos para actualizar');
  }

  values.push(planId);

  const { rows } = await pool.query(
    `UPDATE planes_estudio
     SET ${sets.join(', ')}
     WHERE id = $${values.length}
     RETURNING id, carrera_id, nombre, resolucion, anio_vigencia`,
    values
  );

  if (!rows[0]) {
    throw new Error('Plan no encontrado');
  }

  return rows[0];
}

export async function eliminarPlan(planId: number) {
  const { rows: mods } = await pool.query(
    `SELECT ma.id FROM modulos_academicos ma
     JOIN materias m ON m.id = ma.materia_id
     WHERE m.plan_id = $1 LIMIT 1`,
    [planId]
  );
  if (mods.length > 0) {
    throw new Error('No se puede eliminar el plan porque tiene materias con módulos académicos activos. Eliminá primero los módulos.');
  }
  const { rowCount } = await pool.query('DELETE FROM planes_estudio WHERE id = $1', [planId]);
  if (!rowCount) {
    throw new Error('Plan no encontrado');
  }
}

export async function listarMaterias(options: MateriaListOptions = {}) {
  const values: Array<number | number[]> = [];
  const conditions: string[] = [];

  if (options.planId) {
    values.push(options.planId);
    conditions.push(`m.plan_id = $${values.length}`);
  }

  const facIds = options.facultadIds?.filter((n) => Number.isFinite(n)) ?? [];
  if (facIds.length > 0) {
    values.push(facIds);
    conditions.push(`ca.facultad_id = ANY($${values.length}::int[])`);
  }

  const carIds = options.carreraIds?.filter((n) => Number.isFinite(n)) ?? [];
  if (carIds.length > 0) {
    values.push(carIds);
    conditions.push(`p.carrera_id = ANY($${values.length}::int[])`);
  }

  const limit = normalizeLimit(options.limit);
  values.push(limit);

  const needsCarreraJoin = facIds.length > 0 || carIds.length > 0;
  const joinCarrera = needsCarreraJoin ? 'JOIN carreras ca ON ca.id = p.carrera_id' : '';
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT m.id, m.plan_id, p.nombre AS plan, m.nombre, m.codigo, m.semestre
     FROM materias m
     JOIN planes_estudio p ON p.id = m.plan_id
     ${joinCarrera}
     ${where}
     ORDER BY p.nombre ASC, m.semestre ASC, m.nombre ASC
     LIMIT $${values.length}`,
    values
  );

  return rows;
}

function clampSemestre(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(10, Math.max(1, Math.floor(n)));
}

export async function crearMateria(input: { planId: number; nombre: string; codigo: string; semestre?: number }) {
  const sem = clampSemestre(input.semestre ?? 1);
  const { rows } = await pool.query(
    `INSERT INTO materias (plan_id, nombre, codigo, semestre)
     VALUES ($1, $2, $3, $4)
     RETURNING id, plan_id, nombre, codigo, semestre`,
    [input.planId, input.nombre.trim(), input.codigo.trim(), sem]
  );
  return rows[0];
}

export async function actualizarMateria(
  materiaId: number,
  input: { planId?: number; nombre?: string; codigo?: string; semestre?: number }
) {
  const sets: string[] = [];
  const values: Array<number | string> = [];

  if (input.planId !== undefined) {
    values.push(input.planId);
    sets.push(`plan_id = $${values.length}`);
  }

  if (input.nombre !== undefined) {
    values.push(input.nombre.trim());
    sets.push(`nombre = $${values.length}`);
  }

  if (input.codigo !== undefined) {
    values.push(input.codigo.trim());
    sets.push(`codigo = $${values.length}`);
  }

  if (input.semestre !== undefined) {
    values.push(clampSemestre(input.semestre));
    sets.push(`semestre = $${values.length}`);
  }

  if (!sets.length) {
    throw new Error('No hay campos para actualizar');
  }

  values.push(materiaId);

  const { rows } = await pool.query(
    `UPDATE materias
     SET ${sets.join(', ')}
     WHERE id = $${values.length}
     RETURNING id, plan_id, nombre, codigo, semestre`,
    values
  );

  if (!rows[0]) {
    throw new Error('Materia no encontrada');
  }

  return rows[0];
}

export async function eliminarMateria(materiaId: number) {
  const { rows: mods } = await pool.query(
    'SELECT id FROM modulos_academicos WHERE materia_id = $1 LIMIT 1',
    [materiaId]
  );
  if (mods.length > 0) {
    throw new Error('No se puede eliminar la materia porque tiene módulos académicos asociados. Eliminá primero los módulos.');
  }
  const { rowCount } = await pool.query('DELETE FROM materias WHERE id = $1', [materiaId]);
  if (!rowCount) {
    throw new Error('Materia no encontrada');
  }
}

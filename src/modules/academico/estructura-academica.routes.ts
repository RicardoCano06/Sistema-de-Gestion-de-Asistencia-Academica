import { Router } from 'express';
import { pool } from '../../config/database';
import { autenticarConPoliticaAlcance, autorizarRoles } from '../../middlewares/auth.middleware';
import { ROLES_ADMIN_O_ACADEMICOS, ROLES_GESTION_ACADEMICA_OPERATIVA, ROLES_LECTURA_DIRECCION } from '../../utils/rbac';
import {
  ForbiddenScopeError,
  assertCarreraIdEnAlcance,
  assertFacultadIdEnAlcance,
  assertMateriaIdEnAlcance,
  assertPlanIdEnAlcance,
  resolverAlcanceMatriculasFacultad,
} from '../../utils/alumnos-scope';
import {
  listarFacultades,
  listarFacultadesPorCarreraIds,
  crearFacultad,
  actualizarFacultad,
  eliminarFacultad,
  listarCarreras,
  crearCarrera,
  actualizarCarrera,
  eliminarCarrera,
  listarPlanes,
  crearPlan,
  actualizarPlan,
  eliminarPlan,
  listarMaterias,
  crearMateria,
  actualizarMateria,
  eliminarMateria,
} from './estructura-academica.service';
import { construirContextoAuditoria, registrarEventoAuditoriaSegura } from '../auditoria/auditoria.service';

const router = Router();

const mwAcademicos = autorizarRoles(...ROLES_ADMIN_O_ACADEMICOS);
const mwLecturaDireccion = autorizarRoles(...ROLES_LECTURA_DIRECCION);
const mwGestionOperativa = autorizarRoles(...ROLES_GESTION_ACADEMICA_OPERATIVA);

router.use(...autenticarConPoliticaAlcance);

router.get('/academico/facultades', mwLecturaDireccion, async (req, res, next) => {
  try {
    const usuarioId = req.usuario?.usuarioId;
    const roles = req.usuario?.roles ?? [];
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const alcance = usuarioId ? await resolverAlcanceMatriculasFacultad(usuarioId, roles) : { tipo: 'sin_restriccion' as const };

    if (alcance.tipo === 'carreras') {
      if (!alcance.carreraIds.length) {
        return res.json({ total: 0, datos: [] });
      }
      const datos = await listarFacultadesPorCarreraIds(alcance.carreraIds);
      return res.json({ total: datos.length, datos });
    }

    const ids = alcance.tipo === 'facultades' && alcance.facultadIds.length > 0 ? alcance.facultadIds : undefined;
    const datos = await listarFacultades({ limit, ids });
    res.json({ total: datos.length, datos });
  } catch (error) {
    next(error);
  }
});

router.post('/academico/facultades', mwAcademicos, async (req, res, next) => {
  try {
    const { nombre, estado } = req.body ?? {};
    if (!nombre) {
      return res.status(400).json({ mensaje: 'nombre es obligatorio' });
    }
    const creado = await crearFacultad({ nombre: String(nombre), estado: estado as boolean | undefined });
    res.status(201).json(creado);
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ mensaje: 'Ya existe una facultad con ese nombre' });
    }
    if (error instanceof Error) {
      return res.status(400).json({ mensaje: error.message });
    }
    next(error);
  }
});

router.patch('/academico/facultades/:facultadId', mwAcademicos, async (req, res, next) => {
  try {
    const facultadId = Number(req.params.facultadId);
    if (!facultadId) {
      return res.status(400).json({ mensaje: 'facultadId inválido' });
    }
    const actualizado = await actualizarFacultad(facultadId, {
      nombre: req.body?.nombre,
      estado: typeof req.body?.estado === 'boolean' ? req.body.estado : undefined,
    });
    res.json(actualizado);
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ mensaje: 'Ya existe una facultad con ese nombre' });
    }
    if (error instanceof Error) {
      return res.status(400).json({ mensaje: error.message });
    }
    next(error);
  }
});

router.delete('/academico/facultades/:facultadId', mwAcademicos, async (req, res, next) => {
  try {
    const facultadId = Number(req.params.facultadId);
    if (!facultadId) {
      return res.status(400).json({ mensaje: 'facultadId inválido' });
    }
    await eliminarFacultad(facultadId);
    res.status(204).send();
  } catch (error: any) {
    if (error?.code === '23503') {
      return res.status(409).json({ mensaje: 'No se puede eliminar la facultad porque tiene carreras asociadas' });
    }
    if (error instanceof Error) {
      return res.status(400).json({ mensaje: error.message });
    }
    next(error);
  }
});

router.get('/academico/carreras', mwLecturaDireccion, async (req, res, next) => {
  try {
    const usuarioId = req.usuario?.usuarioId;
    const roles = req.usuario?.roles ?? [];
    const facultadId = req.query.facultadId ? Number(req.query.facultadId) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const alcance = usuarioId ? await resolverAlcanceMatriculasFacultad(usuarioId, roles) : { tipo: 'sin_restriccion' as const };

    if (alcance.tipo === 'carreras') {
      if (!alcance.carreraIds.length) {
        return res.json({ total: 0, datos: [] });
      }
      const datos = await listarCarreras({ carreraIds: alcance.carreraIds, limit });
      return res.json({ total: datos.length, datos });
    }

    if (alcance.tipo === 'facultades') {
      if (!alcance.facultadIds.length) {
        return res.json({ total: 0, datos: [] });
      }
      if (facultadId != null && !alcance.facultadIds.includes(facultadId)) {
        return res.status(403).json({ mensaje: 'La facultad solicitada no está en tu alcance asignado.' });
      }
      const datos = await listarCarreras({
        facultadId: facultadId ?? undefined,
        facultadIds: facultadId == null ? alcance.facultadIds : undefined,
        limit,
      });
      return res.json({ total: datos.length, datos });
    }

    const datos = await listarCarreras({ facultadId, limit });
    res.json({ total: datos.length, datos });
  } catch (error) {
    next(error);
  }
});

router.post('/academico/carreras', mwGestionOperativa, async (req, res, next) => {
  try {
    const usuarioId = req.usuario?.usuarioId;
    const roles = req.usuario?.roles ?? [];
    const { facultadId, nombre, codigo } = req.body ?? {};
    if (!facultadId || !nombre) {
      return res.status(400).json({ mensaje: 'facultadId y nombre son obligatorios' });
    }
    if (usuarioId) {
      const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
      await assertFacultadIdEnAlcance(Number(facultadId), alcance);
    }
    const creado = await crearCarrera({ facultadId: Number(facultadId), nombre: String(nombre), codigo });
    res.status(201).json(creado);
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ mensaje: 'Carrera duplicada para la facultad o código ya existente' });
    }
    if (error instanceof ForbiddenScopeError) {
      return res.status(403).json({ mensaje: error.message });
    }
    if (error instanceof Error) {
      return res.status(400).json({ mensaje: error.message });
    }
    next(error);
  }
});

router.patch('/academico/carreras/:carreraId', mwGestionOperativa, async (req, res, next) => {
  try {
    const usuarioId = req.usuario?.usuarioId;
    const roles = req.usuario?.roles ?? [];
    const carreraId = Number(req.params.carreraId);
    if (!carreraId) {
      return res.status(400).json({ mensaje: 'carreraId inválido' });
    }
    if (usuarioId) {
      const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
      await assertCarreraIdEnAlcance(carreraId, alcance);
      if (req.body?.facultadId !== undefined) {
        await assertFacultadIdEnAlcance(Number(req.body.facultadId), alcance);
      }
    }
    const actualizado = await actualizarCarrera(carreraId, {
      facultadId: req.body?.facultadId !== undefined ? Number(req.body.facultadId) : undefined,
      nombre: req.body?.nombre,
      codigo: req.body?.codigo,
    });
    res.json(actualizado);
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ mensaje: 'Carrera duplicada para la facultad o código ya existente' });
    }
    if (error instanceof Error) {
      return res.status(400).json({ mensaje: error.message });
    }
    next(error);
  }
});

router.delete('/academico/carreras/:carreraId', mwGestionOperativa, async (req, res, next) => {
  try {
    const usuarioId = req.usuario?.usuarioId;
    const roles = req.usuario?.roles ?? [];
    const carreraId = Number(req.params.carreraId);
    if (!carreraId) {
      return res.status(400).json({ mensaje: 'carreraId inválido' });
    }
    if (usuarioId) {
      const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
      await assertCarreraIdEnAlcance(carreraId, alcance);
    }
    await eliminarCarrera(carreraId);
    res.status(204).send();
  } catch (error: any) {
    if (error?.code === '23503') {
      return res.status(409).json({ mensaje: 'No se puede eliminar la carrera porque tiene planes asociados' });
    }
    if (error instanceof Error) {
      return res.status(400).json({ mensaje: error.message });
    }
    next(error);
  }
});

router.get('/academico/planes', mwLecturaDireccion, async (req, res, next) => {
  try {
    const usuarioId = req.usuario?.usuarioId;
    const roles = req.usuario?.roles ?? [];
    const carreraId = req.query.carreraId ? Number(req.query.carreraId) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const alcance = usuarioId ? await resolverAlcanceMatriculasFacultad(usuarioId, roles) : { tipo: 'sin_restriccion' as const };
    if (alcance.tipo === 'carreras' && !alcance.carreraIds.length) {
      return res.json({ total: 0, datos: [] });
    }
    if (alcance.tipo === 'facultades' && !alcance.facultadIds.length) {
      return res.json({ total: 0, datos: [] });
    }
    if (carreraId != null && alcance.tipo === 'carreras' && !alcance.carreraIds.includes(carreraId)) {
      return res.status(403).json({ mensaje: 'La carrera solicitada no está en tu alcance asignado.' });
    }
    const datos = await listarPlanes({
      carreraId,
      limit,
      facultadIds: alcance.tipo === 'facultades' ? alcance.facultadIds : undefined,
      carreraIds: alcance.tipo === 'carreras' ? alcance.carreraIds : undefined,
    });
    res.json({ total: datos.length, datos });
  } catch (error) {
    next(error);
  }
});

router.post('/academico/planes', mwGestionOperativa, async (req, res, next) => {
  try {
    const usuarioId = req.usuario?.usuarioId;
    const roles = req.usuario?.roles ?? [];
    const { carreraId, facultadId, facultadNombre, nombreCarrera, nombre, resolucion, anioVigencia } = req.body ?? {};
    if (nombre == null || String(nombre).trim() === '') {
      return res.status(400).json({ mensaje: 'El nombre del plan es obligatorio' });
    }
    if (carreraId === undefined || carreraId === null || carreraId === '') {
      return res.status(400).json({ mensaje: 'carreraId es obligatorio' });
    }
    if (usuarioId) {
      const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
      await assertCarreraIdEnAlcance(Number(carreraId), alcance);
    }
    const resultado = await crearPlan({
      carreraId: Number(carreraId),
      facultadId:
        facultadId !== undefined && facultadId !== null && facultadId !== '' ? Number(facultadId) : undefined,
      facultadNombre: facultadNombre != null && facultadNombre !== '' ? String(facultadNombre) : undefined,
      nombreCarrera: nombreCarrera != null && nombreCarrera !== '' ? String(nombreCarrera) : undefined,
      nombre: String(nombre),
      resolucion: resolucion ? String(resolucion) : undefined,
      anioVigencia:
        anioVigencia !== undefined && anioVigencia !== null && anioVigencia !== '' ? Number(anioVigencia) : undefined,
    });
    res.status(201).json({
      ...resultado.plan,
      ...(resultado.carreraResuelta ? { carreraResuelta: resultado.carreraResuelta } : {}),
      ...(resultado.facultadResuelta ? { facultadResuelta: resultado.facultadResuelta } : {}),
    });
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ mensaje: 'Ya existe un plan con ese nombre para la carrera' });
    }
    if (error instanceof Error) {
      return res.status(400).json({ mensaje: error.message });
    }
    next(error);
  }
});

router.patch('/academico/planes/:planId', mwGestionOperativa, async (req, res, next) => {
  try {
    const usuarioId = req.usuario?.usuarioId;
    const roles = req.usuario?.roles ?? [];
    const planId = Number(req.params.planId);
    if (!planId) {
      return res.status(400).json({ mensaje: 'planId inválido' });
    }
    if (usuarioId) {
      const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
      await assertPlanIdEnAlcance(planId, alcance);
      if (req.body?.carreraId !== undefined) {
        await assertCarreraIdEnAlcance(Number(req.body.carreraId), alcance);
      }
    }
    const actualizado = await actualizarPlan(planId, {
      carreraId: req.body?.carreraId !== undefined ? Number(req.body.carreraId) : undefined,
      nombre: req.body?.nombre,
      resolucion: req.body?.resolucion,
      anioVigencia: req.body?.anioVigencia !== undefined ? Number(req.body.anioVigencia) : undefined,
    });
    res.json(actualizado);
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ mensaje: 'Ya existe un plan con ese nombre para la carrera' });
    }
    if (error instanceof Error) {
      return res.status(400).json({ mensaje: error.message });
    }
    next(error);
  }
});

router.delete('/academico/planes/:planId', mwGestionOperativa, async (req, res, next) => {
  try {
    const contextoAuditoria = construirContextoAuditoria(req);
    const usuarioId = req.usuario?.usuarioId;
    const roles = req.usuario?.roles ?? [];
    const planId = Number(req.params.planId);
    if (!planId) {
      return res.status(400).json({ mensaje: 'planId inválido' });
    }
    if (usuarioId) {
      const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
      await assertPlanIdEnAlcance(planId, alcance);
    }
    const { rows: pl } = await pool.query('SELECT nombre FROM planes_estudio WHERE id = $1', [planId]);
    await eliminarPlan(planId);
    await registrarEventoAuditoriaSegura({
      modulo: 'academico',
      accion: 'eliminar_plan',
      recursoTipo: 'plan',
      recursoId: planId,
      recursoResumen: pl[0] ? `Plan eliminado: ${pl[0].nombre}` : null,
      detalle: { planId, nombre: pl[0]?.nombre ?? null },
      contexto: contextoAuditoria,
    });
    res.status(204).send();
  } catch (error: any) {
    if (error?.code === '23503') {
      return res.status(409).json({ mensaje: 'No se puede eliminar el plan porque tiene materias asociadas' });
    }
    if (error instanceof Error) {
      return res.status(400).json({ mensaje: error.message });
    }
    next(error);
  }
});

router.get('/academico/materias', mwLecturaDireccion, async (req, res, next) => {
  try {
    const usuarioId = req.usuario?.usuarioId;
    const roles = req.usuario?.roles ?? [];
    const planId = req.query.planId ? Number(req.query.planId) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const alcance = usuarioId ? await resolverAlcanceMatriculasFacultad(usuarioId, roles) : { tipo: 'sin_restriccion' as const };
    if (alcance.tipo === 'carreras' && !alcance.carreraIds.length) {
      return res.json({ total: 0, datos: [] });
    }
    if (alcance.tipo === 'facultades' && !alcance.facultadIds.length) {
      return res.json({ total: 0, datos: [] });
    }
    if (planId != null && usuarioId) {
      await assertPlanIdEnAlcance(planId, alcance);
    }
    const datos = await listarMaterias({
      planId,
      limit,
      facultadIds: alcance.tipo === 'facultades' ? alcance.facultadIds : undefined,
      carreraIds: alcance.tipo === 'carreras' ? alcance.carreraIds : undefined,
    });
    res.json({ total: datos.length, datos });
  } catch (error) {
    if (error instanceof ForbiddenScopeError) {
      return res.status(403).json({ mensaje: error.message });
    }
    next(error);
  }
});

router.post('/academico/materias', mwGestionOperativa, async (req, res, next) => {
  try {
    const usuarioId = req.usuario?.usuarioId;
    const roles = req.usuario?.roles ?? [];
    const { planId, nombre, codigo, semestre } = req.body ?? {};
    if (!planId || !nombre || !codigo) {
      return res.status(400).json({ mensaje: 'planId, nombre y codigo son obligatorios' });
    }
    if (usuarioId) {
      const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
      await assertPlanIdEnAlcance(Number(planId), alcance);
    }
    const creado = await crearMateria({
      planId: Number(planId),
      nombre: String(nombre),
      codigo: String(codigo),
      semestre: semestre !== undefined && semestre !== null && semestre !== '' ? Number(semestre) : undefined,
    });
    res.status(201).json(creado);
  } catch (error: any) {
    if (error?.code === '23503') {
      return res.status(400).json({ mensaje: 'El plan de estudio seleccionado ya no existe. Verificá los datos e intentá de nuevo.' });
    }
    if (error?.code === '23505') {
      return res.status(409).json({ mensaje: 'Código de materia duplicado dentro del plan' });
    }
    if (error instanceof Error) {
      return res.status(400).json({ mensaje: error.message });
    }
    next(error);
  }
});

router.patch('/academico/materias/:materiaId', mwGestionOperativa, async (req, res, next) => {
  try {
    const usuarioId = req.usuario?.usuarioId;
    const roles = req.usuario?.roles ?? [];
    const materiaId = Number(req.params.materiaId);
    if (!materiaId) {
      return res.status(400).json({ mensaje: 'materiaId inválido' });
    }
    if (usuarioId) {
      const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
      await assertMateriaIdEnAlcance(materiaId, alcance);
      if (req.body?.planId !== undefined) {
        await assertPlanIdEnAlcance(Number(req.body.planId), alcance);
      }
    }
    const actualizado = await actualizarMateria(materiaId, {
      planId: req.body?.planId !== undefined ? Number(req.body.planId) : undefined,
      nombre: req.body?.nombre,
      codigo: req.body?.codigo,
      semestre:
        req.body?.semestre !== undefined && req.body?.semestre !== null && req.body?.semestre !== ''
          ? Number(req.body.semestre)
          : undefined,
    });
    res.json(actualizado);
  } catch (error: any) {
    if (error?.code === '23503') {
      return res.status(400).json({ mensaje: 'El plan de estudio seleccionado ya no existe. Verificá los datos e intentá de nuevo.' });
    }
    if (error?.code === '23505') {
      return res.status(409).json({ mensaje: 'Código de materia duplicado dentro del plan' });
    }
    if (error instanceof Error) {
      return res.status(400).json({ mensaje: error.message });
    }
    next(error);
  }
});

router.delete('/academico/materias/:materiaId', mwGestionOperativa, async (req, res, next) => {
  try {
    const contextoAuditoria = construirContextoAuditoria(req);
    const usuarioId = req.usuario?.usuarioId;
    const roles = req.usuario?.roles ?? [];
    const materiaId = Number(req.params.materiaId);
    if (!materiaId) {
      return res.status(400).json({ mensaje: 'materiaId inválido' });
    }
    if (usuarioId) {
      const alcance = await resolverAlcanceMatriculasFacultad(usuarioId, roles);
      await assertMateriaIdEnAlcance(materiaId, alcance);
    }
    const { rows: mat } = await pool.query('SELECT nombre, codigo FROM materias WHERE id = $1', [materiaId]);
    await eliminarMateria(materiaId);
    await registrarEventoAuditoriaSegura({
      modulo: 'academico',
      accion: 'eliminar_materia',
      recursoTipo: 'materia',
      recursoId: materiaId,
      recursoResumen: mat[0] ? `Materia eliminada: ${mat[0].nombre} (${mat[0].codigo})` : null,
      detalle: { materiaId, nombre: mat[0]?.nombre ?? null, codigo: mat[0]?.codigo ?? null },
      contexto: contextoAuditoria,
    });
    res.status(204).send();
  } catch (error: any) {
    if (error?.code === '23503') {
      return res.status(409).json({ mensaje: 'No se puede eliminar la materia porque tiene módulos asociados' });
    }
    if (error instanceof Error) {
      return res.status(400).json({ mensaje: error.message });
    }
    next(error);
  }
});

export default router;

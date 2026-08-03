import { Router } from 'express';
import healthRoutes from '../modules/health/health.routes';
import asistenciasRoutes from '../modules/asistencias/asistencias.routes';
import rolesRoutes from '../modules/roles/roles.routes';
import authRoutes from '../modules/auth/auth.routes';
import importacionesRoutes from '../modules/importaciones/importaciones.routes';
import reportesRoutes from '../modules/reportes/reportes.routes';
import usuariosRoutes from '../modules/usuarios/usuarios.routes';
import academicoRoutes from '../modules/academico/academico.routes';
import estructuraAcademicaRoutes from '../modules/academico/estructura-academica.routes';
import auditoriaRoutes from '../modules/auditoria/auditoria.routes';
import erroresFrontendRoutes from '../modules/errores-frontend/errores-frontend.routes';

const routes = Router();

routes.use(healthRoutes);
routes.use(asistenciasRoutes);
routes.use(rolesRoutes);
routes.use(authRoutes);
routes.use(importacionesRoutes);
routes.use(reportesRoutes);
routes.use(usuariosRoutes);
// Estructura (facultades/carreras/planes/materias) antes que académico operativo: comparten prefijo /academico/*;
// si académico va primero, su middleware de roles bloquea esas URLs antes de llegar acá.
routes.use(estructuraAcademicaRoutes);
routes.use(academicoRoutes);
routes.use(auditoriaRoutes);
routes.use(erroresFrontendRoutes);

export default routes;

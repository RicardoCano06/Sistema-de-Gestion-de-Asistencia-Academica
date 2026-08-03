# Despliegue: planilla autosuficiente y semestre curricular

Orden obligatorio y verificación con autenticación. No invertir pasos 2 y 4.

## Checklist

| Paso | Acción | Notas |
|------|--------|-------|
| 1 | Supabase **producción**, ventana de **tráfico cero** | Ver sección SQL abajo |
| 2 | Deploy **backend** en Heroku | Antes que el frontend |
| 3 | Verificar JSON de `/asistencias/planilla` **con token** | Ver sección Verificación |
| 4 | Deploy **frontend** en Vercel | Solo tras confirmar paso 3 |

---

## Paso 1 — Migración SQL (Supabase producción)

### 1a. Precheck de dependencias estructurales

Ejecutar `database/20260529_vw_resumen_asistencia_semestre_precheck.sql` en el SQL Editor.

- **0 filas:** seguir con la migración.
- **≥ 1 fila:** hay vistas/funciones dependientes. Planificar `DROP VIEW ... CASCADE` y recrear objetos afectados antes de continuar.

### 1b. Ventana de mantenimiento (concurrencia)

`DROP VIEW` adquiere `AccessExclusiveLock` sobre las tablas subyacentes. Si hay lecturas activas contra `vw_resumen_asistencia_curso` (panel, reportes, docentes conectados), el `DROP` puede **quedar bloqueado** y generar timeouts en Heroku.

**Ejecutar la migración solo con la plataforma fría** (madrugada, fin de semana, o ventana acordada sin usuarios).

Script: `database/20260529_vw_resumen_asistencia_semestre.sql`

---

## Paso 3 — Verificación del backend (autenticado)

Un `curl` sin credenciales responde **401/403** por el middleware JWT. No sirve para validar la forma del JSON.

### Opción A — curl con access token

1. Iniciar sesión en producción con un usuario de prueba (docente con curso asignado).
2. En DevTools → Application → Local Storage, copiar `accessToken` (o `token`).
3. Ejecutar (reemplazar `TOKEN` y `CURSO_ID`):

```bash
curl -sS \
  -H "Authorization: Bearer TOKEN" \
  "https://gestion-asistencias-ung-623e820b6ba1.herokuapp.com/api/asistencias/planilla?cursoId=CURSO_ID"
```

**Respuesta esperada (backend nuevo):**

```json
{
  "curso": {
    "curso_id": 123,
    "materia": "...",
    "semestre": 9,
    "carrera": "...",
    "fecha_inicio": "2026-03-01",
    "fecha_fin": "2026-06-30",
    ...
  },
  "total": 28,
  "datos": [ ... ]
}
```

Confirmar que `curso.semestre` es un número válido del plan de estudios (no derivado del mes del módulo).

### Opción B — pestaña Network (sin curl)

1. Usuario de prueba en producción, módulo Asistencias.
2. DevTools → Network → filtrar `planilla?cursoId=`.
3. Abrir la petición → Response → verificar objeto `curso` en la raíz.

Si `curso` no aparece, **no desplegar el frontend** hasta corregir el backend.

---

## Paso 4 — Frontend (Vercel)

El frontend tolera backend desfasado (sin crash), pero la cabecera en F5 depende de `curso` en `/planilla` hasta que el backend esté actualizado. Desplegar Vercel solo después del paso 3.

### sessionStorage y dispositivos compartidos

- `asistencias-docente-curso-id` se borra en `clearLocalSession()` (logout / sesión expirada).
- También se borra en **login exitoso** (`clearAsistenciasCursoIdPersistido`), como segunda barrera si el logout falló en navegadores con sessionStorage bloqueado (Safari privado estricto).
- En esos entornos restrictivos el borrado puede fallar silenciosamente; el cruce de `cursoId` entre usuarios puede persistir de forma intermitente. No hay API para forzar el borrado si el navegador lo impide.

---

## Resumen de archivos tocados

| Área | Archivo |
|------|---------|
| API planilla | `src/modules/asistencias/asistencias.service.ts`, `asistencias.routes.ts` |
| Vista SQL | `database/20260529_vw_resumen_asistencia_semestre.sql` |
| Frontend | `frontend/src/pages/AsistenciasDocentePage.tsx`, `frontend/src/utils/api.ts` |

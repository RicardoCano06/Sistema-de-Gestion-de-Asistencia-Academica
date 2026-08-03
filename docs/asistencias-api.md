# API de Asistencias y Justificaciones

Esta guía resume los endpoints disponibles bajo el prefijo `/api` relacionados con la gestión de asistencias, sesiones y justificaciones. Todos los endpoints requieren autenticación mediante JWT (`Authorization: Bearer <token>`) y respetan los roles definidos en el backend.

## Convenciones generales

- **Roles:** Docente, Coordinador y Administrador; cada endpoint detalla quiénes pueden acceder.
- **Fechas:** ISO 8601 (`YYYY-MM-DD`).
- **Respuestas de error:** `{ "mensaje": "descripcion" }` con códigos 400/401/403/404 según corresponda.

---

## 1. Planilla de asistencia

**GET** `/asistencias/planilla?cursoId=123&fecha=2026-08-15`

- Roles: Docente, Coordinador, Administrador.
- Parámetros:
  - `cursoId` (requerido)
  - `fecha` (opcional)
- Devuelve metadatos del curso en `curso` (materia, semestre, carrera, fechas del módulo, etc.) y el listado de filas por alumno en `datos`.
- Ejemplo: `{ "curso": { ... }, "total": 28, "datos": [ ... ] }`

## 2. Resumen por curso

**GET** `/asistencias/resumen/{cursoId}`

- Roles: Docente, Coordinador, Administrador.
- Devuelve métricas agregadas (totales, promedios, alumnos en riesgo, etc.).

## 3. Habilitados para examen

**GET** `/asistencias/habilitados/{cursoId}`

- Roles: Docente, Coordinador, Administrador.
- Lista quienes cumplen con los requisitos para rendir.

## 4. Sesiones de clase

### 4.1 Listar sesiones
**GET** `/asistencias/sesiones?cursoId=123&estado=abierta`

- Roles: Docente, Coordinador, Administrador.
- Para docentes `cursoId` es obligatorio; coordinación/admin pueden omitirlo.
- Filtra por estado opcionalmente (`programada`, `abierta`, `cerrada`, `cancelada`).

### 4.2 Crear sesión
**POST** `/asistencias/sesiones`

```json
{
  "cursoId": 123,
  "fecha": "2026-08-15",
  "observaciones": "Primer parcial"
}
```

- Roles: Docente, Coordinador, Administrador.
- Valida que no exista una sesión previa ese día.

### 4.3 Cerrar sesión
**POST** `/asistencias/sesiones/{sesionId}/cierre`

- Roles: Docente, Coordinador, Administrador
- Marca la sesión como `cerrada` y registra al usuario que realizó el cierre.

## 5. Registro de asistencias

**POST** `/asistencias/registro`

```json
{
  "sesionId": 55,
  "matriculaId": 987,
  "estado": "ausente",
  "justificada": false,
  "observaciones": "Llegó tarde"
}
```

- Roles: Docente, Coordinador, Administrador.
- `estado` admite `presente`, `ausente`, `justificada`.
- Controla que la matrícula pertenezca al curso de la sesión.
- Actualiza o inserta el registro según exista previamente.

## 6. Justificaciones

### 6.1 Registrar/actualizar justificación
**POST** `/asistencias/justificaciones`

```json
{
  "asistenciaId": 321,
  "motivo": "Trámite médico",
  "documentoUrl": "https://drive.example/justificante.pdf"
}
```

- Roles: Docente, Coordinador, Administrador.
- Crea o reemplaza la justificación asociada a una asistencia y la deja en estado `pendiente`.

### 6.2 Listar justificaciones
**GET** `/asistencias/justificaciones?cursoId=123&estado=pendiente`

- Roles: Docente (limitado a sus cursos), Coordinador y Administrador.
- Parámetros:
  - `cursoId`: obligatorio para docentes; opcional para coordinación/administración.
  - `estado`: `pendiente`, `aprobada`, `rechazada`.
- Devuelve datos de la justificación, alumno, curso y estado actual.

### 6.3 Resolver justificación
**POST** `/asistencias/justificaciones/{justificacionId}/resolucion`

```json
{
  "accion": "aprobar",
  "comentarios": "Se valida certificado"
}
```

- Roles: Coordinador, Administrador.
- `accion`: `aprobar` o `rechazar`.
- Al aprobar se actualiza la asistencia a `justificada`; al rechazar se deja `justificada = false`.

---

## Consideraciones adicionales

1. **Permisos:** Docentes solo pueden operar sobre cursos/sesiones en los que figuran asignados. Coordinadores y administradores pueden gestionar cualquier curso.
2. **Auditoría:** Campos `registrado_por`, `cerrado_por`, `revisado_por` permiten rastrear quién realizó cada acción.
3. **Pruebas sin datos reales:** se pueden usar los scripts de carga rápida (`database/insert_rapido.ts`) o inserts manuales para crear cursos, matrículas y sesiones ficticias y así validar cada endpoint antes de contar con información oficial.

# API Académico (Módulos Mensuales y Cursos)

Prefijo común: `/api/academico`. Requiere autenticación y roles administrativos/ académicos (ver `ROLES_ADMIN_O_ACADEMICOS`).

## 1. Módulos Académicos (mes a mes)

### Listar módulos
**GET** `/academico/modulos?anio=2026&mes=3&materiaId=10&estado=activo&limit=50`
- Parámetros opcionales: `anio`, `mes`, `materiaId`, `estado`, `limit` (1-200, por defecto 50).
- Respuesta: `total` y `datos` con módulo, materia, plan, carrera, fechas y estado.

### Crear módulo
**POST** `/academico/modulos`
```json
{
  "materiaId": 10,
  "anio": 2026,
  "mes": 3,
  "fechaInicio": "2026-03-01",
  "fechaFin": "2026-03-31",
  "estado": "planificado"
}
```
- Campos obligatorios: `materiaId`, `anio`, `mes`, `fechaInicio`, `fechaFin`.
- `estado` opcional (default `planificado`).

### Actualizar módulo
**PUT** `/academico/modulos/{moduloId}`
- Campos opcionales en el body: `materiaId`, `anio`, `mes`, `fechaInicio`, `fechaFin`, `estado`.
- Valida duplicados (materia + anio + mes) y mes entre 1-12.

### Eliminar módulo
**DELETE** `/academico/modulos/{moduloId}`
- Bloquea si existen cursos asociados.

## 2. Cursos (instancias mensuales)

### Listar cursos
**GET** `/academico/cursos?moduloId=5&materiaId=10&docenteId=uuid&anio=2026&mes=3&limit=50`
- Filtros opcionales: `moduloId`, `materiaId`, `docenteId`, `anio`, `mes`, `limit` (1-200, por defecto 50).
- Devuelve materia, docente, anio/mes del módulo, aula, horarios y conteo de inscriptos.

### Crear curso
**POST** `/academico/cursos`
```json
{
  "moduloId": 5,
  "docenteId": "uuid-docente",
  "aula": "Lab 3",
  "horarioInicio": "18:00",
  "horarioFin": "20:00",
  "cupo": 45,
  "notas": "Turno noche"
}
```
- Obligatorios: `moduloId`, `docenteId`.

### Actualizar curso
**PUT** `/academico/cursos/{cursoId}`
- Campos opcionales: `moduloId`, `docenteId`, `aula`, `horarioInicio`, `horarioFin`, `cupo`, `notas`.
- No permite mover/editar si el módulo está `cerrado` ni mover a módulo `cerrado`.

### Eliminar curso
**DELETE** `/academico/cursos/{cursoId}`
- Bloquea si existen matrículas asociadas.

### Copiar matrículas entre cursos
**POST** `/academico/cursos/{cursoDestinoId}/copiar-matriculas`
```json
{
  "desdeCursoId": 12
}
```
- Copia alumnos del curso origen al curso destino, evitando duplicados.
- Respuesta: `{ insertados, saltados, totalOrigen }`.

## Roles y seguridad
- Todos los endpoints están detrás de `autenticar` y `autorizarRoles(...ROLES_ADMIN_O_ACADEMICOS)`.
- Tokens JWT en header `Authorization: Bearer <token>`.

## Notas
- Los endpoints trabajan sobre las tablas: `modulos_academicos`, `cursos`, `matriculas`.
- Usar `anio/mes` para ubicar el módulo mensual conforme al ciclo operativo.
- Smoke test rápido: `npm run smoke:academico` usando variables `SMOKE_MATERIA_ID`, `SMOKE_ANIO`, `SMOKE_MES`, `SMOKE_DOCENTE_ID` y opcional `SMOKE_CURSO_ORIGEN_ID`.

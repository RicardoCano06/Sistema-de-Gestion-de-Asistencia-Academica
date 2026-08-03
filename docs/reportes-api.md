# API de Reportes y Alertas

Prefijo común: `/api/reportes`. Requiere autenticación y roles `Coordinador` o `Administrador`.

## 1. Alertas de asistencia

### Listar alertas
**GET** `/reportes/alertas?estado=pendiente&tipo=riesgo&cursoId=12&limit=50`

- Filtros opcionales: `estado`, `tipo` (`preventiva`, `riesgo`, `critica`), `cursoId`, `limit` (por defecto 100, máximo 500).
- Respuesta: `total` y `datos` con alumno, curso, tipo y fecha de generación.

### Actualizar estado
**PATCH** `/reportes/alertas/{alertaId}`

```json
{ "estado": "resuelta" }
```

- Cambia el campo `estado` de la alerta.

## 2. Resumenes por curso

**GET** `/reportes/resumen-cursos?anio=2026&mes=8&cursoId=15`

- Devuelve filas de `vw_resumen_asistencia_curso` (totales, alumnos en riesgo, promedio de asistencia, etc.).
- Permite filtrar por `cursoId`, `anio`, `mes` y `limit` (hasta 500).

## 3. Estadísticas de ausentismo

**GET** `/reportes/estadisticas?cursoId=10&periodo=2026-08`

- Extrae registros de `estadisticas_ausentismo` con totales de sesiones, faltas y porcentaje.
- Filtros: `cursoId`, `periodo`, `limit` (máximo 200).

### Recalcular estadísticas
**POST** `/reportes/estadisticas/recalcular`

```json
{
  "cursoId": 10,
  "periodo": "2026-08"
}
```

- Recalcula los totales para el curso y periodo indicado (por defecto, el mes actual) y realiza *upsert* sobre `estadisticas_ausentismo`.
- `periodo` usa el formato `YYYY-MM`. Si se omite, se usa el mes en curso.

## 4. Actas generadas

### Listar actas
**GET** `/reportes/actas?cursoId=15&tipo=asistencia`

- Retorna actas almacenadas con su URL y metadatos.

### Registrar acta
**POST** `/reportes/actas`

```json
{
  "cursoId": 15,
  "tipoActa": "asistencia",
  "urlDocumento": "https://supabase.storage/actas/curso15.pdf"
}
```

- Crea un registro en `actas_generadas` asociado al usuario autenticado.

---

Estos endpoints complementan los módulos de asistencias e importaciones, permitiendo a coordinación dar seguimiento a alertas, métricas y documentación formal del sistema.

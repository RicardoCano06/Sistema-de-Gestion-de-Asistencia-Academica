# Sistema de Control de Asistencia UNG

Plataforma web integral para la gestión y control de asistencia académica universitaria. Resuelve el problema de seguimiento manual de asistencias, cálculo de métricas y generación de informes legales en instituciones de educación superior.

## Stack Tecnológico

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Radix UI, Recharts
- **Backend:** Node.js, Express 5, TypeScript
- **Base de Datos:** PostgreSQL (Supabase)
- **Autenticación:** JWT (Access + Refresh Token Rotation)
- **Validación:** Zod
- **Almacenamiento:** Supabase Storage (PDFs, justificativos)
- **Despliegue:** Heroku (backend), Vercel (frontend)

## Demostración Visual

![Panel Principal](generated/assets/ung-logo.png)

> *Panel de control con gráficos de asistencia, alertas de riesgo y métricas en tiempo real.*

## Características Clave

- **Autenticación JWT con Refresh Token Rotation** — Login seguro con rotación automática de tokens, soporte para roles y scopes por facultad/carrera.
- **RBAC y Scope Enforcement** — Control de acceso basado en roles (Administrador, Jefe de Carrera, Docente, etc.) con filtrado de datos por unidad académica.
- **Recálculo Automático de Métricas** — Triggers en PostgreSQL recalculan porcentajes de asistencia, estado académico y habilitación de exámenes en tiempo real.
- **Generación de Informes PDF** — Planillas legales de asistencia, informes individuales de alumno, habilitados para examen y estadísticas de ausentismo.

## Ejecución Local

### Prerrequisitos

- Node.js 22+
- PostgreSQL (o cadena de conexión a Supabase)
- npm

### Instalación

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/sistema-control-asistencia.git
cd sistema-control-asistencia

# Instalar dependencias del backend
npm install

# Instalar dependencias del frontend
cd frontend
npm install
cd ..
```

### Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto basado en `.env.example`:

```bash
cp .env.example .env
```

Edita `.env` con tus valores de conexión y secretos.

### Desarrollo

```bash
# Iniciar backend (puerto 4000)
npm run dev

# En otra terminal, iniciar frontend (puerto 5173)
cd frontend
npm run dev
```

El frontend se conectará al backend en `http://localhost:4000/api`.

### Tests

```bash
npm test
```

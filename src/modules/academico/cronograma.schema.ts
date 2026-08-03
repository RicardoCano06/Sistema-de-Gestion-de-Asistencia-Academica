import { z } from 'zod';

export const semanaCronogramaSchema = z.object({
    semana_numero: z.number().int().positive('El número de semana debe ser mayor a 0'),
    fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)'),
    fecha_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)'),
    contenidos: z.array(z.string()).default([]),
    actividades: z.array(z.string()).default([]),
    horas: z.number().min(0, 'Las horas no pueden ser negativas').default(0),
});

export const evaluacionSchema = z.object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)').nullable().optional(),
    alcance_prueba: z.string().nullable().optional(),
});

export const cronogramaPayloadSchema = z.object({
    semanas: z.array(semanaCronogramaSchema).default([]),
    evaluacion_parcial: evaluacionSchema.default({}),
    evaluacion_final: evaluacionSchema.default({}),
});

export const cronogramaSemanaRowSchema = z.object({
    id: z.number().optional(),
    curso_id: z.number().optional(),
    semana_numero: z.number(),
    fecha_inicio: z.string(),
    fecha_fin: z.string(),
    contenidos: z.array(z.string()),
    actividades: z.array(z.string()),
    horas: z.number(),
    firmado: z.boolean().optional(),
    firmado_en: z.string().nullable().optional(),
    firmado_por: z.string().nullable().optional(),
});

export const cronogramaEvaluacionRowSchema = z.object({
    id: z.number().optional(),
    curso_id: z.number().optional(),
    tipo: z.enum(['parcial', 'final']),
    fecha: z.string().nullable().optional(),
    alcance_prueba: z.string().nullable().optional(),
    firmado: z.boolean().optional(),
    firmado_en: z.string().nullable().optional(),
    firmado_por: z.string().nullable().optional(),
});

export const cronogramaResponseSchema = z.object({
    semanas: z.array(cronogramaSemanaRowSchema),
    evaluaciones: z.array(cronogramaEvaluacionRowSchema),
});

export type CronogramaPayload = z.infer<typeof cronogramaPayloadSchema>;
export type CronogramaResponse = z.infer<typeof cronogramaResponseSchema>;
export type CronogramaSemanaInput = z.infer<typeof semanaCronogramaSchema>;
export type CronogramaEvaluacionInput = z.infer<typeof evaluacionSchema>;

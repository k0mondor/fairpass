import { z } from "zod";

import { eventStatuses, operationTypes, roles } from "../types/domain.js";

export const uuidSchema = z.string().uuid();
export const ticketIdSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const roleSchema = z.enum(roles);
export const eventStatusSchema = z.enum(eventStatuses);
export const operationTypeSchema = z.enum(operationTypes);
export const isoDateTimeSchema = z.string().datetime({ offset: true });

const queryInteger = (fallback: number, maximum?: number) =>
  z.preprocess(
    (value) => (value === undefined ? fallback : value),
    maximum === undefined
      ? z.coerce.number().int().min(1)
      : z.coerce.number().int().min(1).max(maximum),
  );

export const paginationQuerySchema = z.object({
  page: queryInteger(1),
  pageSize: queryInteger(20, 100),
});

export const eventListQuerySchema = paginationQuerySchema.extend({
  status: eventStatusSchema.optional(),
});

export const operationListQuerySchema = paginationQuerySchema.extend({
  type: operationTypeSchema.optional(),
});

export const eventIdParamsSchema = z.object({ eventId: uuidSchema }).strict();
export const ticketIdParamsSchema = z.object({ ticketId: ticketIdSchema }).strict();
export const emptyBodySchema = z.object({}).strict();

export const demoLoginBodySchema = z
  .object({
    account: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

export const transferTicketBodySchema = z
  .object({ toUserId: uuidSchema })
  .strict();

export const idempotencyKeySchema = uuidSchema;

export const createEventBodySchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().max(2000),
    location: z.string().trim().min(1).max(200),
    capacity: z.number().int().positive(),
    registrationDeadline: isoDateTimeSchema,
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const registrationDeadline = Date.parse(value.registrationDeadline);
    const startAt = Date.parse(value.startAt);
    const endAt = Date.parse(value.endAt);

    if (registrationDeadline >= startAt) {
      context.addIssue({
        code: "custom",
        path: ["registrationDeadline"],
        message: "registrationDeadline must be before startAt",
      });
    }
    if (startAt >= endAt) {
      context.addIssue({
        code: "custom",
        path: ["startAt"],
        message: "startAt must be before endAt",
      });
    }
  });

export type DemoLoginBody = z.infer<typeof demoLoginBodySchema>;
export type CreateEventBody = z.infer<typeof createEventBodySchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

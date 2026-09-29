import { Router } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import type { AuthService } from "../services/auth-service.js";
import type { EventCreationService } from "../services/event-creation-service.js";
import type { EventService } from "../services/event-service.js";
import type { RegistrationService } from "../services/registration-service.js";
import { sendData, sendPage } from "../utils/http-response.js";
import { parseInput } from "../validation/parse.js";
import {
  emptyBodySchema,
  createEventBodySchema,
  eventIdParamsSchema,
  eventListQuerySchema,
  idempotencyKeySchema,
} from "../validation/schemas.js";

export interface EventRouterDependencies {
  auth: AuthService;
  eventCreation: EventCreationService;
  events: EventService;
  registrations: RegistrationService;
}

export const createEventRouter = ({
  auth,
  eventCreation,
  events,
  registrations,
}: EventRouterDependencies): Router => {
  const router = Router();
  router.use(requireAuth(auth));

  router.post("/", requireRole("ORGANIZER"), async (request, response) => {
    const idempotencyKey = parseInput(
      idempotencyKeySchema,
      request.get("Idempotency-Key"),
    );
    const input = parseInput(createEventBodySchema, request.body);
    const result = await eventCreation.create({
      idempotencyKey,
      actorId: request.actor!.id,
      input,
    });
    response.locals.eventId = result.event.id;
    response.locals.txId = result.txId;
    sendData(response, result.event, result.replayed ? 200 : 201);
  });

  router.get("/", async (request, response) => {
    const query = parseInput(eventListQuerySchema, request.query);
    const result = await events.list(query);
    sendPage(response, result.data, result);
  });

  router.post(
    "/:eventId/registrations",
    requireRole("STUDENT"),
    (request, response) => {
      const { eventId } = parseInput(eventIdParamsSchema, request.params);
      parseInput(emptyBodySchema, request.body);
      const registration = registrations.register(eventId, request.actor!.id);
      sendData(response, registration, 201);
    },
  );

  router.get("/:eventId", async (request, response) => {
    const { eventId } = parseInput(eventIdParamsSchema, request.params);
    const detail = await events.getDetail(eventId, request.actor!);
    sendData(response, detail);
  });

  return router;
};

import { Router } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import type { AuthService } from "../services/auth-service.js";
import type { DrawService } from "../services/draw-service.js";
import type { EventCreationService } from "../services/event-creation-service.js";
import type { EventService } from "../services/event-service.js";
import type { OperationService } from "../services/operation-service.js";
import type { RegistrationService } from "../services/registration-service.js";
import type { TicketService } from "../services/ticket-service.js";
import { sendData, sendPage } from "../utils/http-response.js";
import { parseInput } from "../validation/parse.js";
import {
  emptyBodySchema,
  createEventBodySchema,
  eventIdParamsSchema,
  eventListQuerySchema,
  idempotencyKeySchema,
  operationListQuerySchema,
} from "../validation/schemas.js";

export interface EventRouterDependencies {
  auth: AuthService;
  draws: DrawService;
  eventCreation: EventCreationService;
  events: EventService;
  operations: OperationService;
  registrations: RegistrationService;
  tickets: TicketService;
}

export const createEventRouter = ({
  auth,
  draws,
  eventCreation,
  events,
  operations,
  registrations,
  tickets,
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

  router.post(
    "/:eventId/tickets/claim",
    requireRole("STUDENT"),
    async (request, response) => {
      const { eventId } = parseInput(eventIdParamsSchema, request.params);
      parseInput(emptyBodySchema, request.body);
      const result = await tickets.claim(eventId, request.actor!.id);
      response.locals.eventId = eventId;
      response.locals.ticketId = result.ticket.id;
      if (result.txId) response.locals.txId = result.txId;
      sendData(response, result.ticket, 201);
    },
  );

  router.post(
    "/:eventId/draw",
    requireRole("ORGANIZER"),
    async (request, response) => {
      const { eventId } = parseInput(eventIdParamsSchema, request.params);
      parseInput(emptyBodySchema, request.body);
      const result = await draws.publish(eventId, request.actor!.id);
      response.locals.eventId = eventId;
      response.locals.txId = result.txId;
      sendData(response, result);
    },
  );

  router.get(
    "/:eventId/operations",
    requireRole("ORGANIZER"),
    async (request, response) => {
      const { eventId } = parseInput(eventIdParamsSchema, request.params);
      const query = parseInput(operationListQuerySchema, request.query);
      response.locals.eventId = eventId;
      const result = await operations.listForEvent(
        eventId,
        request.actor!.id,
        query,
      );
      sendPage(response, result.data, result);
    },
  );

  router.get(
    "/:eventId/draw",
    requireRole("ORGANIZER"),
    (request, response) => {
      const { eventId } = parseInput(eventIdParamsSchema, request.params);
      response.locals.eventId = eventId;
      const result = draws.getStatus(eventId, request.actor!.id);
      sendData(response, result);
    },
  );

  router.get("/:eventId", async (request, response) => {
    const { eventId } = parseInput(eventIdParamsSchema, request.params);
    const detail = await events.getDetail(eventId, request.actor!);
    sendData(response, detail);
  });

  return router;
};

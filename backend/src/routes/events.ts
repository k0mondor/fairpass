import { Router } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import type { AuthService } from "../services/auth-service.js";
import type { EventService } from "../services/event-service.js";
import type { RegistrationService } from "../services/registration-service.js";
import { sendData, sendPage } from "../utils/http-response.js";
import { parseInput } from "../validation/parse.js";
import {
  emptyBodySchema,
  eventIdParamsSchema,
  eventListQuerySchema,
} from "../validation/schemas.js";

export interface EventRouterDependencies {
  auth: AuthService;
  events: EventService;
  registrations: RegistrationService;
}

export const createEventRouter = ({
  auth,
  events,
  registrations,
}: EventRouterDependencies): Router => {
  const router = Router();
  router.use(requireAuth(auth));

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

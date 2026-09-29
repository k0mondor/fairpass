import { Router } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import type { AuthService } from "../services/auth-service.js";
import type { EventService } from "../services/event-service.js";
import type { RegistrationService } from "../services/registration-service.js";
import { sendPage } from "../utils/http-response.js";
import { parseInput } from "../validation/parse.js";
import {
  eventListQuerySchema,
  paginationQuerySchema,
} from "../validation/schemas.js";

export interface MeRouterDependencies {
  auth: AuthService;
  events: EventService;
  registrations: RegistrationService;
}

export const createMeRouter = ({
  auth,
  events,
  registrations,
}: MeRouterDependencies): Router => {
  const router = Router();
  router.use(requireAuth(auth));

  router.get("/events", requireRole("ORGANIZER"), async (request, response) => {
    const query = parseInput(eventListQuerySchema, request.query);
    const result = await events.listForOrganizer(request.actor!.id, query);
    sendPage(response, result.data, result);
  });

  router.get(
    "/registrations",
    requireRole("STUDENT"),
    async (request, response) => {
      const query = parseInput(paginationQuerySchema, request.query);
      const result = await registrations.listForStudent(
        request.actor!.id,
        query.page,
        query.pageSize,
      );
      sendPage(response, result.data, result);
    },
  );

  return router;
};

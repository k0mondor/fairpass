import { Router } from "express";

import type { AuthService } from "../services/auth-service.js";
import type { DrawService } from "../services/draw-service.js";
import type { EventCreationService } from "../services/event-creation-service.js";
import type { EventService } from "../services/event-service.js";
import type { RegistrationService } from "../services/registration-service.js";
import type { TicketService } from "../services/ticket-service.js";
import { createAuthRouter } from "./auth.js";
import { createEventRouter } from "./events.js";
import { createMeRouter } from "./me.js";
import { createTicketRouter } from "./tickets.js";

export interface ApiRouterDependencies {
  auth: AuthService;
  draws: DrawService;
  eventCreation: EventCreationService;
  events: EventService;
  registrations: RegistrationService;
  tickets: TicketService;
}

export const createApiRouter = (dependencies: ApiRouterDependencies): Router => {
  const router = Router();
  router.use("/auth", createAuthRouter(dependencies.auth));
  router.use("/events", createEventRouter(dependencies));
  router.use("/me", createMeRouter(dependencies));
  router.use("/tickets", createTicketRouter(dependencies));
  return router;
};

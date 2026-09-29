import { Router } from "express";

import type { AuthService } from "../services/auth-service.js";
import type { EventCreationService } from "../services/event-creation-service.js";
import type { EventService } from "../services/event-service.js";
import type { RegistrationService } from "../services/registration-service.js";
import { createAuthRouter } from "./auth.js";
import { createEventRouter } from "./events.js";
import { createMeRouter } from "./me.js";

export interface ApiRouterDependencies {
  auth: AuthService;
  eventCreation: EventCreationService;
  events: EventService;
  registrations: RegistrationService;
}

export const createApiRouter = (dependencies: ApiRouterDependencies): Router => {
  const router = Router();
  router.use("/auth", createAuthRouter(dependencies.auth));
  router.use("/events", createEventRouter(dependencies));
  router.use("/me", createMeRouter(dependencies));
  return router;
};

import { Router } from "express";

import type { AuthService } from "../services/auth-service.js";
import { createAuthRouter } from "./auth.js";

export interface ApiRouterDependencies {
  auth: AuthService;
}

export const createApiRouter = ({ auth }: ApiRouterDependencies): Router => {
  const router = Router();
  router.use("/auth", createAuthRouter(auth));
  return router;
};

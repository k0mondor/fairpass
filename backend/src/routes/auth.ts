import { Router } from "express";

import { requireAuth } from "../middleware/auth.js";
import type { AuthService } from "../services/auth-service.js";
import { sendData } from "../utils/http-response.js";
import { parseInput } from "../validation/parse.js";
import { demoLoginBodySchema } from "../validation/schemas.js";

export const createAuthRouter = (auth: AuthService): Router => {
  const router = Router();

  router.post("/demo-login", async (request, response) => {
    const body = parseInput(demoLoginBodySchema, request.body);
    const result = await auth.login(body.account);
    sendData(response, result);
  });

  router.get("/me", requireAuth(auth), (request, response) => {
    sendData(response, request.actor);
  });

  return router;
};

import { Router } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import type { AuthService } from "../services/auth-service.js";
import type { TicketService } from "../services/ticket-service.js";
import { sendData } from "../utils/http-response.js";
import { parseInput } from "../validation/parse.js";
import {
  emptyBodySchema,
  ticketIdParamsSchema,
  transferTicketBodySchema,
} from "../validation/schemas.js";

export interface TicketRouterDependencies {
  auth: AuthService;
  tickets: TicketService;
}

export const createTicketRouter = ({
  auth,
  tickets,
}: TicketRouterDependencies): Router => {
  const router = Router();
  router.use(requireAuth(auth));

  router.get("/:ticketId", async (request, response) => {
    const { ticketId } = parseInput(ticketIdParamsSchema, request.params);
    response.locals.ticketId = ticketId;
    const ticket = await tickets.get(ticketId, request.actor!);
    response.locals.eventId = ticket.eventId;
    sendData(response, ticket);
  });

  router.post(
    "/:ticketId/transfer",
    requireRole("STUDENT"),
    async (request, response) => {
      const { ticketId } = parseInput(ticketIdParamsSchema, request.params);
      const { toUserId } = parseInput(transferTicketBodySchema, request.body);
      response.locals.ticketId = ticketId;
      const result = await tickets.transfer(
        ticketId,
        request.actor!.id,
        toUserId,
      );
      response.locals.eventId = result.ticket.eventId;
      if (result.txId) response.locals.txId = result.txId;
      sendData(response, result.ticket);
    },
  );

  router.post(
    "/:ticketId/redeem",
    requireRole("INSPECTOR"),
    async (request, response) => {
      const { ticketId } = parseInput(ticketIdParamsSchema, request.params);
      parseInput(emptyBodySchema, request.body);
      response.locals.ticketId = ticketId;
      const result = await tickets.redeem(ticketId, request.actor!.id);
      response.locals.eventId = result.ticket.eventId;
      response.locals.txId = result.operation.txId;
      sendData(response, result);
    },
  );

  return router;
};

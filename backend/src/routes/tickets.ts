import { Router } from "express";

import { requireAuth, requireRole } from "../middleware/auth.js";
import type { AuthService } from "../services/auth-service.js";
import type { OperationService } from "../services/operation-service.js";
import type { TicketService } from "../services/ticket-service.js";
import { sendData, sendPage } from "../utils/http-response.js";
import { parseInput } from "../validation/parse.js";
import {
  emptyBodySchema,
  paginationQuerySchema,
  ticketIdParamsSchema,
  transferTicketBodySchema,
} from "../validation/schemas.js";

export interface TicketRouterDependencies {
  auth: AuthService;
  operations: OperationService;
  tickets: TicketService;
}

export const createTicketRouter = ({
  auth,
  operations,
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

  router.get("/:ticketId/operations", async (request, response) => {
    const { ticketId } = parseInput(ticketIdParamsSchema, request.params);
    const query = parseInput(paginationQuerySchema, request.query);
    response.locals.ticketId = ticketId;
    const result = await operations.listForTicket(
      ticketId,
      request.actor!,
      query.page,
      query.pageSize,
    );
    sendPage(response, result.data, result);
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

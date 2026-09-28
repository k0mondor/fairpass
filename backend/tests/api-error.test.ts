import { describe, expect, it } from "vitest";

import {
  ApiError,
  errorStatusByCode,
  type ApiErrorCode,
} from "../src/errors/api-error.js";

const expectedStatuses: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_TICKET_OWNER: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  ALREADY_REGISTERED: 409,
  DRAW_IN_PROGRESS: 409,
  ALREADY_DRAWN: 409,
  NOT_WINNER: 409,
  ALREADY_CLAIMED: 409,
  SOLD_OUT: 409,
  TRANSFER_LIMIT_REACHED: 409,
  INVALID_RECIPIENT: 409,
  ALREADY_REDEEMED: 409,
  REGISTRATION_CLOSED: 422,
  DRAW_NOT_READY: 422,
  CLAIM_CLOSED: 422,
  TRANSFER_CLOSED: 422,
  CHECKIN_CLOSED: 422,
  FABRIC_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

describe("API error mapping", () => {
  it("keeps every stable error code bound to its HTTP status", () => {
    expect(errorStatusByCode).toEqual(expectedStatuses);
  });

  it("creates an error from the stable mapping", () => {
    const error = new ApiError("FABRIC_UNAVAILABLE", "Fabric 暂不可用");

    expect(error.code).toBe("FABRIC_UNAVAILABLE");
    expect(error.status).toBe(503);
    expect(error.message).toBe("Fabric 暂不可用");
  });
});

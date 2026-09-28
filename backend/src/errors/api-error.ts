export const errorStatusByCode = {
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
} as const;

export type ApiErrorCode = keyof typeof errorStatusByCode;

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiError";
    this.code = code;
    this.status = errorStatusByCode[code];
  }
}

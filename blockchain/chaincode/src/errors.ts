/**
 * Business errors are thrown as "CODE:message" so the backend can map them to
 * its stable API error codes (docs/API_V1.md). Keep the code list in sync with
 * docs/BLOCKCHAIN_TASK.md section 2.
 */

export const ErrorCode = {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    ALREADY_DRAWN: 'ALREADY_DRAWN',
    DRAW_NOT_READY: 'DRAW_NOT_READY',
    NOT_WINNER: 'NOT_WINNER',
    ALREADY_CLAIMED: 'ALREADY_CLAIMED',
    SOLD_OUT: 'SOLD_OUT',
    CLAIM_CLOSED: 'CLAIM_CLOSED',
    NOT_TICKET_OWNER: 'NOT_TICKET_OWNER',
    TRANSFER_CLOSED: 'TRANSFER_CLOSED',
    TRANSFER_LIMIT_REACHED: 'TRANSFER_LIMIT_REACHED',
    INVALID_RECIPIENT: 'INVALID_RECIPIENT',
    ALREADY_REDEEMED: 'ALREADY_REDEEMED',
    CHECKIN_CLOSED: 'CHECKIN_CLOSED',
    IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
} as const;

export type ErrorCodeName = typeof ErrorCode[keyof typeof ErrorCode];

/** Throw a business error. Fabric returns the message to the caller and rolls the transaction back. */
export function fail(code: ErrorCodeName, message: string): never {
    throw new Error(`${code}:${message}`);
}

/** Guard: fail with VALIDATION_ERROR unless the condition holds. */
export function ensure(condition: boolean, message: string): void {
    if (!condition) {
        fail(ErrorCode.VALIDATION_ERROR, message);
    }
}

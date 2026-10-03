import { ChaincodeStub } from 'fabric-shim';

/**
 * World-state key builders. All key layout lives here so it is defined once.
 * See docs/BLOCKCHAIN_TASK.md section 1.
 *
 * Simple keys are plain strings. Index and history keys are Fabric composite
 * keys, so they can be range-queried by prefix and never collide with the
 * simple keys.
 */

export const OBJECT_TYPE = {
    OWNER_TICKET: 'owner~ticket',
    OP_BY_EVENT: 'op~event',
    OP_BY_TICKET: 'op~ticket',
} as const;

export function eventKey(eventId: string): string {
    return `event:${eventId}`;
}

export function eligibilityKey(eventId: string, userId: string): string {
    return `eligibility:${eventId}:${userId}`;
}

export function ticketKey(ticketId: string): string {
    return `ticket:${ticketId}`;
}

/**
 * Owner index entry: (ownerId, ticketId). Added on claim; on transfer the old
 * entry is deleted and the new one added in the same transaction.
 * Query all tickets of a user with ownerIndexAttributes(ownerId) as the prefix.
 */
export function ownerIndexKey(stub: ChaincodeStub, ownerId: string, ticketId: string): string {
    return stub.createCompositeKey(OBJECT_TYPE.OWNER_TICKET, [ownerId, ticketId]);
}

export function ownerIndexAttributes(ownerId: string): string[] {
    return [ownerId];
}

/**
 * Operation history keys. occurredAt sits before txId so a prefix scan returns
 * records in chronological order, with txId as a stable tiebreaker.
 * The same operation is written under both keys (event level and ticket level).
 */
export function opByEventKey(stub: ChaincodeStub, eventId: string, occurredAt: string, txId: string): string {
    return stub.createCompositeKey(OBJECT_TYPE.OP_BY_EVENT, [eventId, occurredAt, txId]);
}

export function opByTicketKey(stub: ChaincodeStub, ticketId: string, occurredAt: string, txId: string): string {
    return stub.createCompositeKey(OBJECT_TYPE.OP_BY_TICKET, [ticketId, occurredAt, txId]);
}

export function opByEventAttributes(eventId: string): string[] {
    return [eventId];
}

export function opByTicketAttributes(ticketId: string): string[] {
    return [ticketId];
}

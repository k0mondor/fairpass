/**
 * FairPass chaincode data model.
 *
 * Mirrors docs/SHARED_CONTRACT.md (sections 3 and 5) and docs/BLOCKCHAIN_TASK.md.
 * Field names are part of the contract with the backend: do not rename them
 * without updating both docs and agreeing with the backend first.
 *
 * Only plain strings, integers and booleans are stored on chain. No names,
 * e-mails, phone numbers or random seeds.
 */

export type TicketStatus = 'ACTIVE' | 'REDEEMED';

export type OperationType =
    | 'EVENT_CREATED'
    | 'DRAW_PUBLISHED'
    | 'TICKET_CLAIMED'
    | 'TICKET_TRANSFERRED'
    | 'TICKET_REDEEMED';

/** World-state key: event:{eventId} */
export interface ChainEvent {
    eventId: string;
    organizerId: string;
    capacity: number;
    /** UTC ISO 8601, e.g. 2026-10-01T10:00:00.000Z */
    startAt: string;
    endAt: string;
    drawPublished: boolean;
    /** null until PublishDraw succeeds; then 64-char lowercase hex SHA-256 */
    winnersHash: string | null;
    winnerCount: number;
    issuedCount: number;
    redeemedCount: number;
}

/** World-state key: eligibility:{eventId}:{userId}. Created only by PublishDraw. */
export interface Eligibility {
    eventId: string;
    userId: string;
    claimed: boolean;
}

/** World-state key: ticket:{ticketId}. ticketId = SHA-256 (see hash.ts). */
export interface Ticket {
    id: string;
    eventId: string;
    /** Never changes after ClaimTicket. */
    originalWinnerId: string;
    /** Changes on TransferTicket. */
    ownerId: string;
    status: TicketStatus;
    transferCount: number;
    claimedAt: string;
    redeemedAt: string | null;
}

/**
 * Confirmed on-chain operation. id === txId.
 * The HTTP layer adds channelName, chaincodeName and blockNumber.
 * ticketId is null for EVENT_CREATED and DRAW_PUBLISHED.
 */
export interface Operation {
    id: string;
    txId: string;
    eventId: string;
    ticketId: string | null;
    type: OperationType;
    actorId: string;
    fromUserId: string | null;
    toUserId: string | null;
    occurredAt: string;
}

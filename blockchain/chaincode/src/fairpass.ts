import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import { ErrorCode, ensure, fail } from './errors';
import { ticketIdFor, winnersHashOf } from './hash';
import { collectValues } from './iter';
import {
    eligibilityKey,
    eventKey,
    opByEventAttributes,
    opByTicketAttributes,
    OBJECT_TYPE,
    ownerIndexAttributes,
    ownerIndexKey,
    ticketKey,
} from './keys';
import { readJson, recordOperation, writeJson } from './ledger';
import { ChainEvent, Eligibility, Operation, Ticket } from './types';
import { parseIsoUtc, parsePositiveInt, parseWinnerIds, requireHexId, requireUuid, txTime } from './validate';

const MAX_WINNERS = 1000; // docs/SHARED_CONTRACT.md section 5: demo cap on registrations per event.

@Info({ title: 'FairPass', description: 'FairPass ticketing chaincode' })
export class FairPassContract extends Contract {
    /** Pipeline check. Remove before delivery if you prefer. */
    @Transaction(false)
    @Returns('string')
    public async Ping(ctx: Context): Promise<string> {
        return 'ok';
    }

    /**
     * Create an event on chain. Validation happens before any write, so a
     * rejected call changes nothing.
     */
    @Transaction()
    @Returns('string')
    public async CreateEvent(
        ctx: Context,
        eventId: string,
        organizerId: string,
        capacity: string,
        startAt: string,
        endAt: string,
    ): Promise<string> {
        requireUuid('eventId', eventId);
        requireUuid('organizerId', organizerId);
        const cap = parsePositiveInt('capacity', capacity);
        const start = parseIsoUtc('startAt', startAt);
        const end = parseIsoUtc('endAt', endAt);
        ensure(start.ms < end.ms, 'startAt must be before endAt');

        const stub = ctx.stub;
        if ((await readJson<ChainEvent>(stub, eventKey(eventId))) !== null) {
            return fail(ErrorCode.IDEMPOTENCY_CONFLICT, 'event already exists');
        }

        const event: ChainEvent = {
            eventId,
            organizerId,
            capacity: cap,
            startAt: start.iso,
            endAt: end.iso,
            drawPublished: false,
            winnersHash: null,
            winnerCount: 0,
            issuedCount: 0,
            redeemedCount: 0,
        };
        await writeJson(stub, eventKey(eventId), event);
        await recordOperation(stub, makeOperation(stub, event.eventId, null, 'EVENT_CREATED', organizerId, null, null));

        return JSON.stringify(event);
    }

    /** Read one event. Read-only. */
    @Transaction(false)
    @Returns('string')
    public async GetEvent(ctx: Context, eventId: string): Promise<string> {
        requireUuid('eventId', eventId);
        const event = await this.loadEvent(ctx, eventId);
        return JSON.stringify(event);
    }

    /**
     * Publish the draw result once. winnerIdsJson must already be sorted,
     * deduplicated and no longer than the event capacity; winnersHash must
     * match what the chaincode recomputes from that list. Every winner gets
     * an eligibility record in the same transaction as the event update.
     */
    @Transaction()
    @Returns('string')
    public async PublishDraw(
        ctx: Context,
        eventId: string,
        winnerIdsJson: string,
        winnersHash: string,
    ): Promise<string> {
        requireUuid('eventId', eventId);
        ensure(
            typeof winnersHash === 'string' && /^[0-9a-f]{64}$/.test(winnersHash),
            'winnersHash must be a 64-character lowercase hex string',
        );

        const stub = ctx.stub;
        const event = await this.loadEvent(ctx, eventId);
        if (event.drawPublished) {
            return fail(ErrorCode.ALREADY_DRAWN, 'draw already published for this event');
        }
        const now = txTime(stub);
        if (now.ms >= new Date(event.startAt).getTime()) {
            return fail(ErrorCode.DRAW_NOT_READY, 'event has already started');
        }

        const winnerIds = parseWinnerIds('winnerIdsJson', winnerIdsJson, event.capacity);
        const recomputedHash = winnersHashOf(winnerIds);
        ensure(recomputedHash === winnersHash, 'winnersHash does not match winnerIdsJson');

        for (const userId of winnerIds) {
            const eligibility: Eligibility = { eventId, userId, claimed: false };
            await writeJson(stub, eligibilityKey(eventId, userId), eligibility);
        }

        const updated: ChainEvent = {
            ...event,
            drawPublished: true,
            winnersHash,
            winnerCount: winnerIds.length,
        };
        await writeJson(stub, eventKey(eventId), updated);
        await recordOperation(
            stub,
            makeOperation(stub, eventId, null, 'DRAW_PUBLISHED', event.organizerId, null, null),
        );

        return JSON.stringify(updated);
    }

    /**
     * A winner claims their ticket. The ticket id is deterministic
     * (SHA-256 of eventId + the caller's own id), so a retried call with the
     * same winnerId always resolves to the same ticket rather than creating
     * a second one.
     */
    @Transaction()
    @Returns('string')
    public async ClaimTicket(ctx: Context, eventId: string, winnerId: string): Promise<string> {
        requireUuid('eventId', eventId);
        requireUuid('winnerId', winnerId);

        const stub = ctx.stub;
        const event = await this.loadEvent(ctx, eventId);
        if (!event.drawPublished) {
            return fail(ErrorCode.DRAW_NOT_READY, 'draw has not been published yet');
        }

        const now = txTime(stub);
        if (now.ms >= new Date(event.startAt).getTime()) {
            return fail(ErrorCode.CLAIM_CLOSED, 'event has already started');
        }

        const eKey = eligibilityKey(eventId, winnerId);
        const eligibility = await readJson<Eligibility>(stub, eKey);
        if (eligibility === null) {
            return fail(ErrorCode.NOT_WINNER, 'not a winner of this event');
        }
        if (eligibility.claimed) {
            return fail(ErrorCode.ALREADY_CLAIMED, 'ticket already claimed');
        }
        if (event.issuedCount >= event.capacity) {
            return fail(ErrorCode.SOLD_OUT, 'all tickets have been issued');
        }

        const ticketId = ticketIdFor(eventId, winnerId);
        if ((await readJson<Ticket>(stub, ticketKey(ticketId))) !== null) {
            return fail(ErrorCode.ALREADY_CLAIMED, 'ticket already claimed');
        }

        const ticket: Ticket = {
            id: ticketId,
            eventId,
            originalWinnerId: winnerId,
            ownerId: winnerId,
            status: 'ACTIVE',
            transferCount: 0,
            claimedAt: now.iso,
            redeemedAt: null,
        };
        await writeJson(stub, ticketKey(ticketId), ticket);
        await writeJson(stub, eKey, { ...eligibility, claimed: true });
        await stub.putState(ownerIndexKey(stub, winnerId, ticketId), Buffer.from('\u0000'));
        await writeJson(stub, eventKey(eventId), { ...event, issuedCount: event.issuedCount + 1 });
        await recordOperation(
            stub,
            makeOperation(stub, eventId, ticketId, 'TICKET_CLAIMED', winnerId, null, winnerId),
        );

        return JSON.stringify(ticket);
    }

    /**
     * Transfer a ticket to another user. Allowed at most once per ticket,
     * only before the event starts, and only while it is still ACTIVE.
     * Whether toUserId is a real, existing student account is the
     * backend's responsibility; the chaincode only knows ids.
     */
    @Transaction()
    @Returns('string')
    public async TransferTicket(
        ctx: Context,
        ticketId: string,
        fromUserId: string,
        toUserId: string,
    ): Promise<string> {
        requireHexId('ticketId', ticketId);
        requireUuid('fromUserId', fromUserId);
        requireUuid('toUserId', toUserId);

        const stub = ctx.stub;
        const tKey = ticketKey(ticketId);
        const ticket = await readJson<Ticket>(stub, tKey);
        if (ticket === null) {
            return fail(ErrorCode.NOT_FOUND, 'ticket not found');
        }
        if (ticket.ownerId !== fromUserId) {
            return fail(ErrorCode.NOT_TICKET_OWNER, 'fromUserId does not own this ticket');
        }
        if (fromUserId === toUserId) {
            return fail(ErrorCode.INVALID_RECIPIENT, 'cannot transfer a ticket to yourself');
        }
        if (ticket.status !== 'ACTIVE') {
            return fail(ErrorCode.ALREADY_REDEEMED, 'ticket has already been redeemed');
        }
        if (ticket.transferCount >= 1) {
            return fail(ErrorCode.TRANSFER_LIMIT_REACHED, 'ticket has already been transferred once');
        }

        const event = await this.loadEvent(ctx, ticket.eventId);
        const now = txTime(stub);
        if (now.ms >= new Date(event.startAt).getTime()) {
            return fail(ErrorCode.TRANSFER_CLOSED, 'event has already started');
        }

        const updated: Ticket = { ...ticket, ownerId: toUserId, transferCount: ticket.transferCount + 1 };
        await writeJson(stub, tKey, updated);
        await stub.deleteState(ownerIndexKey(stub, fromUserId, ticketId));
        await stub.putState(ownerIndexKey(stub, toUserId, ticketId), Buffer.from('\u0000'));
        await recordOperation(
            stub,
            makeOperation(stub, ticket.eventId, ticketId, 'TICKET_TRANSFERRED', fromUserId, fromUserId, toUserId),
        );

        return JSON.stringify(updated);
    }

    /**
     * An inspector redeems a ticket at the door. Allowed only while the
     * event's own window is open (startAt <= now < endAt), and only once
     * per ticket. Whether the caller is really an inspector is checked by
     * the backend; the chaincode only enforces the ticket-level rules.
     */
    @Transaction()
    @Returns('string')
    public async RedeemTicket(ctx: Context, ticketId: string, inspectorId: string): Promise<string> {
        requireHexId('ticketId', ticketId);
        requireUuid('inspectorId', inspectorId);

        const stub = ctx.stub;
        const tKey = ticketKey(ticketId);
        const ticket = await readJson<Ticket>(stub, tKey);
        if (ticket === null) {
            return fail(ErrorCode.NOT_FOUND, 'ticket not found');
        }
        if (ticket.status !== 'ACTIVE') {
            return fail(ErrorCode.ALREADY_REDEEMED, 'ticket has already been redeemed');
        }

        const event = await this.loadEvent(ctx, ticket.eventId);
        const now = txTime(stub);
        const startMs = new Date(event.startAt).getTime();
        const endMs = new Date(event.endAt).getTime();
        if (now.ms < startMs || now.ms >= endMs) {
            return fail(ErrorCode.CHECKIN_CLOSED, 'event check-in window is not open');
        }

        const updated: Ticket = { ...ticket, status: 'REDEEMED', redeemedAt: now.iso };
        await writeJson(stub, tKey, updated);
        await writeJson(stub, eventKey(event.eventId), { ...event, redeemedCount: event.redeemedCount + 1 });
        await recordOperation(
            stub,
            makeOperation(stub, ticket.eventId, ticketId, 'TICKET_REDEEMED', inspectorId, ticket.ownerId, null),
        );

        return JSON.stringify(updated);
    }

    /** Read one ticket. Read-only. */
    @Transaction(false)
    @Returns('string')
    public async GetTicket(ctx: Context, ticketId: string): Promise<string> {
        requireHexId('ticketId', ticketId);
        const ticket = await readJson<Ticket>(ctx.stub, ticketKey(ticketId));
        if (ticket === null) {
            return fail(ErrorCode.NOT_FOUND, 'ticket not found');
        }
        return JSON.stringify(ticket);
    }

    /**
     * All tickets currently owned by a user, via the owner~ticket index.
     * Read-only. Returns [] when the user owns nothing, never an error.
     */
    @Transaction(false)
    @Returns('string')
    public async GetTicketsByOwner(ctx: Context, ownerId: string): Promise<string> {
        requireUuid('ownerId', ownerId);
        const stub = ctx.stub;
        const rows = await collectValues(
            await stub.getStateByPartialCompositeKey(OBJECT_TYPE.OWNER_TICKET, ownerIndexAttributes(ownerId)),
        );
        const tickets: Ticket[] = [];
        for (const row of rows) {
            const { attributes } = stub.splitCompositeKey(row.key);
            const ticketId = attributes[1];
            const ticket = await readJson<Ticket>(stub, ticketKey(ticketId));
            if (ticket !== null) {
                tickets.push(ticket);
            }
        }
        return JSON.stringify(tickets);
    }

    /**
     * Confirmed operations for one event, oldest first (the composite key
     * embeds occurredAt then txId, so range order is chronological order).
     * Read-only.
     */
    @Transaction(false)
    @Returns('string')
    public async GetOperationsByEvent(ctx: Context, eventId: string): Promise<string> {
        requireUuid('eventId', eventId);
        const stub = ctx.stub;
        const rows = await collectValues(
            await stub.getStateByPartialCompositeKey(OBJECT_TYPE.OP_BY_EVENT, opByEventAttributes(eventId)),
        );
        const ops: Operation[] = rows.map((row) => JSON.parse(row.text));
        return JSON.stringify(ops);
    }

    /** Confirmed operations for one ticket, oldest first. Read-only. */
    @Transaction(false)
    @Returns('string')
    public async GetOperationsByTicket(ctx: Context, ticketId: string): Promise<string> {
        requireHexId('ticketId', ticketId);
        const stub = ctx.stub;
        const rows = await collectValues(
            await stub.getStateByPartialCompositeKey(OBJECT_TYPE.OP_BY_TICKET, opByTicketAttributes(ticketId)),
        );
        const ops: Operation[] = rows.map((row) => JSON.parse(row.text));
        return JSON.stringify(ops);
    }

    /** Load an event or fail with NOT_FOUND. Shared by every method that needs one. */
    private async loadEvent(ctx: Context, eventId: string): Promise<ChainEvent> {
        const event = await readJson<ChainEvent>(ctx.stub, eventKey(eventId));
        if (event === null) {
            return fail(ErrorCode.NOT_FOUND, 'event not found');
        }
        return event;
    }
}

/** Build an Operation record with id/txId/occurredAt taken from the current transaction. */
function makeOperation(
    stub: { getTxID(): string; getTxTimestamp(): { seconds: { toString(): string }; nanos: number } },
    eventId: string,
    ticketId: string | null,
    type: Operation['type'],
    actorId: string,
    fromUserId: string | null,
    toUserId: string | null,
): Operation {
    const txId = stub.getTxID();
    return {
        id: txId,
        txId,
        eventId,
        ticketId,
        type,
        actorId,
        fromUserId,
        toUserId,
        occurredAt: txTime(stub).iso,
    };
}

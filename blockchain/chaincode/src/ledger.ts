import { ChaincodeStub } from 'fabric-shim';
import { opByEventKey, opByTicketKey } from './keys';
import { Operation } from './types';

/**
 * Small world-state helpers shared by all transactions.
 */

/** JSON with keys sorted recursively, so every peer writes identical bytes. */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (value !== null && typeof value === 'object') {
        const out: { [k: string]: unknown } = {};
        for (const k of Object.keys(value as object).sort()) {
            out[k] = sortKeys((value as { [k: string]: unknown })[k]);
        }
        return out;
    }
    return value;
}

export async function readJson<T>(stub: ChaincodeStub, key: string): Promise<T | null> {
    const data = await stub.getState(key);
    if (!data || data.length === 0) {
        return null;
    }
    return JSON.parse(Buffer.from(data).toString('utf8')) as T;
}

export async function writeJson(stub: ChaincodeStub, key: string, value: unknown): Promise<void> {
    await stub.putState(key, Buffer.from(canonicalJson(value)));
}

/**
 * Append an operation to the history. It is written under the event key, and
 * also under the ticket key when it belongs to a ticket. Call this in the same
 * transaction as the state change it describes.
 */
export async function recordOperation(stub: ChaincodeStub, op: Operation): Promise<void> {
    const json = Buffer.from(canonicalJson(op));
    await stub.putState(opByEventKey(stub, op.eventId, op.occurredAt, op.txId), json);
    if (op.ticketId !== null) {
        await stub.putState(opByTicketKey(stub, op.ticketId, op.occurredAt, op.txId), json);
    }
}

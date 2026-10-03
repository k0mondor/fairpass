import { createHash } from 'crypto';

/**
 * Hash rules shared with the backend (docs/SHARED_CONTRACT.md section 3,
 * docs/BLOCKCHAIN_TASK.md section 2). Both sides MUST produce identical output.
 */

/** SHA-256 of a UTF-8 string, as 64 lowercase hex characters. */
export function sha256Hex(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** ticketId = SHA256("ticket:" + eventId + ":" + originalWinnerId). Deterministic, so retries get the same id. */
export function ticketIdFor(eventId: string, originalWinnerId: string): string {
    return sha256Hex(`ticket:${eventId}:${originalWinnerId}`);
}

/**
 * True when ids are strictly ascending (sorted and duplicate-free).
 * Uses plain code-unit comparison, NOT localeCompare, so the order matches
 * the backend's default string sort for lowercase UUIDs.
 */
export function isStrictlyAscending(ids: string[]): boolean {
    for (let i = 1; i < ids.length; i++) {
        if (!(ids[i - 1] < ids[i])) {
            return false;
        }
    }
    return true;
}

/**
 * winnersHash = SHA256(UTF8(compact JSON array of the sorted winner ids)).
 * JSON.stringify on a string array gives double quotes and no spaces,
 * which is exactly the format the contract requires.
 */
export function winnersHashOf(sortedWinnerIds: string[]): string {
    return sha256Hex(JSON.stringify(sortedWinnerIds));
}

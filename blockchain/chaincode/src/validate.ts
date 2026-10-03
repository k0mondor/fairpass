import { ErrorCode, ensure, fail } from './errors';

/**
 * Input validation helpers. Every transaction argument arrives as a string
 * (docs/SHARED_CONTRACT.md section 5), so it is parsed and checked here before
 * anything is written. Failures throw VALIDATION_ERROR.
 */

// Lowercase only, so id ordering and hashes agree with the backend.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// UTC ISO 8601: 2026-10-01T10:00:00Z or 2026-10-01T10:00:00.123Z
const ISO_UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

export function requireUuid(name: string, value: string): string {
    ensure(typeof value === 'string' && UUID_RE.test(value), `${name} must be a lowercase UUID`);
    return value;
}

export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID_RE.test(value);
}

/** Positive integer given as a decimal string (no sign, no decimals, no exponent). */
export function parsePositiveInt(name: string, value: string): number {
    ensure(typeof value === 'string' && /^\d+$/.test(value), `${name} must be a positive integer`);
    const n = Number(value);
    ensure(Number.isSafeInteger(n) && n > 0, `${name} must be a positive integer`);
    return n;
}

export interface ParsedTime {
    /** Normalised form with milliseconds, e.g. 2026-10-01T10:00:00.000Z */
    iso: string;
    ms: number;
}

/**
 * Parse a UTC ISO 8601 timestamp ending in Z. Rejects other time zones and
 * impossible dates (JavaScript's Date would silently roll 30 Feb over to March).
 */
export function parseIsoUtc(name: string, value: string): ParsedTime {
    const m = typeof value === 'string' ? ISO_UTC_RE.exec(value) : null;
    if (!m) {
        return fail(ErrorCode.VALIDATION_ERROR, `${name} must be UTC ISO 8601, e.g. 2026-10-01T10:00:00Z`);
    }
    const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
    const millis = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
    const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));
    const roundTrips =
        d.getUTCFullYear() === year &&
        d.getUTCMonth() === month - 1 &&
        d.getUTCDate() === day &&
        d.getUTCHours() === hour &&
        d.getUTCMinutes() === minute &&
        d.getUTCSeconds() === second;
    ensure(roundTrips, `${name} is not a valid date`);
    return { iso: d.toISOString(), ms: d.getTime() };
}

/** The transaction time from Fabric (never the local clock). Same on every peer. */
export function txTime(stub: { getTxTimestamp(): { seconds: { toString(): string }; nanos: number } }): ParsedTime {
    const ts = stub.getTxTimestamp();
    const ms = Number(ts.seconds.toString()) * 1000 + Math.floor(ts.nanos / 1e6);
    return { iso: new Date(ms).toISOString(), ms };
}

/**
 * Parse and validate a winner-ids JSON array: must be a JSON array of
 * lowercase UUID strings, strictly ascending (sorted, no duplicates), and no
 * longer than maxLen. Returns the parsed array.
 */
export function parseWinnerIds(name: string, jsonText: string, maxLen: number): string[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        return fail(ErrorCode.VALIDATION_ERROR, `${name} must be a JSON array`);
    }
    ensure(Array.isArray(parsed), `${name} must be a JSON array`);
    const ids = parsed as unknown[];
    ensure(ids.length <= maxLen, `${name} must not exceed capacity`);
    for (const id of ids) {
        ensure(isUuid(id), `${name} must contain only lowercase UUIDs`);
    }
    const strIds = ids as string[];
    for (let i = 1; i < strIds.length; i++) {
        ensure(strIds[i - 1] < strIds[i], `${name} must be sorted ascending with no duplicates`);
    }
    return strIds;
}

const HEX64_RE = /^[0-9a-f]{64}$/;

export function requireHexId(name: string, value: string): string {
    ensure(typeof value === 'string' && HEX64_RE.test(value), `${name} must be a 64-character lowercase hex string`);
    return value;
}

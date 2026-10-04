'use strict';
/**
 * In-memory Fabric simulator for FairPass chaincode tests.
 *
 * Mirrors the Fabric rules that matter for these tests:
 *  - a transaction reads only COMMITTED state (never its own writes);
 *  - writes are buffered and applied only if the transaction succeeds;
 *  - at commit time every key the transaction read must be unchanged,
 *    otherwise it is invalid (MVCC_READ_CONFLICT) and changes nothing;
 *  - the transaction timestamp is controlled by the test (setTime), so tests
 *    never depend on the local clock.
 * Limitation: range queries record the keys they returned, not phantom ranges.
 */
const { createHash } = require('crypto');
const { FairPassContract } = require('../dist/fairpass');

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const SEP = '\u0000';

function compositeKey(type, attrs) {
    return SEP + type + SEP + attrs.map((a) => a + SEP).join('');
}

function makeStub(ledger, txId, tsMs) {
    const base = ledger.state;
    const reads = new Map();
    const writes = new Map();
    const readBase = (key) => {
        const v = base.has(key) ? base.get(key) : null;
        if (!reads.has(key)) reads.set(key, v);
        return v;
    };
    const stub = {
        getTxID: () => txId,
        getTxTimestamp: () => ({
            seconds: { toString: () => String(Math.floor(tsMs / 1000)) },
            nanos: (tsMs % 1000) * 1e6,
        }),
        async getState(key) {
            const v = readBase(key);
            return v === null ? Buffer.alloc(0) : Buffer.from(v, 'utf8');
        },
        async putState(key, value) {
            writes.set(key, Buffer.from(value).toString('utf8'));
        },
        async deleteState(key) {
            writes.set(key, null);
        },
        createCompositeKey: compositeKey,
        splitCompositeKey(key) {
            const parts = key.split(SEP);
            return { objectType: parts[1], attributes: parts.slice(2, parts.length - 1) };
        },
        async getStateByPartialCompositeKey(type, attrs) {
            const prefix = compositeKey(type, attrs);
            const keys = [...base.keys()].filter((k) => k.startsWith(prefix)).sort();
            const items = keys.map((k) => {
                readBase(k);
                return { key: k, value: Buffer.from(base.get(k), 'utf8') };
            });
            let i = 0;
            return {
                async next() {
                    if (i < items.length) return { value: items[i++], done: false };
                    return { value: undefined, done: true };
                },
                async close() {},
            };
        },
    };
    return { stub, reads, writes };
}

class Ledger {
    constructor() {
        this.state = new Map();
        this.txCounter = 0;
        this.nowMs = Date.parse('2026-10-01T09:00:00.000Z');
        this.autoAdvanceMs = 1000;
        this.contract = new FairPassContract();
    }

    setTime(msOrIso) {
        this.nowMs = typeof msOrIso === 'string' ? Date.parse(msOrIso) : msOrIso;
    }

    /** Start/end ISO strings, minutes after the current ledger time. */
    window(startMin, endMin) {
        const iso = (m) => new Date(this.nowMs + m * 60000).toISOString();
        return { start: iso(startMin), end: iso(endMin) };
    }

    snapshot() {
        return JSON.stringify([...this.state.entries()].sort());
    }

    /** Endorse a transaction against the current committed state. Does not commit. */
    async simulate(method, ...args) {
        this.txCounter += 1;
        const txId = sha256(`tx-${this.txCounter}`);
        const tsMs = this.nowMs;
        const { stub, reads, writes } = makeStub(this, txId, tsMs);
        try {
            const result = await this.contract[method]({ stub }, ...args);
            return { ok: true, txId, tsMs, result, reads, writes };
        } catch (e) {
            const m = /^([A-Z_]+):(.*)$/.exec(e.message);
            return { ok: false, txId, tsMs, error: e.message, code: m ? m[1] : null };
        }
    }

    /** Validate read set and apply writes. Returns 'VALID' | 'MVCC_READ_CONFLICT' | 'ENDORSE_FAILED'. */
    commit(sim) {
        if (!sim.ok) return 'ENDORSE_FAILED';
        for (const [k, v] of sim.reads) {
            const cur = this.state.has(k) ? this.state.get(k) : null;
            if (cur !== v) return 'MVCC_READ_CONFLICT';
        }
        for (const [k, v] of sim.writes) {
            if (v === null) this.state.delete(k);
            else this.state.set(k, v);
        }
        return 'VALID';
    }

    /** Endorse and commit one transaction (the normal single-client path). */
    async submit(method, ...args) {
        const sim = await this.simulate(method, ...args);
        sim.status = this.commit(sim);
        this.nowMs += this.autoAdvanceMs;
        return sim;
    }

    /** Read-only call against committed state. Throws on chaincode errors. */
    async query(method, ...args) {
        this.txCounter += 1;
        const { stub } = makeStub(this, sha256(`q-${this.txCounter}`), this.nowMs);
        return JSON.parse(await this.contract[method]({ stub }, ...args));
    }
}

const id = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

module.exports = { Ledger, id, sha256 };

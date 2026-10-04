'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Ledger, id } = require('./harness');
const { ticketIdFor, winnersHashOf } = require('../dist/hash');

const ORG = id(2);
const INS = id(20);
const W = (n) => id(100 + n); // winners / users

/** Create an event and publish a draw for the given winner ids (must be ascending). */
async function eventWithDraw(L, evNo, capacity, winners, startMin = 10, endMin = 70) {
    const ev = id(evNo);
    const { start, end } = L.window(startMin, endMin);
    const r = await L.submit('CreateEvent', ev, ORG, String(capacity), start, end);
    assert.equal(r.status, 'VALID', r.error);
    const d = await L.submit('PublishDraw', ev, JSON.stringify(winners), winnersHashOf(winners));
    assert.equal(d.status, 'VALID', d.error);
    return { ev, start, end, startMs: Date.parse(start), endMs: Date.parse(end) };
}

async function claim(L, ev, w) {
    const r = await L.submit('ClaimTicket', ev, w);
    assert.equal(r.status, 'VALID', r.error);
    return ticketIdFor(ev, w);
}

/** A call must be rejected with `code`, and must leave the ledger untouched. */
async function expectReject(L, code, method, ...args) {
    const before = L.snapshot();
    const r = await L.submit(method, ...args);
    assert.equal(r.ok, false, `${method} should have been rejected`);
    assert.equal(r.code, code, `${method}: got ${r.error}`);
    assert.equal(L.snapshot(), before, `${method} changed state despite rejection`);
}

// 1. Full lifecycle on an empty ledger -------------------------------------
test('1. create -> draw -> claim -> transfer -> redeem, with state, counts, index and txIds', async () => {
    const L = new Ledger();
    const [A, B] = [W(1), W(2)];
    const { ev, start } = await eventWithDraw(L, 1, 2, [A, B]);

    let e = await L.query('GetEvent', ev);
    assert.equal(e.drawPublished, true);
    assert.equal(e.winnerCount, 2);
    assert.equal(e.issuedCount, 0);

    const tA = ticketIdFor(ev, A);
    const rc = await L.submit('ClaimTicket', ev, A);
    assert.equal(rc.status, 'VALID');
    e = await L.query('GetEvent', ev);
    assert.equal(e.issuedCount, 1);
    assert.deepEqual((await L.query('GetTicketsByOwner', A)).map((t) => t.id), [tA]);

    const rt = await L.submit('TransferTicket', tA, A, B);
    assert.equal(rt.status, 'VALID');
    assert.deepEqual(await L.query('GetTicketsByOwner', A), []);
    assert.deepEqual((await L.query('GetTicketsByOwner', B)).map((t) => t.id), [tA]);
    let t = await L.query('GetTicket', tA);
    assert.equal(t.ownerId, B);
    assert.equal(t.originalWinnerId, A);
    assert.equal(t.transferCount, 1);

    L.setTime(start);
    const rr = await L.submit('RedeemTicket', tA, INS);
    assert.equal(rr.status, 'VALID');
    t = await L.query('GetTicket', tA);
    assert.equal(t.status, 'REDEEMED');
    assert.ok(t.redeemedAt);
    e = await L.query('GetEvent', ev);
    assert.equal(e.redeemedCount, 1);

    const evOps = await L.query('GetOperationsByEvent', ev);
    assert.deepEqual(
        evOps.map((o) => o.type),
        ['EVENT_CREATED', 'DRAW_PUBLISHED', 'TICKET_CLAIMED', 'TICKET_TRANSFERRED', 'TICKET_REDEEMED'],
    );
    const tOps = await L.query('GetOperationsByTicket', tA);
    assert.deepEqual(tOps.map((o) => o.type), ['TICKET_CLAIMED', 'TICKET_TRANSFERRED', 'TICKET_REDEEMED']);
    assert.deepEqual(tOps.map((o) => o.txId), [rc.txId, rt.txId, rr.txId]);
    assert.ok(tOps.every((o) => o.id === o.txId));

    // field contract with the backend
    const [claimed, transferred, redeemed] = tOps;
    assert.equal(claimed.actorId, A);
    assert.equal(claimed.toUserId, A);
    assert.equal(transferred.fromUserId, A);
    assert.equal(transferred.toUserId, B);
    assert.equal(redeemed.actorId, INS);
    assert.equal(redeemed.fromUserId, B);
    assert.equal(redeemed.toUserId, null);
    assert.equal(redeemed.occurredAt, t.redeemedAt);
});

// 2. Rejections ------------------------------------------------------------
test('2. duplicate / unauthorized / over-limit calls are rejected and change nothing', async () => {
    const L = new Ledger();
    const [A, B, C, X] = [W(1), W(2), W(3), W(9)];
    const { ev, start, end } = await eventWithDraw(L, 1, 3, [A, B, C]);

    await expectReject(L, 'IDEMPOTENCY_CONFLICT', 'CreateEvent', ev, ORG, '3', start, end);
    const hash = winnersHashOf([A, B, C]);
    await expectReject(L, 'ALREADY_DRAWN', 'PublishDraw', ev, JSON.stringify([A, B, C]), hash);

    await expectReject(L, 'NOT_WINNER', 'ClaimTicket', ev, X);
    const tA = await claim(L, ev, A);
    await expectReject(L, 'ALREADY_CLAIMED', 'ClaimTicket', ev, A);

    // before a draw exists
    const ev2 = id(2);
    const w = L.window(10, 70);
    await L.submit('CreateEvent', ev2, ORG, '1', w.start, w.end);
    await expectReject(L, 'DRAW_NOT_READY', 'ClaimTicket', ev2, A);
    await expectReject(L, 'NOT_FOUND', 'ClaimTicket', id(77), A);

    // SOLD_OUT is a defensive branch (winners never exceed capacity), so force the state
    const key = `event:${ev}`;
    const forged = JSON.parse(L.state.get(key));
    forged.issuedCount = forged.capacity;
    L.state.set(key, JSON.stringify(forged));
    await expectReject(L, 'SOLD_OUT', 'ClaimTicket', ev, B);
    forged.issuedCount = 1;
    L.state.set(key, JSON.stringify(forged));

    await expectReject(L, 'NOT_FOUND', 'TransferTicket', 'f'.repeat(64), A, B);
    await expectReject(L, 'NOT_TICKET_OWNER', 'TransferTicket', tA, B, C);
    await expectReject(L, 'INVALID_RECIPIENT', 'TransferTicket', tA, A, A);
    assert.equal((await L.submit('TransferTicket', tA, A, B)).status, 'VALID');
    await expectReject(L, 'TRANSFER_LIMIT_REACHED', 'TransferTicket', tA, B, C);

    L.setTime(start);
    assert.equal((await L.submit('RedeemTicket', tA, INS)).status, 'VALID');
    await expectReject(L, 'ALREADY_REDEEMED', 'RedeemTicket', tA, INS);
    await expectReject(L, 'ALREADY_REDEEMED', 'TransferTicket', tA, B, C);
    await expectReject(L, 'NOT_FOUND', 'RedeemTicket', 'e'.repeat(64), INS);

    // counts and index after all those rejections
    const e = await L.query('GetEvent', ev);
    assert.equal(e.issuedCount, 1);
    assert.equal(e.redeemedCount, 1);
    assert.deepEqual((await L.query('GetTicketsByOwner', A)).length, 0);
    assert.deepEqual((await L.query('GetTicketsByOwner', B)).map((t) => t.id), [tA]);
});

test('2b. reading a missing ticket or event reports NOT_FOUND', async () => {
    const L = new Ledger();
    await assert.rejects(L.query('GetTicket', 'a'.repeat(64)), /^Error: NOT_FOUND:/);
    await assert.rejects(L.query('GetEvent', id(5)), /^Error: NOT_FOUND:/);
});

// 3. Draw list validation --------------------------------------------------
test('3. malformed winner lists are rejected; a correct list matches winnerCount and eligibility', async () => {
    const L = new Ledger();
    const [A, B, C] = [W(1), W(2), W(3)];
    const ev = id(1);
    const { start, end } = L.window(10, 70);
    await L.submit('CreateEvent', ev, ORG, '2', start, end);

    const good = [A, B];
    const goodHash = winnersHashOf(good);
    await expectReject(L, 'VALIDATION_ERROR', 'PublishDraw', ev, JSON.stringify([B, A]), winnersHashOf([B, A])); // unsorted
    await expectReject(L, 'VALIDATION_ERROR', 'PublishDraw', ev, JSON.stringify([A, A]), winnersHashOf([A, A])); // duplicate
    await expectReject(L, 'VALIDATION_ERROR', 'PublishDraw', ev, JSON.stringify([A, B, C]), winnersHashOf([A, B, C])); // over capacity
    await expectReject(L, 'VALIDATION_ERROR', 'PublishDraw', ev, JSON.stringify(good), winnersHashOf([A])); // hash mismatch
    await expectReject(L, 'VALIDATION_ERROR', 'PublishDraw', ev, JSON.stringify(good), 'ABC'); // hash format
    await expectReject(L, 'VALIDATION_ERROR', 'PublishDraw', ev, JSON.stringify([A.toUpperCase()]), goodHash); // uppercase id
    await expectReject(L, 'VALIDATION_ERROR', 'PublishDraw', ev, '{"a":1}', goodHash); // not an array
    await expectReject(L, 'VALIDATION_ERROR', 'PublishDraw', ev, 'not json', goodHash);
    await expectReject(L, 'NOT_FOUND', 'PublishDraw', id(55), JSON.stringify(good), goodHash);
    assert.equal((await L.query('GetEvent', ev)).drawPublished, false);

    const ok = await L.submit('PublishDraw', ev, JSON.stringify(good), goodHash);
    assert.equal(ok.status, 'VALID');
    const e = await L.query('GetEvent', ev);
    assert.equal(e.winnerCount, 2);
    assert.equal(e.winnersHash, goodHash);
    await claim(L, ev, A);
    await claim(L, ev, B);
    await expectReject(L, 'NOT_WINNER', 'ClaimTicket', ev, C);
    assert.equal((await L.query('GetEvent', ev)).issuedCount, 2);
});

test('3b. invalid CreateEvent arguments are rejected', async () => {
    const L = new Ledger();
    const { start, end } = L.window(10, 70);
    await expectReject(L, 'VALIDATION_ERROR', 'CreateEvent', 'not-a-uuid', ORG, '1', start, end);
    await expectReject(L, 'VALIDATION_ERROR', 'CreateEvent', id(1), ORG, '0', start, end);
    await expectReject(L, 'VALIDATION_ERROR', 'CreateEvent', id(1), ORG, '1.5', start, end);
    await expectReject(L, 'VALIDATION_ERROR', 'CreateEvent', id(1), ORG, '1', end, start); // start after end
    await expectReject(L, 'VALIDATION_ERROR', 'CreateEvent', id(1), ORG, '1', '2026-02-30T10:00:00Z', end); // impossible date
    await expectReject(L, 'VALIDATION_ERROR', 'CreateEvent', id(1), ORG, '1', '2026-10-01T10:00:00+08:00', end); // not UTC
});

// 4. Time boundaries (transaction timestamp is set by the test) ------------
test('4. start/end boundaries for draw, claim, transfer and redeem', async () => {
    const L = new Ledger();
    const ws = [1, 2, 3, 4, 5, 6].map(W);
    const { ev, startMs, endMs } = await eventWithDraw(L, 1, 6, ws);

    // claims: 1 ms before start is allowed, the start instant is not
    L.setTime(startMs - 5000);
    const t1 = await claim(L, ev, ws[0]);
    const t2 = await claim(L, ev, ws[1]);
    const t3 = await claim(L, ev, ws[2]);
    const t4 = await claim(L, ev, ws[3]);
    L.setTime(startMs - 1);
    const t5 = await claim(L, ev, ws[4]);
    L.setTime(startMs);
    await expectReject(L, 'CLAIM_CLOSED', 'ClaimTicket', ev, ws[5]);

    // transfers: allowed before start, closed from the start instant
    L.setTime(startMs - 1);
    assert.equal((await L.submit('TransferTicket', t1, ws[0], W(50))).status, 'VALID');
    L.setTime(startMs);
    await expectReject(L, 'TRANSFER_CLOSED', 'TransferTicket', t2, ws[1], W(51));

    // redeem: closed before start, open at start, open until end, closed at end
    L.setTime(startMs - 1);
    await expectReject(L, 'CHECKIN_CLOSED', 'RedeemTicket', t3, INS);
    L.setTime(startMs);
    assert.equal((await L.submit('RedeemTicket', t3, INS)).status, 'VALID');
    L.setTime(endMs - 1);
    assert.equal((await L.submit('RedeemTicket', t4, INS)).status, 'VALID');
    L.setTime(endMs);
    await expectReject(L, 'CHECKIN_CLOSED', 'RedeemTicket', t5, INS);
    L.setTime(endMs + 3600000);
    await expectReject(L, 'CHECKIN_CLOSED', 'RedeemTicket', t5, INS);
});

test('4b. a draw cannot be published once the event has started', async () => {
    const L = new Ledger();
    const ev = id(1);
    const { start, end } = L.window(10, 70);
    await L.submit('CreateEvent', ev, ORG, '1', start, end);
    const winners = [W(1)];
    L.setTime(start);
    await expectReject(L, 'DRAW_NOT_READY', 'PublishDraw', ev, JSON.stringify(winners), winnersHashOf(winners));
    L.setTime(Date.parse(start) - 1);
    assert.equal((await L.submit('PublishDraw', ev, JSON.stringify(winners), winnersHashOf(winners))).status, 'VALID');
});

// 5. Concurrency (MVCC) ----------------------------------------------------
test('5a. two winners claim at the same moment: one commits, the other is invalidated; retry succeeds', async () => {
    const L = new Ledger();
    const [A, B] = [W(1), W(2)];
    const { ev } = await eventWithDraw(L, 1, 2, [A, B]);

    const s1 = await L.simulate('ClaimTicket', ev, A);
    const s2 = await L.simulate('ClaimTicket', ev, B);
    assert.equal(L.commit(s1), 'VALID');
    assert.equal(L.commit(s2), 'MVCC_READ_CONFLICT');

    let e = await L.query('GetEvent', ev);
    assert.equal(e.issuedCount, 1);
    assert.equal((await L.query('GetTicketsByOwner', A)).length, 1);
    assert.equal((await L.query('GetTicketsByOwner', B)).length, 0);

    assert.equal((await L.submit('ClaimTicket', ev, B)).status, 'VALID'); // client retry
    e = await L.query('GetEvent', ev);
    assert.equal(e.issuedCount, 2);
    assert.equal((await L.query('GetOperationsByEvent', ev)).filter((o) => o.type === 'TICKET_CLAIMED').length, 2);
});

test('5b. the same winner claiming twice at once yields exactly one ticket', async () => {
    const L = new Ledger();
    const A = W(1);
    const { ev } = await eventWithDraw(L, 1, 2, [A, W(2)]);
    const s1 = await L.simulate('ClaimTicket', ev, A);
    const s2 = await L.simulate('ClaimTicket', ev, A);
    assert.equal(L.commit(s1), 'VALID');
    assert.equal(L.commit(s2), 'MVCC_READ_CONFLICT');
    assert.equal((await L.query('GetEvent', ev)).issuedCount, 1);
    await expectReject(L, 'ALREADY_CLAIMED', 'ClaimTicket', ev, A);
});

test('5c. concurrent transfers of one ticket: only one is accepted, state and history agree', async () => {
    const L = new Ledger();
    const [A, B, C] = [W(1), W(2), W(3)];
    const { ev } = await eventWithDraw(L, 1, 1, [A]);
    const tA = await claim(L, ev, A);

    const s1 = await L.simulate('TransferTicket', tA, A, B);
    const s2 = await L.simulate('TransferTicket', tA, A, C);
    assert.equal(L.commit(s1), 'VALID');
    assert.equal(L.commit(s2), 'MVCC_READ_CONFLICT');

    const t = await L.query('GetTicket', tA);
    assert.equal(t.ownerId, B);
    assert.equal(t.transferCount, 1);
    assert.equal((await L.query('GetTicketsByOwner', A)).length, 0);
    assert.equal((await L.query('GetTicketsByOwner', B)).length, 1);
    assert.equal((await L.query('GetTicketsByOwner', C)).length, 0);
    const ops = await L.query('GetOperationsByTicket', tA);
    assert.equal(ops.filter((o) => o.type === 'TICKET_TRANSFERRED').length, 1);
});

test('5d. concurrent redeems of one ticket: only one is accepted', async () => {
    const L = new Ledger();
    const A = W(1);
    const { ev, start } = await eventWithDraw(L, 1, 1, [A]);
    const tA = await claim(L, ev, A);
    L.setTime(start);

    const s1 = await L.simulate('RedeemTicket', tA, id(21));
    const s2 = await L.simulate('RedeemTicket', tA, id(22));
    assert.equal(L.commit(s1), 'VALID');
    assert.equal(L.commit(s2), 'MVCC_READ_CONFLICT');

    assert.equal((await L.query('GetEvent', ev)).redeemedCount, 1);
    const ops = await L.query('GetOperationsByTicket', tA);
    const redeemed = ops.filter((o) => o.type === 'TICKET_REDEEMED');
    assert.equal(redeemed.length, 1);
    assert.equal(redeemed[0].actorId, id(21));
});

// 6. Owner queries and history isolation -----------------------------------
test('6. owner index and histories stay correct and separate, in a stable order', async () => {
    const L = new Ledger();
    const [A, B, C, D] = [W(1), W(2), W(3), W(4)];
    const { ev } = await eventWithDraw(L, 1, 3, [A, B, C]);
    const other = await eventWithDraw(L, 2, 1, [W(7)]);

    const tA = await claim(L, ev, A);
    const tB = await claim(L, ev, B);
    await claim(L, ev, C);
    const tOther = await claim(L, other.ev, W(7));
    assert.equal((await L.submit('TransferTicket', tA, A, D)).status, 'VALID');

    assert.deepEqual(await L.query('GetTicketsByOwner', A), []);
    assert.deepEqual((await L.query('GetTicketsByOwner', D)).map((t) => t.id), [tA]);
    assert.deepEqual((await L.query('GetTicketsByOwner', B)).map((t) => t.id), [tB]);
    assert.deepEqual(await L.query('GetTicketsByOwner', W(60)), []); // unknown owner: empty, not an error

    const opsA = await L.query('GetOperationsByTicket', tA);
    assert.deepEqual(opsA.map((o) => o.type), ['TICKET_CLAIMED', 'TICKET_TRANSFERRED']);
    assert.ok(opsA.every((o) => o.ticketId === tA));
    const opsB = await L.query('GetOperationsByTicket', tB);
    assert.deepEqual(opsB.map((o) => o.type), ['TICKET_CLAIMED']);

    const evOps = await L.query('GetOperationsByEvent', ev);
    assert.ok(evOps.every((o) => o.eventId === ev));
    assert.equal(evOps.filter((o) => o.type === 'TICKET_CLAIMED').length, 3);
    assert.ok(!evOps.some((o) => o.ticketId === tOther));
    const times = evOps.map((o) => o.occurredAt);
    assert.deepEqual(times, [...times].sort());

    for (let i = 0; i < 3; i++) {
        assert.deepEqual(await L.query('GetOperationsByEvent', ev), evOps);
        assert.deepEqual(await L.query('GetOperationsByTicket', tA), opsA);
    }
});

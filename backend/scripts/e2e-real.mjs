import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.API_BASE_URL ?? "http://127.0.0.1:3000/api/v1";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(path, token, body, headers = {}, expected = 200) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(90_000),
  });
  const json = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(json)}`);
  return json;
}
async function login(account) {
  return (await request("/auth/demo-login", undefined, { account })).data;
}
async function waitUntil(iso) {
  await sleep(Math.max(0, Date.parse(iso) - Date.now() + 1500));
}

console.log("Logging in as organizer, inspector and three students");
const organizer = await login("organizer1");
const inspector = await login("inspector1");
const students = await Promise.all(
  ["student1", "student2", "student3"].map(login),
);
const now = Date.now();
const input = {
  title: `Fabric E2E ${new Date(now).toISOString()}`,
  description: "Real Gateway acceptance test",
  location: "WSL test-network",
  capacity: 2,
  registrationDeadline: new Date(now + 30_000).toISOString(),
  startAt: new Date(now + 150_000).toISOString(),
  endAt: new Date(now + 600_000).toISOString(),
};
const key = randomUUID();
const event = (
  await request(
    "/events",
    organizer.token,
    input,
    { "Idempotency-Key": key },
    201,
  )
).data;
console.log(`Created event ${event.id}; registering students`);
assert.equal(
  (await request("/events", organizer.token, input, { "Idempotency-Key": key }))
    .data.id,
  event.id,
);
for (const student of students)
  await request(
    `/events/${event.id}/registrations`,
    student.token,
    {},
    {},
    201,
  );
assert.equal(
  (
    await request(
      `/events/${event.id}/registrations`,
      students[0].token,
      {},
      {},
      409,
    )
  ).error.code,
  "ALREADY_REGISTERED",
);
console.log(`Waiting for registration deadline ${input.registrationDeadline}`);
await waitUntil(input.registrationDeadline);
const draw = (await request(`/events/${event.id}/draw`, organizer.token, {}))
  .data;
assert.match(draw.txId, /^[0-9a-f]{64}$/);
assert.equal(draw.winnerCount, 2);
const detail = (await request(`/events/${event.id}/draw`, organizer.token))
  .data;
const winners = detail.winners.map((winner) =>
  students.find((student) => student.user.id === winner.id),
);
assert.ok(winners.every(Boolean));
const loser = students.find(
  (student) => !detail.winners.some((winner) => winner.id === student.user.id),
);
assert.equal(
  (await request(`/events/${event.id}/tickets/claim`, loser.token, {}, {}, 409))
    .error.code,
  "NOT_WINNER",
);
const tickets = [];
for (const winner of winners)
  tickets.push(
    (
      await request(
        `/events/${event.id}/tickets/claim`,
        winner.token,
        {},
        {},
        201,
      )
    ).data,
  );
assert.equal(
  (
    await request(
      `/events/${event.id}/tickets/claim`,
      winners[0].token,
      {},
      {},
      409,
    )
  ).error.code,
  "ALREADY_CLAIMED",
);
const moved = (
  await request(`/tickets/${tickets[0].id}/transfer`, winners[0].token, {
    toUserId: loser.user.id,
  })
).data;
assert.equal(moved.ownerId, loser.user.id);
assert.equal(moved.transferCount, 1);
assert.equal(
  (await request("/me/tickets", winners[0].token)).data.some(
    (ticket) => ticket.id === moved.id,
  ),
  false,
);
assert.equal(
  (await request("/me/tickets", loser.token)).data.some(
    (ticket) => ticket.id === moved.id,
  ),
  true,
);
assert.equal(
  (
    await request(
      `/tickets/${moved.id}/transfer`,
      loser.token,
      { toUserId: winners[0].user.id },
      {},
      409,
    )
  ).error.code,
  "TRANSFER_LIMIT_REACHED",
);
assert.equal(
  (await request(`/tickets/${moved.id}/redeem`, inspector.token, {}, {}, 422))
    .error.code,
  "CHECKIN_CLOSED",
);
console.log(
  `Claim and transfer confirmed; waiting for check-in ${input.startAt}`,
);
await waitUntil(input.startAt);
for (const ticket of tickets) {
  const redeemed = (
    await request(`/tickets/${ticket.id}/redeem`, inspector.token, {})
  ).data;
  assert.equal(redeemed.ticket.status, "REDEEMED");
  assert.match(redeemed.operation.txId, /^[0-9a-f]{64}$/);
  const history = (
    await request(`/tickets/${ticket.id}/operations`, inspector.token)
  ).data;
  assert.ok(
    history.some((operation) => operation.txId === redeemed.operation.txId),
  );
  assert.equal(
    (
      await request(
        `/tickets/${ticket.id}/redeem`,
        inspector.token,
        {},
        {},
        409,
      )
    ).error.code,
    "ALREADY_REDEEMED",
  );
}
const final = (await request(`/events/${event.id}`, organizer.token)).data;
assert.equal(final.issuedCount, 2);
assert.equal(final.redeemedCount, 2);
const operations = (
  await request(`/events/${event.id}/operations`, organizer.token)
).data;
assert.equal(operations.length, 7);
assert.ok(
  operations.every((operation) => /^[0-9a-f]{64}$/.test(operation.txId)),
);
console.log(
  JSON.stringify(
    {
      result: "PASS",
      eventId: event.id,
      drawTxId: draw.txId,
      ticketIds: tickets.map((ticket) => ticket.id),
      issuedCount: final.issuedCount,
      redeemedCount: final.redeemedCount,
      confirmedOperations: operations.map(({ type, txId, blockNumber }) => ({
        type,
        txId,
        blockNumber,
      })),
    },
    null,
    2,
  ),
);

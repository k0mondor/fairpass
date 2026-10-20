import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// Keep the presentation ticket unclaimed. This script only prepares eligibility.
const rehearsal = process.argv.includes("--rehearsal");
const fresh = process.argv.includes("--new");
const base = process.env.API_BASE_URL ?? "http://127.0.0.1:3000/api/v1";
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname),
  "Use a local development API.",
);
const directory = new URL("../../.local/", import.meta.url);
await mkdir(directory, { recursive: true });
const file = new URL(
  rehearsal ? "presentation-rehearsal.json" : "presentation-demo.json",
  directory,
);
let state;
try {
  state = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const save = () => writeFile(file, JSON.stringify(state, null, 2) + "\n");
async function request(path, token, body, headers = {}) {
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
  const result = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(result)}`);
  return result.data;
}
const organizer = await request("/auth/demo-login", undefined, {
  account: "morgan",
  password: process.env.DEMO_LOGIN_PASSWORD ?? "123456",
  role: "ORGANIZER",
});
const first = await request("/auth/demo-login", undefined, {
  account: "alex",
  password: process.env.DEMO_LOGIN_PASSWORD ?? "123456",
  role: "STUDENT",
});
const second = await request("/auth/demo-login", undefined, {
  account: "jamie",
  password: process.env.DEMO_LOGIN_PASSWORD ?? "123456",
  role: "STUDENT",
});
assert.notEqual(first.user.id, second.user.id);
if (!state || fresh) {
  const now = Date.now();
  state = {
    base,
    key: randomUUID(),
    previous: state?.eventId ?? null,
    students: [first.user, second.user],
    input: {
      title: rehearsal ? "Pass it on. Rehearsal." : "Pass it on.",
      description: "领一张校园现场的门票，把这份期待分享给另一位同学。",
      location: "校园大礼堂",
      capacity: 1,
      registrationDeadline: new Date(now + 30_000).toISOString(),
      startAt: new Date(now + 30 * 86_400_000).toISOString(),
      endAt: new Date(now + 30 * 86_400_000 + 7_200_000).toISOString(),
    },
  };
  await save();
}
assert.equal(state.base, base);
if (!state.eventId) {
  state.eventId = (
    await request("/events", organizer.token, state.input, {
      "Idempotency-Key": state.key,
    })
  ).id;
  await save();
}
let detail = await request(`/events/${state.eventId}`, first.token);
if (!detail.myRegistration)
  await request(`/events/${state.eventId}/registrations`, first.token, {});
if (detail.status === "OPEN" || detail.status === "DRAWING") {
  console.log(
    `Preparing ${state.input.title}; waiting for registration to close.`,
  );
  await new Promise((resolve) =>
    setTimeout(
      resolve,
      Math.max(
        0,
        Date.parse(state.input.registrationDeadline) - Date.now() + 1200,
      ),
    ),
  );
  await request(`/events/${state.eventId}/draw`, organizer.token, {});
}
detail = await request(`/events/${state.eventId}`, first.token);
assert.equal(detail.myRegistration.status, "WON");
const draw = await request(`/events/${state.eventId}/draw`, organizer.token);
// Event counters also detect a previously claimed ticket after it was transferred away.
state.ready = detail.issuedCount === 0;
state.winnerCount = draw.winnerCount;
await save();
console.log(
  JSON.stringify({
    eventId: state.eventId,
    title: state.input.title,
    students: state.students.map((user) => user.displayName),
    readyForClaim: state.ready,
    startAt: state.input.startAt,
  }),
);
if (!state.ready) {
  console.log(
    "This ticket has already been used for a demonstration. Run with --new to prepare another event; existing records are preserved.",
  );
  process.exitCode = 1;
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// Seed through the same HTTP/Fabric flow as the UI. Never edit SQLite or ledger state.
const base = process.env.API_BASE_URL ?? "http://127.0.0.1:3000/api/v1";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) {
  throw new Error(
    "Campus demo seeding is restricted to a local development API.",
  );
}
const directory = new URL(process.env.DEMO_STATE_DIR ?? "../../.local/", import.meta.url);
const file = new URL("campus-demo.json", directory);
await mkdir(directory, { recursive: true });
let state;
try {
  state = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  state = { base, events: {} };
}
assert.equal(state.base, base, "Use the same API as the saved demo manifest.");
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
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(result)}`);
  return result;
}
const login = async (account) =>
  (
    await request("/auth/demo-login", undefined, {
      account,
      password: process.env.DEMO_LOGIN_PASSWORD ?? "123456",
      role:
        account === "morgan"
          ? "ORGANIZER"
          : account === "taylor"
            ? "INSPECTOR"
            : "STUDENT",
    })
  ).data;
const organizer = await login("morgan");
const student = await login("alex");
const catalog = [
  [
    "after-hours",
    "After hours. Live on campus.",
    "在熟悉的校园里，听一场久违的现场演出。",
    "校园大礼堂",
    "10-26",
    "19:30",
    "21:30",
  ],
  [
    "form-matters",
    "Form matters.",
    "让想法在动手创作中慢慢成形。",
    "艺术楼 · 2 号工作室",
    "11-09",
    "14:00",
    "17:00",
  ],
  [
    "film-night",
    "Frames after dark.",
    "在星空下，一起看一场露天电影。",
    "北草坪",
    "11-18",
    "20:00",
    "22:00",
  ],
  [
    "garden",
    "A slower Sunday.",
    "留一点时间，慢下来，呼吸与生长。",
    "植物园",
    "12-01",
    "10:00",
    "12:00",
  ],
];
// Reverse insertion preserves the original order in newest-first API lists.
for (const [index, item] of catalog.entries().toArray().reverse()) {
  const [slug, title, description, location, date, start, end] = item;
  let entry = state.events[slug];
  if (!entry) {
    let year = new Date().getUTCFullYear();
    if (Date.parse(`${year}-${date}T${start}:00Z`) <= Date.now() + 86_400_000)
      year++;
    entry = state.events[slug] = {
      key: randomUUID(),
      input: {
        title,
        description,
        location,
        capacity: 120 + index * 30,
        registrationDeadline: new Date(Date.now() + 90_000).toISOString(),
        startAt: `${year}-${date}T${start}:00Z`,
        endAt: `${year}-${date}T${end}:00Z`,
      },
    };
    await save();
  }
  if (!entry.id) {
    const event = (
      await request("/events", organizer.token, entry.input, {
        "Idempotency-Key": entry.key,
      })
    ).data;
    entry.id = event.id;
    await save();
  }
  const detail = (await request(`/events/${entry.id}`, student.token)).data;
  if (!detail.myRegistration)
    await request(`/events/${entry.id}/registrations`, student.token, {});
  console.log(`Prepared ${title}`);
}
for (const [slug] of [...catalog].reverse()) {
  const entry = state.events[slug];
  let detail = (await request(`/events/${entry.id}`, student.token)).data;
  if (detail.status === "OPEN" || detail.status === "DRAWING") {
    const delay = Math.max(
      0,
      Date.parse(entry.input.registrationDeadline) - Date.now() + 1200,
    );
    if (delay) {
      console.log(
        `Waiting ${Math.ceil(delay / 1000)}s for the registration deadline`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    await request(`/events/${entry.id}/draw`, organizer.token, {});
    detail = (await request(`/events/${entry.id}`, student.token)).data;
  }
  const ticket =
    detail.myTicket ??
    (await request(`/events/${entry.id}/tickets/claim`, student.token, {}))
      .data;
  assert.equal(ticket.ownerId, student.user.id);
  const history = (
    await request(`/tickets/${ticket.id}/operations`, student.token)
  ).data;
  assert.ok(
    history.some(
      (op) => op.type === "TICKET_CLAIMED" && (/^[0-9a-f]{64}$/.test(op.txId) || (process.env.DEMO_ALLOW_MOCK === "1" && op.txId.startsWith("mock-"))),
    ),
  );
  entry.ticketId = ticket.id;
  await save();
  console.log(`Confirmed ticket: ${entry.input.title}`);
}
console.log(
  process.env.DEMO_ALLOW_MOCK === "1"
    ? "PASS: four campus activities and four tickets for alex (Mock allowed; not proof of on-chain execution)."
    : "PASS: four original campus activities and four real tickets for alex.",
);

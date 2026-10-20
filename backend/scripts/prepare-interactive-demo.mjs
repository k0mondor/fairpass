import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// Real local API data: leave registration, claiming and redemption to the user.
const base = process.env.API_BASE_URL ?? "http://127.0.0.1:3000/api/v1";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname));
const file = new URL("interactive-demo.json", new URL(process.env.DEMO_STATE_DIR ?? "../../.local/", import.meta.url));
await mkdir(new URL(".", file), { recursive: true });
let state = { base, events: {} };
try {
  state = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
assert.equal(state.base, base);
const save = () => writeFile(file, JSON.stringify(state, null, 2) + "\n");
const sleepUntil = async (iso) => {
  const delay = Math.max(0, Date.parse(iso) - Date.now() + 1500);
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
};
async function request(path, token, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(180_000),
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
const student = await request("/auth/demo-login", undefined, {
  account: "alex",
  password: process.env.DEMO_LOGIN_PASSWORD ?? "123456",
  role: "STUDENT",
});
const specs = [
  {
    key: "registration",
    title: "校园创意工作坊 · 开放报名体验",
    description: "可直接报名；主办方可查看报名人数。",
    capacity: 20,
  },
  {
    key: "claim",
    title: "校园音乐会 · 领票与转让体验",
    description: "alex已中签，尚未领票；领取后可转让给jamie。",
    capacity: 1,
  },
  {
    key: "checkin",
    title: "校园电影夜 · 现场验票体验",
    description: "alex已提前领取；开场前30分钟至活动结束可查询并核销。",
    capacity: 1,
  },
];
for (const spec of specs) {
  let entry = state.events[spec.key];
  if (entry?.id && !process.argv.includes("--new")) {
    const detail = await request(`/events/${entry.id}`, student.token);
    const ready =
      spec.key === "registration"
        ? detail.status === "OPEN" &&
          Date.now() < Date.parse(detail.registrationDeadline) &&
          !detail.myRegistration
        : spec.key === "claim"
          ? detail.myRegistration?.status === "WON" &&
            detail.issuedCount === 0 &&
            Date.now() < Date.parse(detail.startAt)
          : detail.myTicket?.status === "ACTIVE" &&
            Date.now() < Date.parse(detail.endAt);
    if (ready) {
      if (spec.key === "checkin") await sleepUntil(new Date(Date.parse(entry.input.startAt) - 30 * 60_000).toISOString());
      console.log(`Ready: ${entry.input.title}`);
      continue;
    }
    // Preserve previous records; replenish consumed/expired demonstrations.
    entry = undefined;
  } else if (process.argv.includes("--new")) entry = undefined;
  if (!entry) {
    const now = Date.now();
    const startAt =
      spec.key === "checkin" ? now + 120_000 : now + 30 * 86_400_000;
    entry = state.events[spec.key] = {
      key: randomUUID(),
      input: {
        title: `${spec.title} ${new Date(now).toISOString().slice(0, 16).replace("T", " ")} UTC`,
        description: spec.description,
        location: "校园活动中心",
        capacity: spec.capacity,
        registrationDeadline: new Date(
          spec.key === "registration" ? now + 7 * 86_400_000 : now + 10_000,
        ).toISOString(),
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(
          startAt + (spec.key === "checkin" ? 4 : 2) * 3_600_000,
        ).toISOString(),
      },
    };
    await save();
  }
  if (!entry.id) {
    entry.id = (
      await request("/events", organizer.token, entry.input, {
        "Idempotency-Key": entry.key,
      })
    ).id;
    await save();
  }
  if (spec.key === "registration") {
    console.log(`Ready for registration: ${entry.input.title}`);
    continue;
  }
  let detail = await request(`/events/${entry.id}`, student.token);
  if (!detail.myRegistration)
    await request(`/events/${entry.id}/registrations`, student.token, {});
  if (detail.status === "OPEN" || detail.status === "DRAWING") {
    console.log(`Waiting for draw: ${entry.input.title}`);
    await sleepUntil(entry.input.registrationDeadline);
    await request(`/events/${entry.id}/draw`, organizer.token, {});
  }
  if (spec.key === "checkin") {
    detail = await request(`/events/${entry.id}`, student.token);
    const ticket =
      detail.myTicket ??
      (await request(`/events/${entry.id}/tickets/claim`, student.token, {}));
    entry.ticketId = ticket.id;
    await save();
    console.log(`Waiting for pre-event check-in: ${new Date(Date.parse(entry.input.startAt) - 30 * 60_000).toISOString()}`);
    await sleepUntil(new Date(Date.parse(entry.input.startAt) - 30 * 60_000).toISOString());
    console.log(`Ready to redeem (not yet redeemed): ${ticket.id}`);
  } else console.log(`Ready for claim (not yet claimed): ${entry.input.title}`);
}
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(state.events).map(([key, entry]) => [
        key,
        {
          eventId: entry.id,
          title: entry.input.title,
          ticketId: entry.ticketId ?? null,
          startAt: entry.input.startAt,
        },
      ]),
    ),
    null,
    2,
  ),
);

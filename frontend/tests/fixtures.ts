import type { EventDetail, Ticket } from "../src/api/client";

export const event: EventDetail = {
  id: "event-1",
  organizerId: "organizer-1",
  title: "回归验证专场",
  description: "票务流程",
  location: "礼堂",
  capacity: 1,
  registrationDeadline: "2099-01-01T00:00:00Z",
  startAt: "2099-01-02T00:00:00Z",
  endAt: "2099-01-03T00:00:00Z",
  status: "OPEN",
  registrationCount: 1,
  winnerCount: 0,
  issuedCount: 0,
  redeemedCount: 0,
  createdAt: "2026-01-01T00:00:00Z",
  myRegistration: null,
  myTicket: null,
  myTicketClaimed: false,
};
export const ticket = (index = 1): Ticket => ({
  id: index.toString(16).padStart(64, "0"),
  eventId: event.id,
  originalWinnerId: "student-1",
  ownerId: "student-1",
  status: "ACTIVE",
  transferCount: 0,
  claimedAt: "2026-01-01T00:00:00Z",
  redeemedAt: null,
  event,
});
export const page = <T>(data: T[], current = 1, total = data.length) => ({
  data,
  page: current,
  pageSize: 20,
  total,
});

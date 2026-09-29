import { randomUUID } from "node:crypto";

import type { DatabaseConnection } from "../db/client.js";
import type { RegistrationRepository } from "../db/repositories/registration-repository.js";
import { ApiError } from "../errors/api-error.js";
import type {
  PageResult,
  Registration,
  RegistrationWithEvent,
} from "../types/domain.js";
import type { DateClock, EventService } from "./event-service.js";

const MAX_REGISTRATIONS_PER_EVENT = 1000;
const systemClock: DateClock = () => new Date();

export class RegistrationService {
  constructor(
    private readonly database: DatabaseConnection,
    private readonly registrations: RegistrationRepository,
    private readonly events: EventService,
    private readonly clock: DateClock = systemClock,
  ) {}

  register(eventId: string, userId: string): Registration {
    const now = this.clock();
    const operation = this.database.transaction(() => {
      const event = this.events.findRecord(eventId, now);
      if (
        event.storedStatus !== "OPEN" ||
        now.getTime() >= Date.parse(event.registrationDeadline)
      ) {
        throw new ApiError("REGISTRATION_CLOSED", "报名已截止");
      }

      if (this.registrations.findByEventAndUser(eventId, userId)) {
        throw new ApiError("ALREADY_REGISTERED", "已报名");
      }
      if (
        this.registrations.countByEvent(eventId) >= MAX_REGISTRATIONS_PER_EVENT
      ) {
        throw new ApiError("SOLD_OUT", "报名人数已达上限");
      }

      return this.registrations.insert({
        id: randomUUID(),
        eventId,
        userId,
        status: "REGISTERED",
        createdAt: now.toISOString(),
      });
    });

    try {
      return operation.immediate();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (this.registrations.findByEventAndUser(eventId, userId)) {
        throw new ApiError("ALREADY_REGISTERED", "已报名", { cause: error });
      }
      throw error;
    }
  }

  async listForStudent(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<PageResult<RegistrationWithEvent>> {
    const result = this.registrations.listByUser(userId, page, pageSize);
    const data = await Promise.all(
      result.data.map(async (registration) => {
        const eventRecord = this.events.findRecord(registration.eventId);
        const event = await this.events.toEvent(eventRecord);
        const visibleRegistration =
          eventRecord.drawWinnersHash === null && registration.status !== "REGISTERED"
            ? { ...registration, status: "REGISTERED" as const }
            : registration;

        return { ...visibleRegistration, event };
      }),
    );

    return { data, page, pageSize, total: result.total };
  }
}

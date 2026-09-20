# FairPass frontend

Run from `frontend/`:

```sh
npm install
npm run dev
```

Open the URL printed by Vite. Run `npm run build` to check TypeScript and produce the static build.

Without `VITE_API_BASE_URL`, the site runs a **labelled interface preview**. Use the account menu to switch between Student, Organizer, and Inspector. Student registration and organizer event creation change local state only. The organizer's preview draw button demonstrates the control and available places before the sample deadline, without assigning winners or creating a chain record. The inspector's sample ticket ID is `demo-ticket-after-hours`; its check-in result explicitly states that no ticket was redeemed or admitted. Preview tickets are invalid for entry, and no sample transaction is presented as a confirmed chain record.

To connect the pages to the v1 backend, copy `.env.example` to `.env.local` and set `VITE_API_BASE_URL` to the backend's `/api/v1` URL. Restart Vite. Sign in with a backend-provided test account for the desired role. The app stores the returned demo token in session storage and uses `GET /auth/me` to select the role workspace. Requests follow the [shared contract](../docs/SHARED_CONTRACT.md) and [HTTP API v1](../docs/API_V1.md).

Student flow: Events → event detail → Register → My applications → Claim ticket → My tickets → flip a ticket → inspect its QR and confirmed chain timeline → transfer before the event starts. The event and application lists support server pagination and retry after a failed load. A transferred ticket is removed by rereading `/me/tickets`.

Organizer flow: Your events → create event with an idempotency key → open an event to review capacity, registrations, winners, claimed and redeemed counts → run the draw when eligible → view filtered, paginated confirmed chain operations. `GET /me/events` returns only the current organizer's events and total count. Inspector flow: scan a QR code where `BarcodeDetector` and camera permissions are available, or enter a ticket ID manually → query and review the event, time, owner, and ticket status → confirm redemption → view the ticket and transaction ID returned together by `POST /tickets/:id/redeem`. Camera scanning can fall back to manual entry. Neither role claims a successful chain transaction on request timeout.

The “Incoming transfers” page is intentionally an unavailable state: the current v1 contract transfers ownership immediately when the sender confirms. Accept/decline invitations need the pending-invitation API change described in [`design/confirmed-ui/IMPLEMENTATION.md`](../design/confirmed-ui/IMPLEMENTATION.md). No backend or Fabric implementation is present in this repository, so live API integration cannot be exercised here.

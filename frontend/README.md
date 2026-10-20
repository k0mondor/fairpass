# FairPass frontend

For the three role walkthrough and a step-by-step setup guide in Chinese, see [界面说明与前端启动指南](../docs/UI_AND_FRONTEND_SETUP.md).

Run from `frontend/`:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Run `npm run build` to check TypeScript and produce the static build.

Without `VITE_API_BASE_URL`, the site runs a **labelled interface preview**. Use the account menu to switch between Student, Organizer, and Inspector. Student registration and organizer event creation change local state only. The organizer's preview draw button demonstrates the control and available places before the sample deadline, without assigning winners or creating a chain record. The inspector's sample ticket ID is `demo-ticket-after-hours`; its check-in result explicitly states that no ticket was redeemed or admitted. Preview tickets are invalid for entry, and no sample transaction is presented as a confirmed chain record.

To connect the pages to the v1 backend, copy `.env.example` to `.env.local` and set `VITE_API_BASE_URL` to the backend's `/api/v1` URL. Restart Vite. Sign in with a backend-provided test account for the desired role. The app stores the returned demo token in session storage and uses `GET /auth/me` to select the role workspace. Requests follow the [shared contract](../docs/SHARED_CONTRACT.md) and [HTTP API v1](../docs/API_V1.md).

The login page uses the account menu to select Student, Organizer or Inspector, followed by typed username and password in one form. It never lists preset accounts or passwords. Signing in displays the returned username in the header; the account menu shows the role and logout, without role/account shortcuts. There is no automatic sign-in. `VITE_DEMO_ROLE_SWITCH` is no longer used. Passwords are cleared after login/logout and are never saved in browser storage. The backend validates password and role as well as account. Existing user UUIDs and their tickets are preserved.


Ticket motion normally follows `prefers-reduced-motion`. For an explicitly requested full-animation demonstration, set `VITE_TICKET_MOTION=full` in `.env.local` and reload the page. This restores the original drag spring, card flight/flip and stack/grid timelines within the ticket stage, including when the embedded browser reports reduced motion. It does not change Windows or browser settings. Omit the variable or set it to `system` to follow accessibility preferences.

For internal local testing, use alex and jamie (Student), morgan (Organizer), and taylor (Inspector), with password `123456`. The UI does not disclose these credentials. The third student casey is reserved for the three-student acceptance script. The transfer panel accepts a typed unique username. The backend resolves it case-insensitively to the existing student ID before invoking the chaincode. To prepare an unclaimed ticket for alex, run `npm run demo:prepare` in the backend. Claim as alex, transfer to jamie, log out, select Student and sign in as jamie to view the transferred ticket. A consumed ticket is not reset: prepare a new event with `--new`.


To populate the original four campus activities and matching tickets, start the real backend, then run `npm run demo:campus` from `backend/`. This uses real create/register/draw/claim requests and waits about 90 seconds for registration deadlines. The four tickets belong to `alex`; the original illustrations and title line breaks are matched by activity title. Existing events and tickets are preserved. The seed manifest lives in the ignored `.local/campus-demo.json`; reruns reuse those IDs rather than creating duplicates. This is real demonstration data, so counts and statuses reflect actual actions instead of the preview's sample numbers.

Student flow: Events → event detail → Register → My applications → Claim ticket → My tickets → flip a ticket → inspect its QR and confirmed chain timeline → transfer before the event starts. The event and application lists support server pagination and retry after a failed load. A transferred ticket is removed by rereading `/me/tickets`.

Organizer flow: Your events → create event with an idempotency key → open an event to review capacity, registrations, winners, claimed and redeemed counts → run the draw when eligible → view filtered, paginated confirmed chain operations. `GET /me/events` returns only the current organizer's events and total count. Inspector flow: scan a QR code where `BarcodeDetector` and camera permissions are available, or enter a ticket ID manually → query and review the event, time, owner, and ticket status → confirm redemption → view the ticket and transaction ID returned together by `POST /tickets/:id/redeem`. Camera scanning can fall back to manual entry. Neither role claims a successful chain transaction on request timeout.

Transferred tickets appear directly in the recipient’s My tickets after confirmation. There is no pending-transfer page or accept/decline step. See [`backend/README.md`](../backend/README.md) for the real Fabric setup and acceptance flow.

## Regression checks and request states

Run `npm test` in `frontend/` for the automated API and component regression suite, and `npm run build` for the TypeScript/production build check. Tests use simulated responses and do not consume real demonstration tickets or establish real Fabric acceptance.

Live event details use the latest `myRegistration` and `myTicket` response, including explicit nulls. The student workspace follows all `/me/tickets` pages before displaying the wallet; a failed page shows a retryable load error instead of a partial wallet. Chain history distinguishes loading, error with retry, confirmed empty, and successful records.

Queries and demo login use a 12-second timeout; other POST requests allow up to 180 seconds for confirmation and reconciliation. A pending notice appears after 8 seconds. Network interruption and timeout leave the write result uncertain; inspect current state before retrying. Creation preserves its idempotency key while the form is unchanged. These waits do not automatically resubmit client writes.

Before recording, follow [the recording checklist](../docs/VIDEO_RECORDING_CHECKLIST.md). Deployment and real acceptance remain separate from these automated frontend checks.

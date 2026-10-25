# Restro360 API

## Self-signup and pricing

The committed plan configuration is in `src/config/app.config.js`; there are no new plan, provider, or CORS environment variables. A signup starts a 24-hour pending record, verifies email and mobile, sets a password, then confirms the three-month free trial. Pricing is Rs 599/month after the trial, with GST as applicable and cancellation any time. `smsProvider` and `paymentProvider` currently select dummy providers; replace them before a public launch.

Apply migrations before starting the API:

```powershell
npm run migrate
npm test
npm start
```

The self-signup schema is migration `020_self_signup`. Expired, incomplete pending signups are cleaned up hourly. Completed signups and their subscriptions are retained.

### Coolify deployments

For the Coolify backend application, set the **Pre-deployment Command** to:

```sh
npm run migrate
```

Run it from the backend app root, with the same production database environment and network access as the API. Keep it as a single pre-deployment command, not the Dockerfile/start command; the migration runner will skip IDs already recorded in `schema_migrations`. Check the deployment logs for `Migrations complete.` before treating the release as healthy.

## SMTP setup

Set only these mail-specific environment values on the service that sends mail. Keep `SMTP_PASS` secret and never commit its value:

```text
SMTP_HOST=live.smtp.mailtrap.io
SMTP_PORT=587
SMTP_USER=api
SMTP_PASS=
SMTP_FROM="Restro360 <hello@noreply.restro360.tech>"
SMTP_REPLY_TO=support@restro360.tech
```

Copy the SMTP host, username, and token from the verified Mailtrap sending-domain dashboard. `src/config/mail.config.js` contains connection options, queue retry policy, OTP settings, brand details, and daily email limits. SMTP authentication is checked at startup; a failed check is logged without preventing API startup. OTP and welcome messages use a BullMQ queue backed by the existing Redis service. Queue payloads are encrypted at rest using the existing `JWT_SECRET`; OTP verification hashes are stored in Redis.

Configure SPF, DKIM, and DMARC for `noreply.restro360.tech` in the Mailtrap dashboard, then run:

```powershell
node scripts/check-mail-auth.js
```

The script checks the five required CNAME/TXT records. After deployment, send a test OTP to a Gmail mailbox, open **Show original**, and confirm SPF, DKIM, and DMARC all say **PASS**. Check the Mailtrap sending log for delivery, and use mail-tester.com to review a message's authentication and content.

## Manual signup test

With the API, MySQL migrations, Redis, and SMTP configured, run:

```powershell
.\scripts\test-signup.ps1
```

The script asks for an accessible email address and unused mobile. Enter the email OTP when it arrives; dummy mobile OTP is `0000`. In test mode payment confirmation is simulated. The final output includes a one-time console handoff URL.

API routes:

- `GET /api/signup/plan`
- `POST /api/signup/start`
- `GET /api/signup/:token/status`
- `POST /api/signup/:token/email-otp/send`
- `POST /api/signup/:token/email-otp/verify`
- `POST /api/signup/:token/mobile-otp/send`
- `POST /api/signup/:token/mobile-otp/verify`
- `POST /api/signup/:token/password`
- `POST /api/signup/:token/trial/confirm`
- `POST /api/auth/handoff/exchange`
- `GET /api/onboarding/progress`
- `PATCH /api/onboarding/steps/:key`

Before public launch, configure real SMS and payment integrations, publish legal copy, and validate consent wording and payment authorization requirements.

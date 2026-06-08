# KpVotes — plan & status

The live plan is tracked in **PetBox** (project `kpvotes`, board `roadmap`:
Phase > Wave > Task). Architecture, run/build/deploy instructions are in
[README.md](README.md). This file keeps only durable context that doesn't belong
in either.

## Origin

Port of a .NET 10 service (AngleSharp + Quartz + LinqToTwitter) to a Node + TS
cron worker. The .NET version did a static HTTP GET of the votes page — but
Kinopoisk answers a plain GET with SSO redirects + Yandex SmartCaptcha, so the
port switched to **Lightpanda** (headless browser, executes the page JS) driven
by Playwright over CDP. The old .NET code lives in git history.

## Hard-won notes

- **Lightpanda is Linux-only** and bun cannot drive it over CDP
  ([bun #9911](https://github.com/oven-sh/bun/issues/9911)) → runtime is **node**;
  on Windows test via Docker/WSL.
- **Kinopoisk SSO is flaky.** The redirect chain sometimes doesn't finish within
  the render wait and the fetch lands on `sso.kinopoisk.ru/install` (a small stub,
  zero votes). Confirmed live. `detectBlock()` flags this as `sso`; a stuck cycle
  reports `degraded`, not a silent "no votes".
- **Rate limit:** never hit Kinopoisk more than once per hour (too-frequent
  requests trip SmartCaptcha). Enforced by a persisted last-fetch timestamp in the
  PetBox cache (`meta` table) so it survives restarts.
- **X API posting is paid.** Writing tweets needs X API credits (`402
  CreditsDepleted` otherwise); the account is funded and posting is verified via
  the v2 API (`v2.tweet`; v1.1 `statuses/update` is retired → 404).
- **PetBox wiring** — config/secrets, votes cache, logs and health all live in
  PetBox; the runtime key needs `health:write`. See README "Environment".

## Done / remaining

See the PetBox `roadmap` board for current status. At time of writing: config,
logging, cache, Docker, Twitter posting, history seed, rate-limit guard, health,
runtime logging and CI are done; production cutover (deploy + retiring the running
.NET instance) is pending stdray's go-ahead.

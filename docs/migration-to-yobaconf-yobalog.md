# KpVotes → YobaConf + YobaLog: Migration Plan

## Current State

| Dimension | Now |
|-----------|-----|
| **Type** | .NET 10 Console app, Windows Service |
| **Work** | Quartz job every 2h: scrape KinoPoisk → diff cache (`votes.json`) → tweet new votes |
| **Config** | `appsettings.json` + `appsettings.Production.json` + env vars (prefix `KpVotes_`) |
| **Secrets** | **Plain text** in `appsettings.Production.json`: 4 Twitter tokens, proxy login/password |
| **Logs** | NLog → file + console, unstructured |
| **Traces** | None |
| **Deploy** | Manual, Windows Service, no Docker |

---

## Dependencies

| Service | Status |
|---------|--------|
| **yobalog** | In prod. Ingestion (CLEF + OTLP logs + OTLP traces), KQL viewer, live tail, admin UI, share links — all working |
| **yobaconf** | Phase A (storage + resolve). Spec v2 (tagged model) written. Code in progress. **First deploy = milestone B.6** (~12 bullets away: A.0 through B.5 then B.6) |

---

## Steps

### Step 1. Logs: NLog → Seq.Extensions.Logging → YobaLog  (no blockers — do NOW)

**In KpVotes:**

1. Replace packages:
   - Remove: `NLog`, `NLog.Extensions.Logging`, `NLog.Schema`
   - Add: `Seq.Extensions.Logging` 9.0.0
2. Replace `ConfigureLogging` in `Program.cs`:
   ```csharp
   logging.ClearProviders();
   var seqUrl = context.Configuration["YobaLog:ServerUrl"];
   var seqKey = context.Configuration["YobaLog:ApiKey"];
   if (!string.IsNullOrWhiteSpace(seqUrl))
       logging.AddSeq(seqUrl, apiKey: seqKey);
   ```
3. Add enrichment per `logging-policy.md`:
   - Static enrichers: `App="KpVotes"`, `Env`, `Ver`, `Sha`, `Host`
4. Add domain fields to log messages: `VotesCount`, `NewVotes`, `VoteUri`, `ElapsedMs`
5. Delete `nlog.config`
6. Remove NLog sections from `appsettings.json`

**Config for yobalog:**
```json
"YobaLog": {
    "ServerUrl": "https://yobalog.3po.su",
    "ApiKey": "<workspace-api-key>"
}
```

**Effort:** ~2-4 hours, one commit.

---

### Step 2. Config: appsettings → YobaConf  (BLOCKED — wait for yobaconf B.6)

**Bindings to create in yobaconf:**

| TagSet | Key | Kind | Current source |
|--------|-----|------|----------------|
| `{project:kpvotes}` | `kpvotes-job.kp-uri` | Plain | `KpVotesJobOptions.KpUri` |
| `{project:kpvotes}` | `kpvotes-job.votes-uri` | Plain | `KpVotesJobOptions.VotesUri` |
| `{project:kpvotes}` | `kpvotes-job.interval` | Plain | `KpVotesJobOptions.Interval` |
| `{project:kpvotes}` | `kpvotes-job.cache-path` | Plain | `KpVotesJobOptions.CachePath` |
| `{project:kpvotes}` | `kpvotes-job.page-votes-path` | Plain | `KpVotesJobOptions.PageVotesPath` |
| `{project:kpvotes}` | `kpvotes-job.twitter-delay` | Plain | `KpVotesJobOptions.TwitterDelay` |
| `{project:kpvotes}` | `twitter.consumer-key` | **Secret** | `TwitterCredentials.ConsumerKey` |
| `{project:kpvotes}` | `twitter.consumer-secret` | **Secret** | `TwitterCredentials.ConsumerSecret` |
| `{project:kpvotes}` | `twitter.access-token` | **Secret** | `TwitterCredentials.AccessToken` |
| `{project:kpvotes}` | `twitter.access-token-secret` | **Secret** | `TwitterCredentials.AccessTokenSecret` |
| `{project:kpvotes}` | `proxy.host` | Plain | `ProxyOptions.Host` |
| `{project:kpvotes}` | `proxy.port` | Plain | `ProxyOptions.Port` |
| `{project:kpvotes}` | `proxy.username` | Plain | `ProxyOptions.Username` |
| `{project:kpvotes}` | `proxy.password` | **Secret** | `ProxyOptions.Password` |
| `{project:kpvotes}` | `loader.user-agent` | Plain | `AngleSharpLoaderOptions.UserAgent` |

Total: 15 bindings (10 Plain + 5 Secret).

**API key for KpVotes:**
```json
{
    "Description": "KpVotes consumer",
    "RequiredTags": {"project": "kpvotes"},
    "AllowedKeyPrefixes": null
}
```

**In KpVotes code:**

1. Replace `IOptionsSnapshot<T>` with YobaConf fetch.
   - **Plan A (preferred):** `YobaConf.Client` SDK with ETag polling, hot-reload.
   - **Plan B (simpler):** bash wrapper → `curl /v1/conf?project=kpvotes&template=envvar` → export env vars → exec. No hot-reload.
   - For pet-scale, plan B is enough.
2. Add `YobaConf:Endpoint` + `YobaConf:ApiKey` to `appsettings.json` (bootstrap config — allowed).
3. **Delete `appsettings.Production.json` entirely** — all secrets and settings move to yobaconf.
4. Remove `KpVotes_` prefix from `AddEnvironmentVariables` — only bootstrap vars remain.

**Effort:** ~6-8 hours.

---

### Step 3. Traces: OpenTelemetry → YobaLog  (no blockers — do after Step 1)

**In KpVotes:**

1. Packages:
   - `OpenTelemetry.Extensions.Hosting` 1.15.1
   - `OpenTelemetry.Exporter.OpenTelemetryProtocol` 1.15.1
2. Instrument:
   - `KpVotes.Scrape` — root span with children:
     - `GetSiteHtml` (HTTP GET KinoPoisk)
     - `Parse` (HTML → votes)
     - `Diff` (compare with cache)
     - `SendTweet` (Twitter API)
     - `SaveCache` (file I/O)
3. Gate on `OpenTelemetry:Enabled` (off in dev, on in prod).
4. Config:
   ```json
   "OpenTelemetry": {
       "Enabled": false,
       "OtlpEndpoint": "https://yobalog.3po.su/v1/traces"
   }
   ```
5. Auth header: `X-Seq-ApiKey` (same key as logs).

**Effort:** ~3-4 hours.

---

### Step 4. Docker-ization  (no blockers — do anytime)

**Now:** Windows Service. **Goal:** Docker container on Linux (shared host with yobaconf/yobalog).

1. Dockerfile — two-stage (SDK build → chiseled runtime):
   ```dockerfile
   FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
   WORKDIR /src
   COPY . .
   RUN dotnet publish KpVotes/KpVotes.csproj -c Release -o /app

   FROM mcr.microsoft.com/dotnet/nightly/runtime-deps:10.0-noble-chiseled
   COPY --from=build /app /app
   ENTRYPOINT ["/app/KpVotes"]
   ```
2. Remove `.UseWindowsService()` — replace with standard `IHostedService` lifecycle.
3. Deploy pattern from yobaconf/yobalog: CI → Docker build → push to ghcr.io → SSH deploy by tag.
4. Port allocation: loopback `127.0.0.1:8083` (next free after yobalog's `8082`).

**Effort:** ~4-6 hours.

---

### Step 5. Health endpoint + self-observability  (no blockers — do after Step 1)

1. Add `/health` endpoint (anonymous, 200 = process alive):
   ```csharp
   app.MapGet("/health", () => Results.Ok());
   ```
2. Add `/ready` endpoint (200 = YobaConf reachable).
3. Self-observability log events:
   - Startup: `"KpVotes starting, env={Env}, sha={Sha}"`
   - Job start/end with `VotesCount`, `NewVotes`, `ElapsedMs`
   - Twitter API rate-limit / proxy errors with full context

**Effort:** ~2-3 hours.

---

### Step 6. CI/CD  (no blockers — do after Step 4)

1. `.github/workflows/ci.yml` — mirror yobaconf/yobalog pattern:
   - Build + test on PR/push to main
   - Docker build + push to ghcr.io on main push
   - SSH deploy **only on `deploy` tag**
2. Caddy fragment for `kpvotes.3po.su` → `127.0.0.1:8083` (health endpoint).
3. GitHub secrets: `GHCR_TOKEN`, `SSH_HOST`, `SSH_KEY`, `YOBALOG_API_KEY`, `YOBACONF_API_KEY`.

**Effort:** ~3-4 hours.

---

## Dependency Graph

```
              NOW                          AFTER YOBACONF B.6
              ───                          ──────────────────

Step 1 ──► ✅ Do now                       Logs → YobaLog
Step 2 ──► 🚧 Wait for yobaconf B.6        Config + secrets → YobaConf
Step 3 ──► ✅ Do now (after Step 1)        Traces → YobaLog
Step 4 ──► ✅ Do now                       Docker + Linux
Step 5 ──► ✅ Do now (after Step 1)        Health + observability
Step 6 ──► ✅ Do now (after Step 4)        CI/CD
```

**Can start in parallel:** Steps 1, 3, 4, 5, 6 — literally tomorrow. yobalog in prod, Docker toolchain ready.
**Blocked:** Step 2 — waits for yobaconf Phase B first deploy (B.6).

**Recommended order:** 1 (logs) → 3 (traces) → 5 (health) → 4 (Docker) → 6 (CI/CD) → 2 (config, last, when yobaconf ready).

---

## Summary: What Changes

| Dimension | Before | After |
|-----------|--------|-------|
| **Secrets** | Plain-text in `appsettings.Production.json` in git | AES-256-GCM in YobaConf, never in git |
| **Logs** | NLog → file + console, unstructured | Seq → YobaLog, CLEF structured, KQL search, live tail |
| **Traces** | None | OTLP → YobaLog, waterfall UI |
| **Config** | 2 JSON files + env-vars, prefix `KpVotes_` | YobaConf tagged bindings, `GET /v1/conf?project=kpvotes` |
| **Deploy** | Manual, Windows Service | CI/CD → Docker → SSH, `deploy` tag |
| **Shared host** | Separate Windows box | Linux shared host with yobaconf/yobalog/yobapub |

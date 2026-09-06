# Procurement Command Center

A Dockerized, AI-assisted buyer workbench modeled on a "Procurement Command
Center" prototype for a large industrial buyer organization. It reproduces
a dashboard, AI Decision Feed, PR detail workflow, Procurement AI copilot,
and savings-gamification widgets, backed by a real (if small) service
architecture: Node/Express API + rule-based agent engine, Couchbase
**Enterprise Edition** as the operational data store and context cache, and
a static frontend served by nginx.

## How this was built

This app models a large industrial buyer's procurement workflow: a
164-year-old company with 20+ ERPs, 500+ facilities, 18 business units and
34,000 user groups, where a thin layer of intelligent agents sits in front
of many disparate ERPs so buyers interact with one coordinated system
instead of 20 different back ends. Everything under **AI Architecture**
below (the 5-layer Context Hub, the Trust Layer, the 56-rule business-rule
catalog, the LMN business-process project, agent reuse across
planning/requisition/buying, and buyer-behavior/agent-accuracy logging) is
modeled on that pattern.

### Why Couchbase is in the stack

A big part of the value of adding Couchbase to this stack is improving
latency and response quality, but the main driver is cost reduction — not
having to hit Snowflake or the LLM provider on every request. Couchbase is
adopted here as a phased "AI data plane," not a one-off cache: an initial
adoption uses caching as the entry point, and later phases consolidate more
of the agent/tooling/MCP-tool footprint into Couchbase. Centralizing MCP
tools and vector embeddings in Couchbase brings role-based access control
and governance over those tools that agents wouldn't otherwise have. This
app implements only the first phase (context caching) — see **AI Data
Plane adoption journey** below for the rest of the roadmap, which is
documented but not built.

## What the app does

- **Dashboard** — KPI cards (PRs waiting, savings identified, oversupply
  alerts, POs created this month) and an **AI Decision Feed**: every open
  purchase request run through four agents, each producing an explainable
  recommendation:
  - **Best Price Agent** — flags a cheaper qualified supplier than the PR's
    current one and computes the savings.
  - **Oversupply Agent** — checks inventory and open POs across *every*
    org (not just the requesting one) and recommends "Don't Buy" when
    existing supply covers the need.
  - **Sourcing Agent** — surfaces a genuine price-vs-lead-time tradeoff
    between two-plus qualified suppliers instead of forcing a single answer.
  - **Validation Agent** — runs on demand before a PO is created: supplier
    master / ASL / remit-to, payment terms, contract validity, buying-org
    coding.
- **PR detail drawer** — current vs. recommended supplier comparison, the
  lead-time-vs-need-by math, an auditable "Agent Decision Record" checklist,
  and the actions a buyer can take: Review later, Run validation, Create PO,
  Accept recommendation, or **Reject recommendation**. Both accept and
  reject are logged, since agent accuracy runs both ways — a reject is
  tracked just as carefully as an accept (see Agent Accuracy below).
- **Procurement AI** — a context-aware chat panel scoped to whatever PR is
  selected, with quick-action chips ("My priority", "Compare suppliers",
  "Explain oversupply", "PO readiness"), plus freeform questions about the
  app's own architecture ("why is Couchbase here?", "what's the trust
  layer?"). Every reply is grounded in a small rules engine that computes
  the underlying facts, then phrased by Gemini via the Couchbase Agent
  Operations Manager when it's configured and reachable — see "LLM
  integration: Gemini via the Couchbase Agent Operations Manager" below for
  the full design and how to run it.
- **Savings Momentum** — a weekly-quest / team-momentum / recognition-feed
  gamification widget driven by real accepted/PO'd savings during your
  session, plus two additions:
  - **Agent Accuracy** — accept vs. reject counts and an accuracy percentage
    per agent, computed from the buyer-action log.
  - **Hunger Games leaderboard** — verified savings by business unit, framed
    as friendly competitions between business units over how much they're
    using the recommendations.
- **Purchase Requests / PO Summary / PO Management / Supplier Communication
  / Suppliers** — full-list views behind the same API. Purchase Requests now
  includes each PR's business unit.
- **AI Architecture** — a dedicated view surfacing the 5-layer Context Hub,
  the Trust Layer, the business-rule catalog, the AI Data Plane phased
  journey, the 18 business units and their shared LMN process, and the
  agent build-out roadmap — see **AI Architecture** below for what's behind
  it.

## AI Architecture

This app models a specific architecture behind the Procurement Command
Center, distinct from — and larger than — the four agents it implements.
It's modeled in `backend/src/data/seed.js` and served at
`/api/context-hub`, with a full write-up in the app's own **AI
Architecture** nav item rather than only here. Summary:

- **Context Hub (5 layers)** — built the way you'd train a new hire fresh
  out of college: (1) general business & supply-chain skills, (2) oil & gas
  industry domain knowledge, (3) company knowledge (the 18 business units),
  (4) process context — the **LMN project**, which aligns all 18 business
  units to 5 shared business processes (Source to Pay, Demand to Deliver,
  Order to Cash, Finance, HR — Procurement Command Center lives in Source
  to Pay), and (5) agent-specific skills, tools & business rules.
- **Trust Layer** — a cross-cutting governance layer covering
  explainability, observability, buyer-behavior/agent-accuracy logging, and
  an IT GRC/audit checklist, plus data-handling commitments: encryption at
  rest and in transit, and **per-persona memory segregation** (each
  buyer's episodic memory is stored separately, so search patterns and
  history can't be accessed across users).
- **Business-rule catalog** — the underlying logic is rule-based and large
  in scope: roughly 56 business rules, consistent across scenarios but
  varying in applicability. This app implements the 10 rule shapes directly
  evidenced by the reference app (across oversupply/transfer, best price,
  sourcing tradeoff, and validation-gate categories) — the full 56-rule
  catalog is customer engagement work product this build has no visibility
  into, so the rest is documented as a gap, not invented.
- **Agent reuse (microservice pattern)** — rather than one agent per
  business unit, the same agent with the same logic can be invoked at
  different points in a business process: at the planning stage, at
  purchase requisition, or at the time of buying.
  `decideForPurchaseRequest(pr, invocationPoint)` in
  `backend/src/agents/engine.js` threads an `invocationPoint` argument
  through for exactly this reason, though this demo only exercises the
  "buying" point (there's no separate planning- or requisition-stage data
  model here).
- **AI Data Plane adoption journey** — three phases: (1) context caching —
  implemented, this app; (2) logging, observability & behavioral
  monitoring — partially implemented (buyer accept/reject + agent accuracy
  are real; full audit tracing/retention is not); (3) centralized MCP
  tools & vector embeddings for RBAC/governance — roadmap only, not built
  (this app's ERP/Snowflake access is mocked, not a real MCP layer).
- **Business units** — modeled on an organization with 18 business units.
  `DH` / Downhole is the one real-world-style unit code kept as a reference
  point; the other 17 in `seed.js` are fictional placeholders in the same
  spirit as this app's other mock data, not real business-unit names.
- **Scale** — illustrative context, not modeled at demo scale: 20+ ERPs
  (this app models a "Big 3": JDE, Oracle EBS, Omega ERP, plus Snowflake),
  500+ facilities, 35,000 employees, 10,000 POs a day. Agent build-out
  roadmap: 8 agents targeted for the current program increment (Q4 2026,
  "Procure to Pay" group), 18–19 by end of Q4 2026, ~100 by end of 2027.

### Context caching (Couchbase)

Every agent decision is computed from the PR's (mocked) source-ERP and
Snowflake data, then cached in Couchbase under `context_cache::decision::<PR
ID>`. The first look at a PR is a "cache miss" — the API simulates the
latency of fanning out to ERP + Snowflake — and every subsequent look (or
another buyer opening the same PR) is a near-instant cache hit. Each row in
the AI Decision Feed and PR detail panel shows which happened
(`⚡ cache (Nms)` vs `↻ live (Nms)`), so the caching benefit the demo's title
refers to is something you can actually see, not just read about. See
`backend/src/services/contextCache.js` and `backend/src/db/couchbase.js`
(a thin REST/N1QL client — no native SDK bindings required).

## Architecture

```
frontend (nginx, static HTML/CSS/JS)  →  backend (Node/Express)  →  couchbase (enterprise edition)
        :8080                                  :4000                      :8091 / :8093
```

- `frontend/` — no build step; vanilla JS SPA-style app (`public/app.js`)
  that renders the same layout/interactions seen in the reference
  screenshots, calling the backend's JSON API.
- `backend/` — Express API. `src/agents/engine.js` holds the four agents as
  pure functions; `src/services/contextCache.js` wraps them with the
  Couchbase-backed cache; `src/data/seed.js` is the mock JDE / Oracle EBS /
  Omega ERP / Snowflake data (fictional, modeled after the demo's item
  types and org names — this is not real customer data).
- `couchbase` — official Couchbase **Enterprise Edition** image
  (`couchbase:enterprise-8.0.2`, current as of 2026-08 — also tagged
  `latest`/`enterprise` on Docker Hub). `backend/src/db/couchbase.js`
  bootstraps the cluster (services, admin credentials, the `procurement`
  bucket, a primary index) on first boot and seeds it, entirely over HTTP —
  no native Couchbase SDK, so the backend image stays a plain `node:20-alpine`
  build. This app only exercises the KV/N1QL/Index services (same as
  Community Edition); Enterprise Edition is used here because it's a
  reasonable default to build on using the enterprise developer free
  license — there's nothing wrong with building on that tier, and you can
  always license further from there. It's also the edition needed if you
  later want XDCR, Eventing, Analytics, or to scale past Community's
  5-node/4-core-per-node ceiling. Couchbase's role here is specifically the
  context-cache layer (see AI Architecture and Context caching below) —
  not, in this build, the centralized MCP-tool/vector-embedding governance
  layer described above, which is a later phase of the same adoption
  journey.

  **Licensing (developer/free mode)**: Enterprise Edition is free to run
  for development and testing (this is exactly that) — no license key,
  sign-up, or EULA-acceptance flag needed to start the container; the app's
  own `initCluster()` bootstrap (cluster init, bucket creation, primary
  index) is all this needs to go from a fresh container to a working
  cluster. A paid subscription is required only for production deployment;
  see [couchbase.com/pricing](https://www.couchbase.com/pricing) and the
  [image's license terms](https://github.com/docker-library/docs/blob/master/couchbase/license.md)
  before running this anywhere beyond local development. This licensing
  model is unchanged from the 7.2.4 image this app originally shipped with
  — 8.0.2 doesn't introduce a different license tier or require an extra
  opt-in step.

  **What changed 7.2.4 → 8.0.2**: the only functional change relevant to
  this app is that **new buckets default to the Magma storage engine**
  instead of Couchstore as of Enterprise 8.0 (lowering the minimum
  per-node memory quota from 1 GiB to 100 MiB) — this app's bucket-creation
  call (`ramQuotaMB: "256"`) is comfortably above that either way, so no
  code change was needed. The Management/Query REST endpoints
  `backend/src/db/couchbase.js` calls (`POST /clusterInit`,
  `/pools/default`, `/pools/default/buckets`, `/query/service`) are
  unchanged in 8.0 per the official release notes — the only REST
  deprecation called out is the bucket-stats endpoint, which this app never
  uses.

  **Real bug found and fixed against an actual 8.0.2 container**: the
  first version of this app that shipped with 8.0.2 still failed to boot a
  real cluster (it worked fine under the in-memory driver, which never
  touches this file at all). Two compounding bugs, both now fixed in
  `backend/src/db/couchbase.js`:

  1. `initCluster()` used to issue cluster bootstrap as four separate,
     unauthenticated calls (`/node/controller/setupServices`,
     `/pools/default`, `/settings/indexes`, `/settings/web`) with no
     response-status checking at all — so any failure among them left the
     cluster silently uninitialized (stuck on the "Setup New Cluster"
     wizard) with nothing in the logs to explain why. Fixed by switching to
     Couchbase's single documented bootstrap endpoint,
     [`POST /clusterInit`](https://docs.couchbase.com/server/current/rest-api/rest-initialize-cluster.html)
     (it "combines all of the others"), with the response status actually
     checked and the body surfaced on failure.
  2. The internal `mgmtRequest()` helper defaulted to `method: "GET"`, and
     neither the new `/clusterInit` call nor the pre-existing
     `/pools/default/buckets` (bucket creation) call ever passed
     `method: "POST"` explicitly. Node's built-in `fetch` throws `Request
     with GET/HEAD method cannot have body` the moment a body is attached
     to a GET — so both of these calls threw immediately, before ever
     reaching the network, on every real Couchbase container. This had been
     broken since the very first build; it was invisible under the
     in-memory driver (which bypasses this file) and undetectable in this
     sandbox (which cannot pull any Docker image at all — see below), and
     only surfaced once someone actually ran `docker compose up --build` on
     a machine with real Docker Hub access. Fixed by defaulting the method
     to `POST` whenever a body is present.

  Also fixed at the same time: `server.js`'s startup code used to set
  `process.exitCode = 1` on a fatal bootstrap failure without ever calling
  `process.exit()` — which does *not* terminate a running Node process, so
  a repeatable failure just left the container running forever with
  `ready: false` and no crash, no restart, and no visible error (exactly
  the symptom above: Couchbase up, cluster never initialized, frontend
  stuck on "Starting Couchbase…" indefinitely). Startup now retries up to 3
  times, surfaces the last error via `/api/health`, and calls
  `process.exit(1)` if all retries fail — combined with
  `restart: on-failure:3` in `docker-compose.yml`, a genuine failure now
  surfaces within a couple of minutes instead of hanging silently.

  **Second real bug, found once the cluster itself was booting
  correctly**: with the fixes above, `docker compose up --build` got all
  the way through cluster init, bucket creation, and primary index
  creation — then failed while seeding data, with Couchbase's query
  service returning `Error evaluating KEY - cause: No value for named
  parameter $key`. Every N1QL call in `couchbase.js` (`upsert`, `get`,
  `remove`, `selectByType`) writes its statement with *named* placeholders
  (`$key`, `$doc`, `$type`), but was passing its values through the REST
  API's `args` array — which is the wire format for *positional*
  placeholders (`$1`, `$2`, ...) only. Couchbase's query service has no way
  to connect an `args` array to a named placeholder, so it failed
  correctly, on every single call. Fixed by sending each value as its own
  `$`-prefixed top-level field (e.g. `{ "$key": ..., "$doc": ... }`)
  instead — the wire format Couchbase's N1QL REST API actually expects for
  named parameters.

## Running it

```bash
docker compose up --build
```

First boot takes 30–90 seconds while Couchbase initializes and the backend
seeds it — the frontend shows a "starting up" message and polls
`/api/health` until it's ready.

- App: http://localhost:8080
- API directly: http://localhost:4000/api/...
- Couchbase admin console: http://localhost:9091 (Administrator / password123
  — change `COUCHBASE_PASSWORD` in `docker-compose.yml` for anything beyond
  a local demo. Moved from the usual 8091 to avoid colliding with the
  Couchbase Agent Operations Manager's own Couchbase cluster if you're
  running both stacks — see "LLM integration" below.)

To stop and wipe all data (Couchbase volume included):

```bash
docker compose down -v
```

## Login & access control

The app is gated by local login: nothing behind the sidebar is reachable
until you sign in. On first boot a single local account exists —
`admin`, no password yet — and its first login prompts you to set one
instead of accepting any password. That password (and every other local
account's) is scrypt-hashed and then AES-256-GCM encrypted before it's
written to Couchbase (`backend/src/services/crypto.js` /
`backend/src/services/auth.js`) — set `ENCRYPTION_KEY` (`openssl rand -hex
32`) in `.env` for anything beyond local dev/demo; without it the app
falls back to a hardcoded insecure dev key and says so loudly in the
backend logs.

Signed-in admins get a **Settings** section at the bottom of the sidebar
(hidden for `buyer`/`viewer` accounts):

- **Users & Roles** — create/delete local accounts, change roles, reset
  passwords. Roles are `admin` (this Settings section), `buyer` (works
  purchase requests/POs — the normal day-to-day role), and `viewer`
  (read-only).

Sessions are opaque, server-side tokens in an httpOnly cookie (not JWTs),
so signing out or deleting a user's session document revokes access
immediately. Set `COOKIE_SECURE=1` once this is served over HTTPS.

### Running without Docker (quick local dev)

`backend/src/db/couchbase.js` also supports an in-memory driver so you can
run the API without Couchbase or Docker at all:

```bash
cd backend
npm install
COUCHBASE_DRIVER=memory PORT=4000 node src/server.js
```

Then serve `frontend/public` with any static file server that proxies
`/api/*` to `http://localhost:4000` (or just open `frontend/public/index.html`
and point `API` in `app.js` at `http://localhost:4000/api`).

### What's been verified vs. what to verify on your machine

This sandbox's network egress policy blocks every container registry
(Docker Hub, GHCR, public ECR, GCR, MCR, quay.io all return 403) alongside
the model-hosting CDNs mentioned above, so `docker compose build` could not
actually be run here — there's no way to pull `node:20-alpine`,
`nginx:alpine`, or `couchbase:enterprise-8.0.2`. What *was* verified in this
environment, end-to-end, using the in-memory driver above plus a headless
Chromium (Playwright) rendering the real frontend against the real API:
cluster bootstrap/seeding logic, every API route (dashboard summary, PR
list/detail/validate/create-po/accept/**reject**, suppliers, supplier
communication, gamification, copilot chat, and the new **context-hub**
route), the context-cache hit/miss behavior and latency reporting, the
buyer-action audit log (accept and reject both write to it, and
`/api/gamification`'s `agentAccuracy`/`hungerGames` fields aggregate off of
it correctly), and the full UI (dashboard, PR detail panel for all three
recommendation types plus the new Reject button, Purchase Requests with its
new Business Unit column, and the new **AI Architecture** view) with zero
browser console errors. The one thing that combination can't prove is the real Couchbase
REST/N1QL bootstrap sequence in `initCluster()` (cluster init, bucket
creation, primary index) — that talks to Couchbase's actual admin API and
needs the real container. This is not hypothetical: an earlier version of
this app was run against a real 8.0.2 container and its `initCluster()`
sequence failed outright (see "Real bug found and fixed" above) in a way
none of the in-memory-driver testing could have caught. To get a second
layer of coverage on this file without a real container, its request-
construction logic was additionally tested against a hand-written fake
HTTP server standing in for Couchbase's mgmt API — confirming `/clusterInit`
and `/pools/default/buckets` are now sent as `POST` with the correct
form-encoded body, that a real 400 failure from either is caught and
surfaced with its actual status and body, and that the full happy path
(`clusterInit` → bucket creation → primary index) completes end to end.
That's still not the same as a real container — it can't catch things like
Magma-specific behavior, timing/readiness quirks, or anything Couchbase's
actual REST implementation does differently from the fake server — so run
`docker compose up --build` on a machine with normal Docker Hub access to
confirm the real thing. If anything about the Couchbase bootstrap sequence
still needs adjusting, `backend/src/db/couchbase.js` is the only file
involved. The Community → Enterprise image swap itself is a config-only
change (same tag scheme, same KV/N1QL/Index services, same REST/N1QL admin
API) and wasn't re-verifiable here for the same registry-access reason —
it should be a drop-in, but it's the first thing to check if
`docker compose up` behaves differently than described above.

**Update: real-container testing has since gone further and caught a
second real bug.** With the fixes above, `docker compose up --build` was
run again on a real 8.0.2 container and got past cluster init, bucket
creation, and primary index creation — then failed while seeding data with
`No value for named parameter $key` (see "Second real bug" above: named
N1QL parameters were being sent in the wrong wire format). That's now
fixed too, and was re-verified the same way as before — a hand-written fake
N1QL query service that validates named-parameter passing the way
Couchbase's real query service does, confirming `upsert`/`get`/`remove`/
`selectByType` all now send correctly `$`-prefixed parameters instead of a
positional `args` array. Two real bugs found via two rounds of actual
`docker compose up --build` runs on real hardware is exactly why this
section keeps getting more specific instead of more confident: this
sandbox still cannot pull a Couchbase image, so every claim about the real
bootstrap+seed path is only as good as the next real run. If this round
still doesn't get all the way to a seeded, ready dashboard, the exact
backend log (`docker compose logs backend`) is the fastest way to find the
next thing to fix.

**The 7.2.4 → 8.0.2 version bump was checked via WebSearch/WebFetch against
Couchbase's official release notes and Docker Hub tag listing** (this
sandbox's bash egress can't reach either directly, but WebSearch/WebFetch
route through different infrastructure and could): confirmed
`enterprise-8.0.2` exists on Docker Hub (also aliased `latest`/`enterprise`,
multi-arch amd64+arm64), confirmed the Enterprise developer/free license
terms are unchanged for 8.0.x, and confirmed none of the REST endpoints
`couchbase.js` calls are deprecated or changed in 8.0 (the only REST
deprecation in the 8.0 release notes is the bucket-stats endpoint, which
this app doesn't use). What that research **can't** substitute for is
actually booting an 8.0.2 container — same registry-blocked reason as
everything else Docker-related in this sandbox — so this is still the
first thing to check if `docker compose up` behaves differently than
described.

**The `apk add ca-certificates` corporate-proxy fix (item 1 in the section
below) could not be verified against a real Docker build either, for the
same registry-blocked reason** — `docker compose build` in this environment
fails immediately on `FROM node:20-alpine` with `403 Forbidden` resolving
`registry-1.docker.io`, before either Dockerfile's `RUN` steps ever
execute. What *was* verified: the exact shell logic in both Dockerfiles'
`RUN` blocks (the `HAS_CA` check, the `sed` swap to `http://`, and the
restore) was extracted and run standalone under `sh` for both the
"corporate cert present" and "no corporate cert" cases, and produced the
expected `/etc/apk/repositories` contents in each. If it still doesn't work
on your machine — e.g. your proxy blocks plain HTTP outright — that's the
first thing to report back with the exact error.

## Corporate networks / TLS-inspecting proxies

If you're on a corporate laptop behind a TLS-inspecting proxy (Zscaler,
Netskope, Palo Alto GlobalProtect, etc.), `docker compose build` can fail
three different ways, and they need three different fixes:

1. **`apk add --no-cache ca-certificates` fails inside the backend or
   frontend build** with `WARNING: fetching ... TLS: server certificate not
   trusted` followed by `ERROR: unable to select packages: ca-certificates
   (no such package)`. This one is a chicken-and-egg problem: that `apk add`
   step is fetching the Alpine package index over HTTPS, and — until it
   succeeds — apk has no way to know about your proxy's root CA, because
   installing that trust is the whole point of the step that's failing. Both
   Dockerfiles work around this automatically: when a non-empty
   `certs/corporate-ca.crt` is present, the build temporarily points
   `/etc/apk/repositories` at plain HTTP (nothing to intercept-and-reject on
   an unencrypted connection) just long enough to install `ca-certificates`
   and run `update-ca-certificates`, then switches back to HTTPS. You
   shouldn't need to do anything extra for this one beyond step 2 below —
   it's mentioned here mainly so the error message doesn't look like a dead
   end if you see it on an unpatched copy of this repo. (If your proxy also
   blocks plain HTTP outright — less common, but some do — this workaround
   won't help; ask IT whether your Docker daemon can be pointed at an
   internal Alpine mirror instead.)

2. **`npm install` fails inside the backend build** with something like
   `SELF_SIGNED_CERT_IN_CHAIN` or "self-signed certificate in certificate
   chain". This is Node's own CA store inside the build container not
   trusting your proxy's root certificate. Fix it by running, on macOS:

   ```bash
   ./scripts/setup-corporate-ca.sh
   docker compose build --no-cache
   ```

   This exports your Mac's trusted root CAs into `backend/certs/corporate-ca.crt`
   and `frontend/certs/corporate-ca.crt` (both Dockerfiles trust it if
   present, and are harmless no-ops otherwise — the repo ships empty
   placeholders so a normal, non-proxied build works out of the box). On
   Linux, ask IT for your org's proxy root CA `.pem`/`.crt` and copy it to
   those two paths yourself, then rebuild. The certificate itself isn't
   sensitive (it's a public root cert, not a key), but it's machine-specific
   — re-run the script if you switch machines or your org rotates the proxy
   cert.

3. **`docker pull` / `docker compose build` fails before any of your
   Dockerfiles even run**, pulling `node:20-alpine`, `nginx:alpine`, or
   `couchbase:enterprise-8.0.2` from Docker Hub. That's the Docker *Engine*
   itself failing TLS verification against the proxy, which a Dockerfile
   can't fix — it needs the proxy's root CA trusted at the Docker Desktop /
   daemon level (Docker Desktop → Settings → Docker Engine, or the host's
   `/etc/docker/certs.d/` for a Linux Docker install). That's usually a
   one-time machine setup your IT team already has instructions for if
   other Dockerized projects work on your laptop.

## LLM integration: Gemini via the Couchbase Agent Operations Manager

An earlier version of this README described an "Optional: a real
Claude-backed copilot" you could enable by setting `ANTHROPIC_API_KEY` —
that was aspirational and never actually implemented; the code was 100%
rule-based regardless of that variable. This section replaces it with
what's actually built: this app's LLM calls now really do go to a real
model, but through the **Couchbase Agent Operations Manager (AOM)** — a
separate, standalone project — rather than by holding a provider API key
directly.

### Why route through AOM instead of calling a provider directly

AOM is a governed choke point for both MCP tool traffic and LLM traffic:
every call is authenticated, audited, and — for LLM calls specifically —
checked against a Couchbase-backed cache (exact hash match, then semantic
similarity) before it ever reaches a real model. Pointing this app at AOM
instead of holding its own `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` means this
app never touches a provider key at all, repeat questions (a buyer
re-opening the same PR, a common copilot question) cost nothing after the
first call, and every LLM call this app makes is visible in AOM's own
Audit Log and LLM Caching dashboard. AOM's own policy currently has Gemini
(`gemini-2.5-flash`) selected as its active provider — see that project's
README — but this app pins `provider: "google"` explicitly on every
request it sends (`backend/src/services/aomClient.js`) rather than
trusting whatever AOM's admin-configured default happens to be, so it
keeps using Gemini even if someone later repoints the shared appliance at
a different provider from its own UI. The same client also makes real
`discover`/`invoke` calls against AOM's Snowflake sample server for two
quick actions — see "Compare suppliers" and "PO readiness" below — so
this app's traffic lights up both the agent -> LLM provider *and* agent ->
MCP server edges on AOM's Dashboard "Live topology" diagram.

### What actually calls Gemini, and what stays deterministic

Two places in this app produce LLM-backed text, and in both, **the facts
stay deterministic — only the phrasing is Gemini's**:

- **Each agent decision's `rationale`** (`backend/src/services/
  agentNarration.js`, wired into `contextCache.js`). The Best Price,
  Oversupply, Sourcing and Validation agents in `agents/engine.js` are
  unchanged: they still deterministically decide which supplier, what
  price, how much is saved, whether stock exists elsewhere, against the
  same mock ERP/Snowflake-sourced data as before. Only the buyer-facing
  sentence explaining that decision is generated by asking
  Gemini (via AOM) to phrase already-computed facts — the prompt is
  explicit that it must use *only* the facts given, never invent a
  supplier, price, or number. This split is deliberate: these decisions
  drive real actions (PO creation), and an LLM call is a fine way to write
  a better sentence but a bad way to decide how much money to commit.
  Because this runs inside the existing Couchbase context-cache layer
  (`contextCache.js`), Gemini is only called once per PR per cache TTL —
  a cache hit costs nothing, same as before this integration existed.
- **The Procurement AI copilot's replies** (`backend/src/services/
  copilot.js`). Each quick action (My priority / Compare suppliers /
  Explain oversupply / PO readiness) and the freeform fallback still
  build their answer from the same rule-based facts as before; those
  facts are then handed to Gemini via AOM to produce the final reply
  text. Two of the four — Compare suppliers and PO readiness — first run
  a real `discover` + `invoke` round trip against AOM's bundled Snowflake
  sample server (`aomClient.discoverAndInvoke()`) and fold a short
  cross-check note into the facts when it succeeds, before narration; a
  failed or skipped lookup (AOM unreachable, not configured) just means no
  note gets added, same fallback posture as everything else here. The one
  exception to narration entirely is the "architecture" quick action
  (questions about the app's own Context Hub / Trust Layer / business
  rules) — that stays pure authored text, deliberately not narrated, since
  there are no PR facts to ground an answer about the app's own design,
  and asking Gemini to describe its own host application risks it
  improvising details about itself.

**Resilience**: if `COUCHBASE_AOM_API_KEY` isn't set, or AOM is
unreachable, or a call fails for any reason, both paths fall back to
their original rule-based text unchanged (with a warning logged
server-side) — the app works fully with no AOM running at all, the same
posture the old (never-wired) `ANTHROPIC_API_KEY` option had. The PR
detail panel's "Rationale by ..." line tells you which happened on any
given decision.

### Configuration

```bash
# in .env (see .env.example)
COUCHBASE_AOM_URL=https://host.docker.internal:8090
COUCHBASE_AOM_API_KEY=demo-finance-analyst-7e83
COUCHBASE_AOM_PROVIDER=google
COUCHBASE_AOM_MODEL=gemini-2.5-flash
COUCHBASE_AOM_ALLOW_INSECURE_TLS=true
```

- **`COUCHBASE_AOM_URL`** defaults to `host.docker.internal:8090` because
  AOM runs as its own separate `docker compose` stack on the same
  machine, not joined to this app's Docker network. Docker Desktop
  resolves that hostname to the host automatically on macOS/Windows;
  `docker-compose.yml` also adds an `extra_hosts` entry so it resolves on
  Linux Docker Engine too. Point it elsewhere if AOM runs on a different
  host or you've joined the two stacks onto a shared Docker network (in
  which case you'd use AOM's `operations-manager` container's Docker DNS
  name instead). It's `https://` because AOM's `operations-manager`
  service serves HTTPS by default with a self-signed cert it generates on
  first boot; if you run AOM with `DISABLE_TLS=true`, switch this back to
  `http://` (and the insecure-TLS setting below becomes irrelevant).
- **`COUCHBASE_AOM_API_KEY`** defaults to AOM's own bundled demo
  `finance_analyst` key (`demo-finance-analyst-7e83`, from that project's
  `.env.example`) so this works out of the box against a freshly-started
  AOM appliance with no extra setup. `finance_analyst` is the
  least-privilege seeded role that can still call the Snowflake tools
  (`query`/`get_metrics`/`list_tables`) this app's Compare suppliers / PO
  readiness cross-checks use via `/v1/tools/discover` + `/v1/tools/invoke`
  — a much better fit than the `admin` key this used to default to. For
  anything beyond local dev/demo, register a dedicated role for this app
  in AOM's `operations-manager/app/rbac_policy.py` (that's a change to the
  AOM project, not this one) and point this variable at that role's key
  instead.
- **`COUCHBASE_AOM_ALLOW_INSECURE_TLS`** (default `true`) tells
  `backend/src/services/aomClient.js` to trust AOM's self-signed cert
  for AOM calls specifically — it does not touch Node's global TLS
  validation, so nothing else this app calls over HTTPS is affected. Set
  it to `false` only if AOM is deployed behind a real CA-signed
  certificate.

### Running both stacks together

AOM's `docker-compose.yml` binds host ports **8091-8096** for its own
(separate) Couchbase cluster and **8090** for its API — the same
8091/8093 this app's Couchbase container used to claim. Two containers
can't bind the same host port, so this app's Couchbase ports were
remapped to **9091** (admin console) and **9093** (query service); the
container-internal ports, and all backend↔Couchbase traffic on the
Docker-internal network, are unaffected — see the comments in
`docker-compose.yml`. This app keeps its own Couchbase container for its
own operational data (PRs/POs/suppliers/audit log — unrelated to LLM
caching, which is AOM's Couchbase's job); the two clusters are entirely
separate and don't share data.

To run both:

```bash
# 1. Start AOM first (separate project/checkout)
cd /path/to/couchbase-agent-operations-manager
docker compose up --build

# 2. Then start this app
cd /path/to/couchbase-procurement-command-center
docker compose up --build
```

- This app: <http://localhost:8080>
- This app's Couchbase admin console: <http://localhost:9091> (moved from
  the usual 8091 — see above)
- AOM's dashboard: <https://localhost> (AOM's `ui` service serves HTTPS by
  default on the standard port, so no `:5173` and no `:port` at all — expect
  a browser warning for its self-signed cert)
- AOM's API: <https://localhost:8090> (also HTTPS by default, also
  self-signed — this app's `aomClient.js` trusts that cert specifically,
  see "Configuration" above)

### What's been verified here vs. on the real stack

This sandbox cannot reach the real, running AOM instance directly (it's a
separate isolated environment from your machine, even when working
through your connected folders) — so the request/response wiring above
was verified against a hand-written fake server that mirrors AOM's real
`POST /v1/llm/complete` response shape exactly (read from AOM's own
`operations-manager/app/main.py`), plus a full regression of this app's
Express server (dashboard, purchase-requests list, and copilot chat
routes) against that fake server with `COUCHBASE_DRIVER=memory`. That
confirmed: requests carry the correct `Authorization: Bearer`, `provider:
"google"`, `model`, and namespace; the grounding prompts contain only real
computed facts (verified by inspecting the fake server's request log —
real supplier names, prices, and lead times, never placeholders); the
`rationale`/copilot-reply text is correctly overlaid from the response;
and both the "not configured" and "unreachable" fallback paths correctly
return the original rule-based text unchanged. What that setup *can't*
prove is what your real AOM/Gemini combination actually replies with, or
real-world latency against a live model on a cache miss — please run
`docker compose up --build` on both projects and open a PR's detail panel
to confirm the "Rationale by gemini-2.5-flash via Couchbase Agent
Operations Manager" line appears as expected.

### Demo: simulating 100 buyers to show off AOM's cache hit rate

Settings → Demo (admin-only) has a Start/Stop button that simulates 100
buyers repeatedly asking the copilot's common questions ("My priority",
"Compare suppliers", "Explain oversupply", "PO readiness") across this
app's 18 seeded purchase requests, entirely through the real
`copilot.chat()` → `aomClient.js` → AOM path — nothing about the traffic
itself is faked.

The first design here just drew from a small, fixed pool of distinct
questions (55 combinations) and let repeats accumulate into hits forever
— it worked, but ran on a real AOM appliance climbed to a 99.9% hit rate,
which read as too clean to be a believable live demo. `services/demo.js`
now runs a small closed-loop controller instead: each tick it compares
the trailing 60-second hit rate (as AOM itself reports it, per-call) to a
slowly oscillating target that sweeps between 82% and 96% on a ~2.5-minute
cycle, and adjusts how often it deliberately asks a guaranteed-fresh
question (the same question, reworded with a unique reference number, so
it's a genuine cache miss without changing the underlying facts) to steer
the measured rate toward that target. Left running, the hit rate you'll
see — either in this app's own Settings → Demo panel, which now shows
that trailing 60-second rate plus the current target, or directly on
AOM's own Cache Dashboard (`https://localhost/llm-caching`) — drifts up
and down in that 82-96% band rather than marching toward 100%. Expect a
lower rate for the first 20-30 seconds while the question pool is warming
up (every question is a genuine miss the very first time it's asked).
Verified with a hand-rolled fake AOM server before shipping (see the
Claude Project build notes' Follow-up 13) — over one full oscillation
cycle the trailing rate tracked the 82-96% target band with only a
fraction-of-a-point undershoot at the very bottom of one trough. Stopping
the demo creates nothing that needs cleaning up — it doesn't create new
purchase requests, POs, or buyer-action records, only the same per-PR
decision cache real usage already populates.

## License

All rights reserved. This software is proprietary and confidential to
Couchbase, Inc. - see [LICENSE](./LICENSE). It is not open source: use,
modification, and redistribution are not permitted except under separate
written terms Couchbase, Inc. provides (e.g., an internal-use policy or
a customer evaluation/beta agreement).

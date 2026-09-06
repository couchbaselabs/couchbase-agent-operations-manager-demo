const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const cb = require("./db/couchbase");
const store = require("./services/store");
const { requireAuth, requireAdmin } = require("./middleware/auth");

const authRoutes = require("./routes/auth");
const settingsRoutes = require("./routes/settings");
const dashboardRoutes = require("./routes/dashboard");
const purchaseRequestRoutes = require("./routes/purchaseRequests");
const purchaseOrderRoutes = require("./routes/purchaseOrders");
const supplierRoutes = require("./routes/suppliers");
const supplierCommunicationRoutes = require("./routes/supplierCommunication");
const systemRoutes = require("./routes/systems");
const gamificationRoutes = require("./routes/gamification");
const copilotRoutes = require("./routes/copilot");
const contextHubRoutes = require("./routes/contextHub");
const demoRoutes = require("./routes/demo");
const agentSimulationRoutes = require("./routes/agentSimulation");

const app = express();
const PORT = process.env.PORT || 4000;

// credentials:true + reflecting the request origin (rather than "*") is
// required for the session cookie to actually be sent/accepted -- see
// https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS/Errors/CORSNotSupportingCredentials.
// In the normal docker-compose deployment the browser only ever talks to
// nginx on a single origin (nginx proxies /api/ to this backend, see
// frontend/nginx.conf), so this mainly matters for local `npm start`
// dev setups where frontend and backend run on different ports.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

let ready = false;
let startupError = null;
app.get("/api/health", (req, res) => {
  // Surfacing the last startup error here means `curl localhost:4000/api/health`
  // (or the frontend's own polling) tells you *why* it's stuck instead of an
  // indefinite "starting up" with nothing to go on — see the retry loop below.
  res.json({ ok: true, ready, error: startupError });
});

// Login/session endpoints are the one part of the API reachable while
// logged out (and, for /api/auth/login + /me, even before the Couchbase
// bootstrap below finishes -- resolving "am I logged in" shouldn't have
// to wait on the demo data seed).
app.use("/api/auth", authRoutes);

// Everything else requires a valid session. Settings additionally
// requires the admin role.
app.use("/api/settings", requireAuth, requireAdmin, settingsRoutes);

app.use("/api/dashboard", requireAuth, (req, res, next) => (ready ? next() : res.status(503).json({ error: "starting up" })));
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/purchase-requests", requireAuth, (req, res, next) => (ready ? next() : res.status(503).json({ error: "starting up" })));
app.use("/api/purchase-requests", purchaseRequestRoutes);
app.use("/api/purchase-orders", requireAuth, purchaseOrderRoutes);
app.use("/api/suppliers", requireAuth, supplierRoutes);
app.use("/api/supplier-communication", requireAuth, supplierCommunicationRoutes);
app.use("/api/systems", requireAuth, systemRoutes);
app.use("/api/gamification", requireAuth, gamificationRoutes);
app.use("/api/copilot", requireAuth, copilotRoutes);
app.use("/api/context-hub", requireAuth, contextHubRoutes);

// Settings -> Demo (see services/demo.js). Admin-only, same as the rest
// of Settings -- this drives real traffic through the real copilot/AOM
// path, so it should not be something a non-admin buyer can flip on.
app.use("/api/demo", requireAuth, requireAdmin, demoRoutes);
app.use("/api/agent-simulation", requireAuth, requireAdmin, agentSimulationRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

app.listen(PORT, () => {
  console.log(`[server] Couchbase Procurement Command Center API listening on :${PORT}`);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  // Retry the whole bootstrap a few times before giving up: Couchbase's
  // management port can accept connections slightly before every service
  // it needs is actually ready, and a transient failure there shouldn't be
  // fatal on the first attempt. A *repeatable* failure (e.g. a real bug in
  // the /clusterInit call) will fail the same way each time and exit the
  // process after the last attempt — loudly, via process.exit(1), rather
  // than leaving the container running forever with ready=false and no
  // visible sign anything went wrong.
  // initCluster() already waits up to ~2 minutes just for Couchbase's
  // management port to accept connections, so this outer loop is kept
  // short (3 attempts, 8s apart) -- it's a safety net for a genuinely
  // transient failure in a *later* step (clusterInit racing the query
  // service coming up, etc.), not the primary recovery path. Combined with
  // docker-compose.yml's `restart: on-failure:3` for this service, a
  // repeatable failure surfaces (in the logs, and in /api/health) within
  // a few minutes rather than retrying silently for a long time.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await cb.initCluster();
      await store.seedIfEmpty();
      ready = true;
      startupError = null;
      console.log("[server] ready — Couchbase bootstrap + seed complete.");
      return;
    } catch (err) {
      startupError = err.message || String(err);
      console.error(`[server] startup attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err);
      if (attempt < MAX_ATTEMPTS) {
        console.log("[server] retrying startup in 8s...");
        await sleep(8000);
      }
    }
  }
  console.error(`[server] fatal: could not complete startup after ${MAX_ATTEMPTS} attempts. Exiting.`);
  process.exit(1);
})();

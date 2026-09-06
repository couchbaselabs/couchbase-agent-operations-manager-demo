const cb = require("../db/couchbase");
const seed = require("../data/seed");
const auth = require("./auth");
const cryptoUtil = require("./crypto");

function prKey(id) {
  return `pr::${id}`;
}
function poKey(id) {
  return `po::${id}`;
}
function supplierKey(id) {
  return `supplier::${id}`;
}
function commKey(id) {
  return `comm::${id}`;
}
function actionKey(prId, at) {
  return `buyer_action::${prId}::${at}`;
}
function userKey(id) {
  return `user::${id}`;
}
function sessionKey(id) {
  return `session::${id}`;
}

const DEFAULT_ADMIN_USERNAME = "admin";


function buildSupplierComms() {
  const picks = seed.PURCHASE_REQUESTS.slice(0, 9);
  const templates = [
    (pr) => `RFQ sent to ${pr.currentSupplier.name} to confirm lead time for ${pr.item} (${pr.id}).`,
    (pr) => `Price confirmation requested from recommended supplier for ${pr.item} (${pr.id}).`,
    (pr) => `Follow-up: awaiting remit-to confirmation before PO release for ${pr.id}.`,
  ];
  return picks.map((pr, i) => ({
    id: `COMM-${1000 + i}`,
    prId: pr.id,
    supplier: (pr.candidateSuppliers && pr.candidateSuppliers[0]?.name) || pr.currentSupplier.name,
    subject: `${pr.item} — ${pr.id}`,
    message: templates[i % templates.length](pr),
    status: i % 3 === 0 ? "Awaiting response" : i % 3 === 1 ? "Responded" : "Sent",
    sentAt: pr.needBy,
  }));
}

async function ensureDefaultAdminUser() {
  const existingAdmin = await cb.get(userKey(DEFAULT_ADMIN_USERNAME));
  if (existingAdmin) return;
  console.log(`[store] creating default local admin user "${DEFAULT_ADMIN_USERNAME}" (password must be set at first login)...`);
  await cb.upsert(userKey(DEFAULT_ADMIN_USERNAME), {
    type: "local_user",
    id: DEFAULT_ADMIN_USERNAME,
    username: DEFAULT_ADMIN_USERNAME,
    role: "admin",
    source: "local",
    passwordEncrypted: null,
    mustSetPassword: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}


async function seedIfEmpty() {
  // Auth setup (the default admin account) runs on every boot
  // regardless of whether the demo procurement data below has
  // already been seeded -- a fresh Couchbase volume and a
  // previously-seeded one should both always end up with exactly one
  // default admin user, never zero and never duplicated.
  await ensureDefaultAdminUser();

  const existing = await cb.selectByType("purchase_request").catch(() => []);
  if (existing.length > 0) {
    console.log(`[store] Couchbase already seeded (${existing.length} purchase requests).`);
    return;
  }
  console.log("[store] seeding Couchbase with mock ERP / Snowflake / supplier data...");

  const entries = [];

  for (const s of seed.SUPPLIERS) {
    entries.push({ key: supplierKey(s.id), doc: { type: "supplier", ...s } });
  }
  for (const pr of seed.PURCHASE_REQUESTS) {
    entries.push({
      key: prKey(pr.id),
      doc: { type: "purchase_request", status: "open", ...pr },
    });
  }
  for (const po of seed.BASELINE_PURCHASE_ORDERS) {
    entries.push({ key: poKey(po.id), doc: { type: "purchase_order", ...po } });
  }
  for (const comm of buildSupplierComms()) {
    entries.push({ key: commKey(comm.id), doc: { type: "supplier_communication", ...comm } });
  }
  entries.push({ key: "meta::connected_systems", doc: { type: "connected_systems", items: seed.CONNECTED_SYSTEMS } });
  entries.push({ key: "meta::ai_agents", doc: { type: "ai_agents", items: seed.AI_AGENTS } });
  entries.push({ key: "meta::buyer", doc: { type: "buyer", ...seed.BUYER } });
  entries.push({
    key: "meta::gamification",
    doc: { type: "gamification", ...seed.GAMIFICATION, verifiedSavingsThisWeek: 0, recognitionFeed: seed.GAMIFICATION.recognitionFeed },
  });

  await cb.upsertMany(entries);
  console.log(`[store] seeded ${entries.length} documents.`);
}

async function getPurchaseRequests() {
  return cb.selectByType("purchase_request");
}

async function getPurchaseRequest(id) {
  const doc = await cb.get(prKey(id));
  return doc ? doc.value : null;
}

async function setPurchaseRequestStatus(id, status) {
  const pr = await getPurchaseRequest(id);
  if (!pr) return null;
  const updated = { ...pr, status };
  await cb.upsert(prKey(id), updated);
  return updated;
}

async function getPurchaseOrders() {
  const orders = await cb.selectByType("purchase_order");
  return orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function createPurchaseOrder({ pr, decision, supplierName, unitPrice }) {
  const id = `PO-${Date.now().toString().slice(-6)}`;
  const po = {
    type: "purchase_order",
    id,
    status: "Issued",
    item: pr.item,
    qty: pr.qty,
    uom: pr.uom,
    supplier: supplierName,
    buyingOrg: pr.buyingOrg,
    sourceErp: pr.sourceErp,
    value: Math.round(pr.qty * unitPrice * 100) / 100,
    createdAt: new Date().toISOString().slice(0, 10),
    origin: "agent-assisted",
    prId: pr.id,
    savingsCaptured: decision?.savings || 0,
  };
  await cb.upsert(poKey(id), po);
  await setPurchaseRequestStatus(pr.id, "po_created");
  return po;
}

async function getSuppliers() {
  return cb.selectByType("supplier");
}

async function getSupplierByName(name) {
  const all = await getSuppliers();
  return all.find((s) => s.name === name) || null;
}

async function getSupplierCommunications() {
  return cb.selectByType("supplier_communication");
}

async function getConnectedSystems() {
  const doc = await cb.get("meta::connected_systems");
  return doc ? doc.value.items : [];
}

async function getAiAgents() {
  const doc = await cb.get("meta::ai_agents");
  return doc ? doc.value.items : [];
}

async function getBuyer() {
  const doc = await cb.get("meta::buyer");
  return doc ? doc.value : seed.BUYER;
}

async function getGamificationState() {
  const doc = await cb.get("meta::gamification");
  return doc ? doc.value : { ...seed.GAMIFICATION, verifiedSavingsThisWeek: 0 };
}

async function addVerifiedSavings(amount, note) {
  const state = await getGamificationState();
  const updated = {
    ...state,
    verifiedSavingsThisWeek: Math.round(((state.verifiedSavingsThisWeek || 0) + amount) * 100) / 100,
    recognitionFeed: [
      { id: `REC-${Date.now()}`, text: note, source: "Procurement Command Center", at: "just now" },
      ...(state.recognitionFeed || []).slice(0, 4),
    ],
  };
  await cb.upsert("meta::gamification", { type: "gamification", ...updated });
  return updated;
}

/**
 * Buyer behavior / agent-accuracy audit trail.
 *
 * Tracking has to capture not just what the agent recommends, but how the
 * buyer responds, since agent accuracy runs both ways. This logs every
 * accept AND every reject, keyed by agent/rule/business-unit, so
 * `getAgentAccuracy` below can compute a real accept-rate per agent
 * instead of only ever showing accepted savings.
 */
async function logBuyerAction({ pr, decision, action, reason }) {
  const at = new Date().toISOString();
  const doc = {
    type: "buyer_action",
    prId: pr.id,
    businessUnit: pr.businessUnit || null,
    agent: decision.agent,
    ruleId: decision.ruleId || null,
    recommendation: decision.recommendation,
    action, // "accepted" | "rejected"
    reason: reason || null,
    savings: decision.savings || 0,
    buyerId: seed.BUYER.id,
    at,
  };
  await cb.upsert(actionKey(pr.id, at), doc);
  return doc;
}

async function getAgentAccuracy() {
  const actions = await cb.selectByType("buyer_action").catch(() => []);
  const byAgent = {};
  for (const a of actions) {
    if (!byAgent[a.agent]) byAgent[a.agent] = { agent: a.agent, accepted: 0, rejected: 0 };
    if (a.action === "accepted") byAgent[a.agent].accepted += 1;
    else if (a.action === "rejected") byAgent[a.agent].rejected += 1;
  }
  return Object.values(byAgent).map((row) => {
    const total = row.accepted + row.rejected;
    return {
      ...row,
      total,
      accuracyPct: total > 0 ? Math.round((row.accepted / total) * 100) : null,
    };
  });
}

/**
 * "Hunger Games" — friendly competitions between business units over
 * verified savings, tracking how much each one is using the agents'
 * recommendations. This aggregates verified (accepted) savings per
 * business unit from the same buyer-action log so the leaderboard
 * reflects real activity in this session, not canned numbers.
 */
async function getHungerGamesLeaderboard() {
  const actions = await cb.selectByType("buyer_action").catch(() => []);
  const byUnit = {};
  for (const a of actions) {
    if (a.action !== "accepted" || !a.businessUnit) continue;
    byUnit[a.businessUnit] = (byUnit[a.businessUnit] || 0) + (a.savings || 0);
  }
  return Object.entries(byUnit)
    .map(([businessUnit, savings]) => ({
      businessUnit,
      businessUnitName: (seed.BUSINESS_UNITS.find((b) => b.code === businessUnit) || {}).name || businessUnit,
      verifiedSavings: Math.round(savings * 100) / 100,
    }))
    .sort((a, b) => b.verifiedSavings - a.verifiedSavings);
}


/* ---------------- Local accounts and sessions ---------------- */

function sanitizeUser(doc) {
  if (!doc) return null;
  const { passwordEncrypted, ...safe } = doc;
  return safe;
}

async function getUserByUsername(username) {
  const doc = await cb.get(userKey(username));
  return doc ? doc.value : null;
}

async function listUsers() {
  const users = await cb.selectByType("local_user");
  return users.map(sanitizeUser).sort((a, b) => (a.username < b.username ? -1 : 1));
}

async function createUser({ username, role, password }) {
  const id = username;
  const existing = await getUserByUsername(id);
  if (existing) throw new Error(`User "${username}" already exists.`);
  const now = new Date().toISOString();
  const doc = {
    type: "local_user",
    id,
    username,
    role,
    source: "local",
    passwordEncrypted: password ? auth.hashPassword(password) : null,
    mustSetPassword: !password,
    createdAt: now,
    updatedAt: now,
  };
  await cb.upsert(userKey(id), doc);
  return sanitizeUser(doc);
}

async function updateUserRole(username, role) {
  const doc = await getUserByUsername(username);
  if (!doc) throw new Error(`User "${username}" not found.`);
  const updated = { ...doc, role, updatedAt: new Date().toISOString() };
  await cb.upsert(userKey(username), updated);
  return sanitizeUser(updated);
}

async function setUserPassword(username, newPassword) {
  const doc = await getUserByUsername(username);
  if (!doc) throw new Error(`User "${username}" not found.`);
  const updated = {
    ...doc,
    passwordEncrypted: auth.hashPassword(newPassword),
    mustSetPassword: false,
    updatedAt: new Date().toISOString(),
  };
  await cb.upsert(userKey(username), updated);
  return sanitizeUser(updated);
}


async function deleteUser(username) {
  const doc = await getUserByUsername(username);
  if (!doc) throw new Error(`User "${username}" not found.`);
  if (doc.role === "admin") {
    const all = await listUsers();
    const adminCount = all.filter((u) => u.role === "admin").length;
    if (adminCount <= 1) throw new Error("Cannot delete the last remaining admin account.");
  }
  await cb.remove(userKey(username));
}

async function createSession(sessionDoc) {
  await cb.upsert(sessionKey(sessionDoc.id), sessionDoc);
}

async function getSession(id) {
  const doc = await cb.get(sessionKey(id));
  return doc ? doc.value : null;
}

async function deleteSession(id) {
  await cb.remove(sessionKey(id));
}


module.exports = {
  DEFAULT_ADMIN_USERNAME,
  seedIfEmpty,
  getPurchaseRequests,
  getPurchaseRequest,
  setPurchaseRequestStatus,
  getPurchaseOrders,
  createPurchaseOrder,
  getSuppliers,
  getSupplierByName,
  getSupplierCommunications,
  getConnectedSystems,
  getAiAgents,
  getBuyer,
  getGamificationState,
  addVerifiedSavings,
  logBuyerAction,
  getAgentAccuracy,
  getHungerGamesLeaderboard,
  getUserByUsername,
  listUsers,
  createUser,
  updateUserRole,
  setUserPassword,
  deleteUser,
  createSession,
  getSession,
  deleteSession,
};

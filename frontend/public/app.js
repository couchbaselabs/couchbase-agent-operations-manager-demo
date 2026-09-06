const API = "/api";

const state = {
  view: "dashboard",
  filter: "all",
  selectedPrId: null,
  feed: [],
  user: null,
};

function money(n, opts = {}) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: opts.decimals ?? 0 })}`;
}

/** For every authenticated API call. A 401 means the session died (logout elsewhere, expiry) -- bounce back to the login screen instead of leaving the app rendering stale/broken authenticated views. */
async function api(path, options) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401) {
    showLoginScreen();
    throw new Error("Session expired — please sign in again.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

/** For the login/set-password endpoints specifically -- these return meaningful non-401 JSON bodies (mustSetPassword, validation errors) that the caller needs to inspect rather than have api() turn into a thrown error. */
async function authFetch(path, options) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

/* ---------------- Auth: login / set-password / logout ---------------- */

function showLoginScreen() {
  document.getElementById("app-root").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
}

function showApp() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-root").classList.remove("hidden");
}

function applyRoleVisibility() {
  const isAdmin = state.user && state.user.role === "admin";
  document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", !isAdmin));
}

async function onAuthenticated(user) {
  state.user = user;
  document.getElementById("login-error").classList.add("hidden");
  document.getElementById("set-password-form").classList.add("hidden");
  document.getElementById("login-form").classList.remove("hidden");
  document.getElementById("login-form").reset();
  document.getElementById("session-username").textContent = user.username;
  document.getElementById("session-role").textContent = user.role;
  applyRoleVisibility();
  showApp();
  await loadSidebar();
  await loadDashboard();
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  errEl.classList.add("hidden");
  const { ok, body } = await authFetch("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
  if (ok && body.mustSetPassword) {
    document.getElementById("login-form").classList.add("hidden");
    const setPwForm = document.getElementById("set-password-form");
    setPwForm.classList.remove("hidden");
    setPwForm.dataset.username = body.username;
    document.getElementById("setpw-username").textContent = body.username;
    return;
  }
  if (ok && body.user) {
    await onAuthenticated(body.user);
    return;
  }
  errEl.textContent = body.error || "Sign in failed.";
  errEl.classList.remove("hidden");
});

document.getElementById("set-password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = e.target.dataset.username;
  const newPassword = document.getElementById("setpw-new").value;
  const confirmPassword = document.getElementById("setpw-confirm").value;
  const errEl = document.getElementById("setpw-error");
  errEl.classList.add("hidden");
  if (newPassword !== confirmPassword) {
    errEl.textContent = "Passwords do not match.";
    errEl.classList.remove("hidden");
    return;
  }
  const { ok, body } = await authFetch("/auth/set-password", {
    method: "POST",
    body: JSON.stringify({ username, newPassword }),
  });
  if (ok && body.user) {
    await onAuthenticated(body.user);
    return;
  }
  errEl.textContent = body.error || "Could not set password.";
  errEl.classList.remove("hidden");
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await authFetch("/auth/logout", { method: "POST" });
  location.reload();
});

/* ---------------- Sidebar ---------------- */

async function loadSidebar() {
  try {
    const comms = await api("/supplier-communication");
    document.getElementById("count-comm").textContent = comms.length;
  } catch (err) {
    console.error("Failed to load supplier communication count", err);
  }

  try {
    const { systems, agents } = await api("/systems");
    const list = document.getElementById("connected-systems-list");
    list.innerHTML = systems
      .map((s) => `<li><span class="status-dot"></span>${s.name}</li>`)
      .join("");

    const agentList = document.getElementById("ai-agents-list");
    agentList.innerHTML = agents
      .map((a) => `<li><b>${a.name}</b>${a.description}</li>`)
      .join("");
  } catch (err) {
    console.error("Failed to load systems", err);
  }

  document.getElementById("ai-agents-toggle").addEventListener("click", (e) => {
    document.getElementById("ai-agents-list").classList.toggle("hidden");
    e.target.textContent = e.target.textContent.startsWith("+") ? "- AI Agents" : "+ AI Agents";
  });
}

/* ---------------- Dashboard ---------------- */

async function loadDashboard() {
  const [summary, gami, pos] = await Promise.all([api("/dashboard/summary"), api("/gamification"), api("/purchase-orders")]);
  const pendingPos = pos.filter((p) => p.status !== "Issued").length;

  document.getElementById("page-subtitle").textContent = `${summary.prWaiting} purchasing decisions require your attention today.`;
  document.getElementById("kpi-pr-waiting").textContent = summary.prWaiting;
  document.getElementById("kpi-pr-waiting-sub").textContent = `${summary.highPriorityCount} high priority`;
  document.getElementById("kpi-savings").textContent = `${(summary.savingsIdentified / 1000).toFixed(0)}K`;
  document.getElementById("kpi-oversupply").textContent = summary.oversupplyAlerts;
  document.getElementById("kpi-pos").textContent = summary.posCreatedThisMonth;

  document.getElementById("count-pr").textContent = summary.prWaiting;
  document.getElementById("count-po").textContent = summary.posCreatedThisMonth;
  document.getElementById("count-po-mgmt").textContent = pendingPos;

  renderGamification(gami);
  await loadFeed();
}

function renderGamification(g) {
  document.getElementById("sm-amount").textContent = money(g.verifiedThisWeek);
  document.getElementById("sm-quest-fraction").textContent = `${money(g.verifiedThisWeek)} / ${money(g.weeklyQuestGoal)}`;
  document.getElementById("sm-progress").style.width = `${g.weeklyQuestPct}%`;
  document.getElementById("sm-status").textContent = g.status;
  document.getElementById("sm-streak").textContent = `${g.streakDays}-day streak`;
  document.getElementById("team-label").textContent = `TEAM MOMENTUM — ${g.team}`;
  document.getElementById("team-progress").style.width = `${g.teamProgress}%`;
  document.getElementById("team-caption").textContent = `${money(g.teamRaised)} / ${money(g.teamMonthlyGoal)} monthly team goal`;
  document.getElementById("your-contribution").textContent = money(g.yourContribution);
  document.getElementById("buyer-pill").querySelector(".buyer-name").textContent = g.buyer?.name || "—";
  document.getElementById("buyer-pill").querySelector(".buyer-role").textContent = g.buyer?.role || "—";
  document.getElementById("buyer-pill").querySelector(".avatar").textContent = (g.buyer?.name || "?")
    .split(" ")
    .map((p) => p[0])
    .join("");

  const feed = document.getElementById("recognition-feed");
  feed.innerHTML = (g.recognitionFeed || [])
    .map(
      (r) => `<div class="recognition-item">New recognition — ${r.text}<span class="rec-meta">${r.source} · ${r.at}</span></div>`
    )
    .join("");

  // Agent accuracy runs both ways (accept and reject) — computed
  // server-side from real accept/reject events this session.
  const accuracyList = document.getElementById("agent-accuracy-list");
  const accuracy = g.agentAccuracy || [];
  accuracyList.innerHTML =
    accuracy.length === 0
      ? '<div class="mini-empty">No accept/reject decisions logged yet this session.</div>'
      : accuracy
          .map(
            (a) =>
              `<div class="mini-row"><span>${a.agent}</span><span class="mini-value ${a.accuracyPct >= 80 ? "green" : a.accuracyPct !== null && a.accuracyPct < 50 ? "red" : ""}">${
                a.accuracyPct === null ? "—" : `${a.accuracyPct}%`
              } (${a.accepted}✓ / ${a.rejected}✕)</span></div>`
          )
          .join("");

  // "Hunger Games" — friendly competitions between business units on
  // verified savings/usage. Leaderboard from the same buyer-action log.
  const hgList = document.getElementById("hunger-games-list");
  const hg = g.hungerGames || [];
  hgList.innerHTML =
    hg.length === 0
      ? '<div class="mini-empty">Accept a recommendation to put a business unit on the board.</div>'
      : hg
          .slice(0, 5)
          .map(
            (row, i) =>
              `<div class="mini-row"><span>${i + 1}. ${row.businessUnitName} (${row.businessUnit})</span><span class="mini-value green">${money(row.verifiedSavings)}</span></div>`
          )
          .join("");
}

async function loadFeed() {
  const container = document.getElementById("feed-list");
  container.innerHTML = '<div class="loading">Loading decisions…</div>';
  const rows = await api(`/purchase-requests?filter=${state.filter}`);
  state.feed = rows;
  if (rows.length === 0) {
    container.innerHTML = '<div class="loading">Nothing in this view right now.</div>';
    return;
  }
  container.innerHTML = rows.map(renderFeedRow).join("");
  container.querySelectorAll(".feed-row").forEach((el) => {
    el.addEventListener("click", () => openDetail(el.dataset.id));
  });
}

const ICONS = { buy_now: "▣", dont_buy: "◇", source: "✦", review: "◐" };
const LABELS = { buy_now: "BUY NOW", dont_buy: "DON'T BUY", source: "SOURCE", review: "REVIEW" };

function renderFeedRow(row) {
  const rec = row.recommendation;
  const amountLabel = row.savingsType === "avoid_purchase" ? "in inventory / open PO" : rec === "source" ? "tradeoff" : "vs current supplier";
  const actionLabel = rec === "buy_now" ? "Review" : rec === "dont_buy" ? "View" : rec === "source" ? "Source" : "Review";
  return `
    <div class="feed-row ${row.urgent ? "urgent" : ""}" data-id="${row.id}">
      <div class="row-icon ${rec}">${ICONS[rec] || "•"}</div>
      <div>
        <div>
          ${row.urgent ? '<span class="badge urgent">Urgent</span>' : ""}
          <span class="badge pr">PR</span>
          <span class="badge ${rec}">${LABELS[rec] || rec}</span>
        </div>
        <div class="row-title">${row.id} · ${row.item}</div>
        <div class="row-meta">${row.sourceErp} · ${row.location} · Need by ${row.needBy}</div>
        <div class="row-rationale">◆ ${row.rationale}</div>
        ${row.leadTimeNote ? `<div class="row-risk">! ${row.leadTimeNote} <a href="#">Why am I seeing this?</a></div>` : ""}
      </div>
      <div class="row-amount">
        ${row.savings ? money(row.savings) : "—"}
        <span class="amount-sub">${amountLabel}</span>
        <span class="row-confidence">◆ ${row.confidence} confidence</span>
        ${row.servedFromCache ? `<span class="amount-sub">⚡ cache (${row.latencyMs}ms)</span>` : `<span class="amount-sub">↻ live (${row.latencyMs}ms)</span>`}
      </div>
      <div class="row-action"><button>${actionLabel}</button></div>
    </div>`;
}

document.getElementById("feed-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll("#feed-tabs .tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  state.filter = btn.dataset.filter;
  loadFeed();
});

/* ---------------- Detail drawer ---------------- */

async function openDetail(id) {
  state.selectedPrId = id;
  updateCopilotContext(id);
  const content = document.getElementById("side-panel-detail");
  content.innerHTML = '<div class="loading">Loading…</div>';
  content.classList.remove("hidden");
  // Deliberately NOT hiding #side-panel-default (the copilot widget) here.
  // It used to be hidden the instant a PR's detail card opened, and
  // closeDetail() resets state.selectedPrId to null on the way back out --
  // between the two, there was no way to ever reach the copilot's
  // PR-scoped quick actions ("Compare suppliers" etc.) through the UI at
  // all: the moment a PR was selected, the only panel that could act on
  // that selection was hidden, and the moment you could see the copilot
  // again, the selection was already gone. Found by a user testing the
  // Gemini/AOM copilot narration (Follow-up 7) and unable to locate the
  // quick-action chips. #side-panel-default's parent (.side-panel) is
  // already a flex column with a 16px gap, so simply not hiding it stacks
  // the copilot card cleanly below the detail card with no other CSS
  // changes needed.

  const { pr, decision } = await api(`/purchase-requests/${id}`);
  content.innerHTML = renderDetail(pr, decision);
  wireDetailActions(pr, decision);
}

function renderDetail(pr, decision) {
  let body = "";

  if (decision.recommendation === "buy_now" && decision.recommendedSupplier) {
    body += `
      <p><strong>Buy ${pr.qty} ${pr.uom}</strong> of ${pr.item} from ${decision.recommendedSupplier.name}.</p>
      <div class="compare-card">
        <div class="compare-box">
          <div class="compare-label">Current supplier</div>
          <div>${pr.currentSupplier.name}</div>
          <div class="compare-price">${money(pr.currentSupplier.price, { decimals: 2 })}/${pr.uom}</div>
        </div>
        <div>→</div>
        <div class="compare-box highlight">
          <div class="compare-label">Recommended supplier</div>
          <div>${decision.recommendedSupplier.name}</div>
          <div class="compare-price">${money(decision.recommendedSupplier.price, { decimals: 2 })}/${pr.uom}</div>
        </div>
      </div>
      <div class="impact-banner">Potential impact: Save ${money(decision.savings)}</div>`;
  } else if (decision.recommendation === "dont_buy") {
    body += `
      <p class="badge dont_buy" style="display:inline-block">DON'T BUY</p>
      <p>${decision.buyerBrief}</p>
      <div class="info-grid">
        <div class="info-item"><div class="info-label">Supply available at</div>${decision.supplyAvailableAt}</div>
        <div class="info-item"><div class="info-label">Requirement is for</div>${pr.buyingOrg}</div>
        <div class="info-item"><div class="info-label">Available qty</div>${decision.supplyQty} ${pr.uom}</div>
        <div class="info-item"><div class="info-label">Lead time</div>${decision.leadTimeNote}</div>
      </div>
      <div class="impact-banner avoid">Avoid Save ${money(decision.savings)}</div>`;
  } else if (decision.recommendation === "source") {
    body += `<p>Multiple qualified suppliers found for ${pr.item} — price / lead-time tradeoff.</p>`;
    body += decision.candidates
      .map(
        (c) => `
      <div class="info-item" style="margin-bottom:8px;">
        <div class="info-label">${c.name}</div>
        ${money(c.price, { decimals: 2 })}/${pr.uom} · ${c.leadTimeDays}-day lead time · total ${money(c.totalPrice)}
      </div>`
      )
      .join("");
    body += `<div class="cache-note">${decision.leadTimeNote}</div>`;
  } else {
    body += `<p>${decision.rationale}</p>`;
  }

  body += `<div class="section-title">Agent Activity</div>
    <div class="cache-note">Agent Decision Record — decision evidence · rule · data source · human checkpoint — <strong>Verified</strong></div>`;

  body += `<div class="section-title">Agent checks</div><ul class="check-list">${decision.agentChecks
    .map((c) => `<li>✓ ${c.label}${c.source ? ` (${c.source})` : ""}</li>`)
    .join("")}</ul>`;

  body += `<div id="validation-block"></div>`;

  const canCreatePo = decision.recommendation === "buy_now";
  body += `<div class="drawer-actions">
      <button id="btn-review-later">Review later</button>
      ${canCreatePo ? `<button id="btn-validate" class="accent">Run validation</button><button id="btn-create-po" class="primary">Create PO</button>` : ""}
      ${decision.recommendation === "dont_buy" ? `<button id="btn-accept" class="primary">Accept recommendation</button>` : ""}
      <button id="btn-reject">Reject recommendation</button>
    </div>
    <div class="cache-note">${decision.servedFromCache ? `⚡ Served from Couchbase context cache (${decision.latencyMs}ms)` : `↻ Computed live against source ERP + Snowflake (${decision.latencyMs}ms)`}</div>
    <div class="cache-note">${decision.ruleId ? `Rule ${decision.ruleId} · ${decision.agent}` : decision.agent} · invoked at "${decision.invocationPoint || "buying"}"</div>
    <div class="cache-note">${decision.narratedBy ? `✨ Rationale by ${decision.narratedBy.model || "Gemini"} via Couchbase Agent Operations Manager (${decision.narratedBy.cacheStatus || "n/a"})` : "Rationale from rule-based template (Agent Operations Manager not configured or unreachable)"}</div>`;

  return `<button class="drawer-close" id="drawer-close">← Back</button>
    <h3>${pr.id} · ${pr.item}</h3>
    <p class="subtitle">${pr.sourceErp} · ${pr.buyingOrg}${pr.businessUnit ? ` · BU ${pr.businessUnit}` : ""} · Need by ${pr.needBy}</p>
    ${body}`;
}

function wireDetailActions(pr, decision) {
  document.getElementById("drawer-close").addEventListener("click", closeDetail);

  const reviewLaterBtn = document.getElementById("btn-review-later");
  if (reviewLaterBtn) {
    reviewLaterBtn.addEventListener("click", async () => {
      await api(`/purchase-requests/${pr.id}/review-later`, { method: "POST" });
      closeDetail();
      loadFeed();
    });
  }

  const validateBtn = document.getElementById("btn-validate");
  if (validateBtn) {
    validateBtn.addEventListener("click", async () => {
      const { validation } = await api(`/purchase-requests/${pr.id}/validate`, { method: "POST" });
      const el = document.getElementById("validation-block");
      el.innerHTML = `<div class="section-title">Validation Agent</div><ul class="check-list">${validation.checks
        .map((c) => `<li class="${c.passed ? "" : "fail"}">${c.passed ? "✓" : "✕"} ${c.label}</li>`)
        .join("")}</ul>`;
    });
  }

  const createPoBtn = document.getElementById("btn-create-po");
  if (createPoBtn) {
    createPoBtn.addEventListener("click", async () => {
      createPoBtn.disabled = true;
      createPoBtn.textContent = "Creating…";
      try {
        const result = await api(`/purchase-requests/${pr.id}/create-po`, { method: "POST" });
        alert(`PO ${result.po.id} created for ${money(result.po.value)}.`);
        closeDetail();
        loadDashboard();
      } catch (err) {
        alert(err.message);
        createPoBtn.disabled = false;
        createPoBtn.textContent = "Create PO";
      }
    });
  }

  const acceptBtn = document.getElementById("btn-accept");
  if (acceptBtn) {
    acceptBtn.addEventListener("click", async () => {
      await api(`/purchase-requests/${pr.id}/accept`, { method: "POST" });
      closeDetail();
      loadDashboard();
    });
  }

  const rejectBtn = document.getElementById("btn-reject");
  if (rejectBtn) {
    rejectBtn.addEventListener("click", async () => {
      const reason = prompt("Optional: why are you rejecting this recommendation?") || "";
      await api(`/purchase-requests/${pr.id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      closeDetail();
      loadDashboard();
    });
  }
}

function closeDetail() {
  document.getElementById("side-panel-detail").classList.add("hidden");
  document.getElementById("side-panel-default").classList.remove("hidden");
  state.selectedPrId = null;
  updateCopilotContext(null);
}

/* ---------------- Copilot ---------------- */

function updateCopilotContext(prId) {
  const row = state.feed.find((r) => r.id === prId);
  const ctx = document.getElementById("copilot-context");
  ctx.textContent = row
    ? `Context: ${row.id} · ${row.item} · ${LABELS[row.recommendation] || row.recommendation}`
    : "Context: Command Center · all purchasing decisions";
}

function appendCopilotMessage(text, who = "ai") {
  const wrap = document.getElementById("copilot-messages");
  const div = document.createElement("div");
  div.className = `copilot-msg ${who === "user" ? "user" : ""}`;
  div.textContent = text;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

async function sendCopilot({ message, quickAction }) {
  if (message) appendCopilotMessage(message, "user");
  try {
    const result = await api("/copilot/chat", {
      method: "POST",
      body: JSON.stringify({ prId: state.selectedPrId, message, quickAction }),
    });
    appendCopilotMessage(result.reply, "ai");
  } catch (err) {
    appendCopilotMessage(`Sorry, something went wrong: ${err.message}`, "ai");
  }
}

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => sendCopilot({ quickAction: chip.dataset.action, message: chip.textContent }));
});

document.getElementById("copilot-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("copilot-text");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  sendCopilot({ message: text });
});

/* ---------------- Other views ---------------- */

async function loadPurchaseRequestsView() {
  const rows = await api("/purchase-requests?filter=all");
  const wrap = document.getElementById("pr-table-wrap");
  wrap.innerHTML = `<table class="data-table">
    <thead><tr><th>PR</th><th>Item</th><th>ERP</th><th>Business Unit</th><th>Location</th><th>Need By</th><th>Recommendation</th><th>Savings</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr>
        <td>${r.id}</td><td>${r.item}</td><td>${r.sourceErp}</td><td>${r.businessUnit || "—"}</td><td>${r.location}</td><td>${r.needBy}</td>
        <td><span class="pill ${pillClass(r.recommendation)}">${LABELS[r.recommendation] || r.recommendation}</span></td>
        <td>${r.savings ? money(r.savings) : "—"}</td>
      </tr>`
      )
      .join("")}</tbody></table>`;
}

function pillClass(rec) {
  if (rec === "buy_now") return "green";
  if (rec === "dont_buy") return "orange";
  if (rec === "source") return "purple";
  return "blue";
}

async function loadPoSummaryView() {
  const pos = await api("/purchase-orders");
  const wrap = document.getElementById("po-summary-wrap");
  wrap.innerHTML = `<table class="data-table">
    <thead><tr><th>PO</th><th>Item</th><th>Supplier</th><th>Org</th><th>ERP</th><th>Value</th><th>Status</th></tr></thead>
    <tbody>${pos
      .map(
        (po) => `<tr>
        <td>${po.id}</td><td>${po.item}</td><td>${po.supplier}</td><td>${po.buyingOrg}</td><td>${po.sourceErp}</td>
        <td>${money(po.value)}</td>
        <td><span class="pill ${po.status === "Issued" ? "green" : "orange"}">${po.status}</span></td>
      </tr>`
      )
      .join("")}</tbody></table>`;
}

async function loadPoManagementView() {
  const pos = await api("/purchase-orders");
  const pending = pos.filter((p) => p.status !== "Issued");
  const wrap = document.getElementById("po-management-wrap");
  if (pending.length === 0) {
    wrap.innerHTML = '<p class="subtitle">Nothing pending — every PO has been issued.</p>';
    return;
  }
  wrap.innerHTML = `<table class="data-table">
    <thead><tr><th>PO</th><th>Item</th><th>Supplier</th><th>Org</th><th>Value</th><th>Status</th></tr></thead>
    <tbody>${pending
      .map(
        (po) => `<tr><td>${po.id}</td><td>${po.item}</td><td>${po.supplier}</td><td>${po.buyingOrg}</td><td>${money(po.value)}</td><td><span class="pill orange">${po.status}</span></td></tr>`
      )
      .join("")}</tbody></table>`;
}

async function loadCommunicationView() {
  const comms = await api("/supplier-communication");
  const wrap = document.getElementById("comm-wrap");
  wrap.innerHTML = `<table class="data-table">
    <thead><tr><th>PR</th><th>Supplier</th><th>Subject</th><th>Message</th><th>Status</th></tr></thead>
    <tbody>${comms
      .map(
        (c) => `<tr><td>${c.prId}</td><td>${c.supplier}</td><td>${c.subject}</td><td>${c.message}</td><td><span class="pill blue">${c.status}</span></td></tr>`
      )
      .join("")}</tbody></table>`;
}

async function loadSuppliersView() {
  const suppliers = await api("/suppliers");
  const wrap = document.getElementById("suppliers-wrap");
  wrap.innerHTML = `<table class="data-table">
    <thead><tr><th>Supplier</th><th>Status</th><th>Payment Terms</th><th>Open PRs</th></tr></thead>
    <tbody>${suppliers
      .map(
        (s) => `<tr><td>${s.name}</td><td>${s.status}</td><td>${s.paymentTerms}</td><td>${s.openPrs}</td></tr>`
      )
      .join("")}</tbody></table>`;
}

/* ---------------- AI Architecture (Context Hub / Trust Layer) ---------------- */

async function loadArchitectureView() {
  const data = await api("/context-hub");
  const wrap = document.getElementById("architecture-wrap");

  const layerCards = data.contextHub.layers
    .map(
      (l) => `<div class="layer-card"><div class="layer-num">${l.layer}</div><h4>${l.name}</h4><p>${l.description}</p></div>`
    )
    .join("");

  const pillarRows = data.trustLayer.pillars
    .map((p) => `<div class="pillar-row"><div class="pillar-label">${p.label}</div><div class="pillar-desc">${p.description}</div></div>`)
    .join("");

  const phaseRows = data.aiDataPlaneJourney.phases
    .map(
      (p) => `<div class="phase-row"><div class="phase-num">${p.phase}</div><div class="phase-body"><strong>${p.name}</strong> <span class="pill ${
        p.status === "implemented" ? "green" : p.status === "roadmap" ? "blue" : "orange"
      }">${p.status}</span><p>${p.description}</p></div></div>`
    )
    .join("");

  const ruleRows = data.businessRules
    .map((r) => `<tr><td>${r.id}</td><td>${r.category}</td><td>${r.description}</td></tr>`)
    .join("");

  const buRows = data.businessUnits
    .map((b) => `<tr><td>${b.code}</td><td>${b.name}${b.confirmed ? ' <span class="pill green">confirmed on call</span>' : ""}</td></tr>`)
    .join("");

  const agentRows = data.agents
    .map(
      (a) => `<tr><td>${a.name}</td><td>${(a.invocationPoints || []).join(", ")}</td><td>${(a.ruleIds || []).join(", ")}</td></tr>`
    )
    .join("");

  wrap.innerHTML = `
    <div class="arch-hero">
      <h2>AI Data Plane — adoption journey</h2>
    </div>

    <div class="arch-section">
      <div class="arch-grid">${layerCards}</div>
    </div>

    <div class="arch-section card">
      <h3>${data.trustLayer.name}</h3>
      <p class="subtitle">Cross-cutting governance layer — explainability, observability, buyer-behavior tracking, and IT GRC/EY audit compliance.</p>
      ${pillarRows}
    </div>

    <div class="arch-section card">
      <h3>Phased rollout</h3>
      ${phaseRows}
    </div>

    <div class="arch-grid" style="grid-template-columns: 1fr 1fr;">
      <div class="arch-section card">
        <h3>Agent reuse across the business process</h3>
        <p class="subtitle">Same agent, same logic — invoked at up to three points: planning, requisition, and buying.</p>
        <table class="data-table"><thead><tr><th>Agent</th><th>Invocation points</th><th>Rules</th></tr></thead><tbody>${agentRows}</tbody></table>
      </div>
      <div class="arch-section card">
        <h3>Business rule catalog (sample)</h3>
        <p class="subtitle">${data.businessRules.length} of ~56 planned rules implemented — see README for scope notes.</p>
        <table class="data-table"><thead><tr><th>Rule</th><th>Category</th><th>Description</th></tr></thead><tbody>${ruleRows}</tbody></table>
      </div>
    </div>

    <div class="arch-section card">
      <h3>Business units → ${data.procurementCommandCenterProcess} (LMN project)</h3>
      <p class="subtitle">${data.businessUnits.length} business units, all aligned to 5 shared LMN processes: ${data.lmnProcesses.join(", ")}. Procurement Command Center lives in ${data.procurementCommandCenterProcess}.</p>
      <table class="data-table"><thead><tr><th>Code</th><th>Business unit</th></tr></thead><tbody>${buRows}</tbody></table>
    </div>

    <div class="arch-section card">
      <h3>Agent build-out roadmap</h3>
      <p class="subtitle">${data.agentRoadmap.quote}</p>
      <p>Current PI target: <strong>${data.agentRoadmap.currentProgramIncrement.target} agents</strong> (${data.agentRoadmap.currentProgramIncrement.group}, ${data.agentRoadmap.currentProgramIncrement.quarter}) · End of Q4 2026: <strong>${data.agentRoadmap.endOfQ4_2026}</strong> · End of 2027: <strong>${data.agentRoadmap.endOf2027}</strong></p>
    </div>
  `;
}

/* ---------------- Settings: Users & Roles ---------------- */

const ROLES = ["admin", "buyer", "viewer"];

async function loadSettingsUsersView() {
  const users = await api("/settings/users");
  const wrap = document.getElementById("settings-users-wrap");
  wrap.innerHTML = `<table class="data-table">
    <thead><tr><th>Username</th><th>Role</th><th>Source</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${users
      .map((u) => {
        const isSelf = state.user && u.username === state.user.username;
        return `<tr>
          <td>${u.username}</td>
          <td>
            <select class="role-select" data-username="${u.username}" ${isSelf ? "disabled title=\"You can't change your own role.\"" : ""}>
              ${ROLES.map((r) => `<option value="${r}" ${r === u.role ? "selected" : ""}>${r}</option>`).join("")}
            </select>
          </td>
          <td>${u.source}</td>
          <td>${u.mustSetPassword ? '<span class="pill orange">Must set password</span>' : '<span class="pill green">Active</span>'}</td>
          <td class="table-actions">
            ${u.source === "local" ? `<button data-action="reset" data-username="${u.username}">Reset password</button>` : ""}
            <button data-action="delete" data-username="${u.username}" class="danger" ${isSelf ? "disabled" : ""}>Delete</button>
          </td>
        </tr>`;
      })
      .join("")}</tbody></table>`;

  wrap.querySelectorAll(".role-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try {
        await api(`/settings/users/${encodeURIComponent(sel.dataset.username)}/role`, {
          method: "PUT",
          body: JSON.stringify({ role: sel.value }),
        });
      } catch (err) {
        alert(err.message);
        loadSettingsUsersView();
      }
    });
  });
  wrap.querySelectorAll('[data-action="reset"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const newPassword = prompt(`New password for ${btn.dataset.username} (minimum 8 characters):`);
      if (!newPassword) return;
      try {
        await api(`/settings/users/${encodeURIComponent(btn.dataset.username)}/reset-password`, {
          method: "POST",
          body: JSON.stringify({ newPassword }),
        });
        alert(`Password reset for ${btn.dataset.username}.`);
      } catch (err) {
        alert(err.message);
      }
    });
  });
  wrap.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Delete user ${btn.dataset.username}? This cannot be undone.`)) return;
      try {
        await api(`/settings/users/${encodeURIComponent(btn.dataset.username)}`, { method: "DELETE" });
        loadSettingsUsersView();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

document.getElementById("add-user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("new-user-username").value.trim();
  const role = document.getElementById("new-user-role").value;
  const password = document.getElementById("new-user-password").value;
  const errEl = document.getElementById("settings-users-error");
  errEl.classList.add("hidden");
  try {
    await api("/settings/users", {
      method: "POST",
      body: JSON.stringify({ username, role, password: password || undefined }),
    });
    e.target.reset();
    await loadSettingsUsersView();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
});

/* ---------------- Settings: Demo ---------------- */

let demoPollTimer = null;

function fmtElapsed(ms) {
  if (!ms || ms < 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function renderDemoStatus(status) {
  document.getElementById("demo-start-btn").disabled = !!status.running;
  document.getElementById("demo-stop-btn").disabled = !status.running;

  const notConfiguredEl = document.getElementById("demo-not-configured");
  notConfiguredEl.classList.toggle("hidden", status.aomConfigured !== false);

  const statsEl = document.getElementById("demo-stats");
  const hasRun = status.running || (status.totalRequests || 0) > 0;
  statsEl.classList.toggle("hidden", !hasRun);
  if (!hasRun) return;

  document.getElementById("demo-stat-status").textContent = status.running ? "Running" : "Stopped";

  // The headline number is the trailing 60-second rolling hit rate (what
  // the oscillation controller is actually steering), not the lifetime
  // cumulative rate -- `windowHitRatePct` is null for the first few
  // seconds before any hit/miss has landed in that window, so fall back
  // to the cumulative rate until then.
  const hitrateEl = document.getElementById("demo-stat-hitrate");
  const windowPct = status.windowHitRatePct;
  hitrateEl.textContent = `${windowPct ?? status.hitRatePct ?? 0}%`;
  const oscLow = status.oscLowPct ?? 82;
  const oscHigh = status.oscHighPct ?? 96;
  hitrateEl.classList.toggle("good", windowPct != null && windowPct >= oscLow && windowPct <= oscHigh);

  document.getElementById("demo-stat-target").textContent =
    status.targetPct != null ? `${status.targetPct}% (${oscLow}-${oscHigh}%)` : `${oscLow}-${oscHigh}%`;
  document.getElementById("demo-stat-requests").textContent = (status.totalRequests || 0).toLocaleString();
  document.getElementById("demo-stat-hits").textContent = `${(status.aomHits || 0).toLocaleString()} / ${(status.aomMisses || 0).toLocaleString()}`;
  document.getElementById("demo-stat-warmup").textContent = `${status.warmedCount ?? 0} / ${status.poolSize ?? "–"}`;
  document.getElementById("demo-stat-elapsed").textContent = fmtElapsed(status.elapsedMs);
}

async function pollDemoStatus() {
  try {
    const status = await api("/demo/status");
    renderDemoStatus(status);
    if (!status.running && demoPollTimer) {
      clearInterval(demoPollTimer);
      demoPollTimer = null;
    }
  } catch (err) {
    // Leave the last-rendered state up rather than clearing it on a
    // transient poll failure.
  }
}

async function loadSettingsDemoView() {
  document.getElementById("demo-error").classList.add("hidden");
  await pollDemoStatus();
  const status = await api("/demo/status").catch(() => null);
  if (status && status.running && !demoPollTimer) {
    demoPollTimer = setInterval(pollDemoStatus, 1500);
  }
}

document.getElementById("demo-start-btn").addEventListener("click", async () => {
  const errEl = document.getElementById("demo-error");
  errEl.classList.add("hidden");
  try {
    const status = await api("/demo/start", { method: "POST" });
    renderDemoStatus(status);
    if (!demoPollTimer) demoPollTimer = setInterval(pollDemoStatus, 1500);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
});

document.getElementById("demo-stop-btn").addEventListener("click", async () => {
  const errEl = document.getElementById("demo-error");
  errEl.classList.add("hidden");
  try {
    const status = await api("/demo/stop", { method: "POST" });
    renderDemoStatus(status);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
});

/* ---------------- Settings: Agent Simulation ---------------- */

let simPollTimer = null;

function simOutcomeBadge(r) {
  const badge = document.createElement("span");
  const ok = !!(r && r.ok);
  badge.className = `sim-badge ${ok ? "ok" : "warn"}`;
  badge.textContent = ok ? "ok" : "blocked";
  return badge;
}

function renderAgentSimStatus(status) {
  document.getElementById("sim-start-btn").disabled = !!status.running;
  document.getElementById("sim-stop-btn").disabled = !status.running;

  document.getElementById("sim-not-configured").classList.toggle("hidden", status.aomConfigured !== false);

  const statsEl = document.getElementById("sim-stats");
  const hasRun = status.running || (status.ticks || 0) > 0;
  statsEl.classList.toggle("hidden", !hasRun);
  if (hasRun) {
    document.getElementById("sim-stat-status").textContent = status.running ? "Running" : "Stopped";
    document.getElementById("sim-stat-support-calls").textContent = (status.supportAgentCalls || 0).toLocaleString();
    document.getElementById("sim-stat-admin-calls").textContent = (status.adminAgentCalls || 0).toLocaleString();
    document.getElementById("sim-stat-elapsed").textContent = fmtElapsed(status.elapsedMs);
    document.getElementById("sim-stat-interval").textContent = `${Math.round((status.tickIntervalMs || 60000) / 1000)}s`;
    document.getElementById("sim-stat-errors").textContent = (status.errors || 0).toLocaleString();
  }

  const supportLogEl = document.getElementById("sim-support-log");
  const supportBodyEl = document.getElementById("sim-support-log-body");
  if (status.lastSupportAgent) {
    supportLogEl.classList.remove("hidden");
    supportBodyEl.innerHTML = "";
    const s = status.lastSupportAgent;
    const qaRow = document.createElement("div");
    qaRow.textContent = `${s.prId} (${s.item || "—"}) · ${s.quickAction} · "${s.reply || ""}"`;
    supportBodyEl.appendChild(qaRow);
    if (s.ticketCheck) {
      const ticketRow = document.createElement("div");
      ticketRow.style.marginTop = "4px";
      let detail = "";
      if (s.ticketCheck.ok && s.ticketCheck.hijackWarning) detail = " — hijack finding flagged";
      if (!s.ticketCheck.ok && s.ticketCheck.reason) detail = ` — ${s.ticketCheck.reason}`;
      ticketRow.textContent = `Support ticket search (Zendesk)${detail}`;
      ticketRow.appendChild(simOutcomeBadge(s.ticketCheck));
      supportBodyEl.appendChild(ticketRow);
    }
  }

  const adminLogEl = document.getElementById("sim-admin-log");
  const adminBodyEl = document.getElementById("sim-admin-log-body");
  if (status.lastAdminAgent) {
    adminLogEl.classList.remove("hidden");
    adminBodyEl.innerHTML = "";
    const a = status.lastAdminAgent;
    [
      ["Web search", a.webSearch],
      ["Internal docs search", a.docsSearch],
      ["Jira ticket", a.jira],
    ].forEach(([label, r], i) => {
      const row = document.createElement("div");
      if (i > 0) row.style.marginTop = "4px";
      let detail = "";
      if (r && r.ok) {
        if (r.key) detail = ` — ${r.key}`;
        if (r.hijackWarning) detail += " — hijack finding flagged";
      } else if (r && r.reason) {
        detail = ` — ${r.reason}`;
      }
      row.textContent = `${label}${detail}`;
      row.appendChild(simOutcomeBadge(r));
      adminBodyEl.appendChild(row);
    });
  }
}

async function pollAgentSimStatus() {
  try {
    const status = await api("/agent-simulation/status");
    renderAgentSimStatus(status);
    if (!status.running && simPollTimer) {
      clearInterval(simPollTimer);
      simPollTimer = null;
    }
  } catch (err) {
    // Leave the last-rendered state up rather than clearing it on a
    // transient poll failure.
  }
}

async function loadSettingsAgentSimView() {
  document.getElementById("sim-error").classList.add("hidden");
  await pollAgentSimStatus();
  const status = await api("/agent-simulation/status").catch(() => null);
  if (status && status.running && !simPollTimer) {
    simPollTimer = setInterval(pollAgentSimStatus, 3000);
  }
}

document.getElementById("sim-start-btn").addEventListener("click", async () => {
  const errEl = document.getElementById("sim-error");
  errEl.classList.add("hidden");
  try {
    const status = await api("/agent-simulation/start", { method: "POST" });
    renderAgentSimStatus(status);
    if (!simPollTimer) simPollTimer = setInterval(pollAgentSimStatus, 3000);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
});

document.getElementById("sim-stop-btn").addEventListener("click", async () => {
  const errEl = document.getElementById("sim-error");
  errEl.classList.add("hidden");
  try {
    const status = await api("/agent-simulation/stop", { method: "POST" });
    renderAgentSimStatus(status);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
});

/* ---------------- Navigation ---------------- */

const VIEW_LOADERS = {
  dashboard: loadDashboard,
  "purchase-requests": loadPurchaseRequestsView,
  "po-summary": loadPoSummaryView,
  "po-management": loadPoManagementView,
  "supplier-communication": loadCommunicationView,
  suppliers: loadSuppliersView,
  architecture: loadArchitectureView,
  "settings-users": loadSettingsUsersView,
  "settings-demo": loadSettingsDemoView,
  "settings-agent-sim": loadSettingsAgentSimView,
};

const VIEW_TITLES = {
  dashboard: ["Procurement Command Center", null],
  "purchase-requests": ["Purchase Requests", "All open purchase requests across JDE, Oracle EBS and Omega ERP."],
  "po-summary": ["PO Summary", "Purchase orders issued this month."],
  "po-management": ["PO Management", "Purchase orders awaiting approval or follow-up."],
  "supplier-communication": ["Supplier Communication", "Outbound RFQs and confirmations."],
  suppliers: ["Suppliers", "Supplier master data and eligibility."],
  architecture: ["AI Architecture", "The Context Hub, Trust Layer, and AI Data Plane journey behind these agents."],
  "settings-users": ["Users & Roles", "Manage local accounts and roles for this app."],
  "settings-demo": ["Demo", "Simulate buyer traffic to demonstrate Couchbase Agent Operations Manager cache hits."],
  "settings-agent-sim": ["Agent Simulation", "Role-played support_agent and admin AOM traffic against real copilot and MCP tool paths, every 60 seconds."],
};

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

async function switchView(view) {
  state.view = view;
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById(`view-${view}`).classList.remove("hidden");

  const [title, subtitle] = VIEW_TITLES[view];
  document.getElementById("page-title").textContent = title;
  if (subtitle) document.getElementById("page-subtitle").textContent = subtitle;

  closeDetail();
  await VIEW_LOADERS[view]();
}

/* ---------------- Boot ---------------- */

// Login itself needs Couchbase seeded (the default admin account lives
// there), so this runs against the login screen's own status line before
// auth is checked at all -- not just as a dashboard-loading nicety like
// it was before local login existed.
async function waitForApi() {
  const statusEl = document.getElementById("login-status");
  const submitBtn = document.querySelector("#login-form button[type=submit]");
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`${API}/health`);
      const json = await res.json();
      if (json.ready) {
        statusEl.classList.add("hidden");
        if (submitBtn) submitBtn.disabled = false;
        return;
      }
      // The backend surfaces the last Couchbase bootstrap error here (see
      // server.js) once it's actually failed a startup attempt, instead of
      // this just saying "starting up" forever with no way to tell a slow
      // first boot apart from a stuck one.
      statusEl.textContent = json.error
        ? `Couchbase isn't ready yet (retrying): ${json.error}`
        : "Starting Couchbase and seeding demo data… this can take up to a minute on first boot.";
    } catch (err) {
      statusEl.textContent =
        "Waiting for the backend to come up… (if this doesn't change for a couple of minutes, check `docker compose logs backend`)";
    }
    if (submitBtn) submitBtn.disabled = true;
    statusEl.classList.remove("hidden");
    await new Promise((r) => setTimeout(r, 2000));
  }
  statusEl.textContent =
    "Still not ready after 3 minutes — check `docker compose logs backend` and `docker compose logs couchbase` for the actual error.";
}

(async function boot() {
  await waitForApi();
  let me = { authenticated: false };
  try {
    me = await (await fetch(`${API}/auth/me`)).json();
  } catch (err) {
    // Backend unreachable after waitForApi gave up -- fall through to the
    // login screen, which is already visible and showing that error.
  }
  if (me.authenticated) {
    await onAuthenticated(me.user);
  } else {
    document.getElementById("login-username").focus();
  }
})();

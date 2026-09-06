/**
 * Seed / mock data for the Procurement Command Center.
 *
 * This stands in for the three source ERPs (JDE, Oracle EBS, Omega ERP)
 * and the Snowflake analytics warehouse that the real system would read
 * from. Everything here is fictional demo data modeled after a generic
 * industrial buyer workbench UI — it is not real supplier, pricing, or
 * personnel data from any customer.
 */

const SUPPLIERS = [
  { id: "SUP-ABC", name: "ABC Industrial Supply", status: "Approved / strategic supplier", asl: true, remitTo: true, paymentTerms: "Net 45" },
  { id: "SUP-DELTA", name: "Delta Valve & Supply", status: "Approved supplier", asl: true, remitTo: true, paymentTerms: "Net 30" },
  { id: "SUP-BAKER", name: "Baker Supply", status: "Approved / strategic supplier", asl: true, remitTo: true, paymentTerms: "Net 45" },
  { id: "SUP-GULF", name: "Gulf Coast Oilfield Supply", status: "Approved supplier", asl: true, remitTo: false, paymentTerms: "Net 30" },
  { id: "SUP-PERMIAN", name: "Permian Basin Parts Co.", status: "Approved supplier", asl: true, remitTo: true, paymentTerms: "Net 30" },
  { id: "SUP-APEX", name: "Apex Drilling Supply", status: "Pending ASL review", asl: false, remitTo: false, paymentTerms: "Net 30" },
  { id: "SUP-TXWELL", name: "TX Wellhead Solutions", status: "Approved supplier", asl: true, remitTo: true, paymentTerms: "Net 60" },
  { id: "SUP-SOONER", name: "Sooner Pipe & Supply", status: "Approved / strategic supplier", asl: true, remitTo: true, paymentTerms: "Net 45" },
];

const CONNECTED_SYSTEMS = [
  { id: "jde", name: "JDE", kind: "ERP", status: "connected", description: "Houston & Gulf Coast business unit ERP" },
  { id: "oracle-ebs", name: "Oracle EBS", kind: "ERP", status: "connected", description: "Permian & international business unit ERP" },
  { id: "omega-erp", name: "Omega ERP", kind: "ERP", status: "connected", description: "Midland service center ERP" },
  { id: "snowflake", name: "Snowflake", kind: "Data Warehouse", status: "connected", description: "Historical pricing & spend analytics" },
];

/**
 * Agent metadata. Agents follow a microservice pattern: rather than one
 * agent per business unit, the same agent, with the same logic, can be
 * invoked at different points in a business process — at the planning
 * stage, at purchase requisition, or at the time of buying.
 * `invocationPoints` models that — this demo always calls the agent at the
 * "buying" point (the PR/PO screens shown in the app), but the same pure
 * function in `src/agents/engine.js` is written so a planning- or
 * requisition-stage caller could invoke it identically.
 */
const AI_AGENTS = [
  {
    id: "best-price",
    name: "Best Price Agent",
    description: "Compares the PR's current supplier price against qualified alternatives and historical Snowflake pricing to find a better landed cost.",
    skillLayer: "Layer 5 — Agent skills, tools & business rules",
    invocationPoints: ["planning", "requisition", "buying"],
    ruleIds: ["RULE-BP-01", "RULE-BP-02"],
  },
  {
    id: "oversupply",
    name: "Oversupply Agent",
    description: "Checks inventory and open POs across every org to catch requests that can be filled from existing supply instead of a new purchase.",
    skillLayer: "Layer 5 — Agent skills, tools & business rules",
    invocationPoints: ["planning", "requisition", "buying"],
    ruleIds: ["RULE-OS-01", "RULE-OS-02"],
  },
  {
    id: "sourcing",
    name: "Sourcing Agent",
    description: "Surfaces multiple qualified suppliers when there's a genuine price / lead-time tradeoff for the buyer to decide on.",
    skillLayer: "Layer 5 — Agent skills, tools & business rules",
    invocationPoints: ["requisition", "buying"],
    ruleIds: ["RULE-SA-01"],
  },
  {
    id: "validation",
    name: "Validation Agent",
    description: "Confirms supplier master data, ASL & remit-to status, payment terms, and contract validity before a PO is allowed to go out.",
    skillLayer: "Layer 5 — Agent skills, tools & business rules",
    invocationPoints: ["buying"],
    ruleIds: ["RULE-VA-01", "RULE-VA-02", "RULE-VA-03", "RULE-VA-04"],
  },
];

/**
 * A five-layer "Context Hub" — built the way you'd train a new hire fresh
 * out of college: general skills first, then progressively narrower
 * context. This is documented here (and surfaced in the app's AI
 * Architecture view) because it's the actual context strategy behind the
 * agents above, not something this build invented. A cross-cutting "Trust
 * Layer" (see TRUST_LAYER below) sits alongside it for governance.
 */
const CONTEXT_HUB = {
  name: "Context Hub",
  quote:
    "The Context Hub trains agents step by step, the way you'd onboard a new hire: general skills first, then progressively narrower context.",
  layers: [
    {
      layer: 1,
      name: "General business & supply chain skills",
      description:
        "What is a supply chain, what is a purchase order, general APICS / supply-chain fundamentals — the baseline knowledge before anything customer-specific.",
    },
    {
      layer: 2,
      name: "Oil & gas industry domain knowledge",
      description:
        "Industry terms and concepts: what \"downhole\" means, what \"drilling\" means, and the rest of the oilfield-services vocabulary agents need to parse a request correctly.",
    },
    {
      layer: 3,
      name: "Company knowledge",
      description:
        "Company-specific context: the 18 business units, what products each sells, where locations are, and customer-specific terminology (see BUSINESS_UNITS below).",
    },
    {
      layer: 4,
      name: "Process context — the LMN project",
      description:
        "Instead of teaching agents 18 different business units doing 18 different things, the LMN project aligns all business units to 5 shared business processes: Source to Pay, Demand to Deliver, Order to Cash, Finance, and HR. The Procurement Command Center lives in Source to Pay.",
    },
    {
      layer: 5,
      name: "Agent-specific skills, tools & business rules",
      description:
        "Per-agent long-term/short-term/episodic memory, MCP tool connectors (20+ ERPs plus Snowflake and custom apps), and the business-rule catalog (56 rules total — see BUSINESS_RULES) that actually drives a recommendation.",
    },
  ],
};

/**
 * Cross-cutting governance layer, called out separately from the Context
 * Hub. Four pillars, plus data handling commitments (encryption, memory
 * segregation).
 */
const TRUST_LAYER = {
  name: "Trust Layer",
  pillars: [
    {
      id: "explainability",
      label: "Explainability",
      description:
        "Not a black box — every recommendation has to be explainable and clear to the buyer. Every decision in this app carries a plain-language rationale and an Agent Decision Record checklist.",
    },
    {
      id: "observability",
      label: "Observability",
      description:
        "Logging, tracking and tracing of every agent action — what it recommended, when, and how long it needs to be retained.",
    },
    {
      id: "buyer-behavior",
      label: "Buyer behavior & agent accuracy",
      description:
        "Tracking has to capture not just what the agent recommends, but how the buyer responds — whether they accept or reject it — since agent accuracy runs both ways. Accept and reject are both logged (see the Agent Accuracy panel).",
    },
    {
      id: "it-grc",
      label: "IT GRC / EY audit checklist",
      description:
        "Built jointly with the customer's IT Security and IT GRC groups (with an external auditor asking early questions) — a per-agent checklist covering data residency, retention, and access.",
    },
  ],
  dataHandling: {
    encryptionAtRest: true,
    encryptionInTransit: true,
    memorySegregation:
      "Per-persona episodic memory is stored and access-scoped separately, so one user's search/decision history can't be reached from another's session or query pattern.",
  },
};

/**
 * A representative slice of a larger business-rule catalog: the
 * underlying logic is rule-based and large in scope (roughly 56 rules,
 * consistent across scenarios but varying in applicability). This app
 * implements the rule *shapes* evidenced in the reference app (10 rule
 * instances across the 4 agent categories below) — the full catalog
 * itself is customer engagement work product this build has no
 * visibility into, so it isn't fabricated here.
 */
const BUSINESS_RULES = [
  { id: "RULE-OS-01", agent: "oversupply", category: "Oversupply / transfer", description: "Stock covering the requirement exists at another org — recommend transfer instead of a new purchase." },
  { id: "RULE-OS-02", agent: "oversupply", category: "Oversupply / transfer", description: "An open PO at the destination org already covers the requirement — recommend against duplicating it." },
  { id: "RULE-BP-01", agent: "best-price", category: "Best price", description: "A qualified alternate supplier beats the current price with a contract on file — straight-through eligible." },
  { id: "RULE-BP-02", agent: "best-price", category: "Best price", description: "A qualified alternate supplier beats the current price but requires an expedited lead time — buyer decision required." },
  { id: "RULE-SA-01", agent: "sourcing", category: "Sourcing tradeoff", description: "Two or more qualified suppliers present a genuine price-vs-lead-time tradeoff — present both, let the buyer decide." },
  { id: "RULE-VA-01", agent: "validation", category: "Validation gate", description: "Supplier master, ASL status and remit-to must all be on file before a PO can be created." },
  { id: "RULE-VA-02", agent: "validation", category: "Validation gate", description: "Payment terms must be on file for the supplier." },
  { id: "RULE-VA-03", agent: "validation", category: "Validation gate", description: "If a contract is cited, it must not be expired as of today." },
  { id: "RULE-VA-04", agent: "validation", category: "Validation gate", description: "Buying org / GL coding must be present on the PR." },
  { id: "RULE-DEFAULT", agent: "sourcing", category: "Fallback", description: "No qualified alternative supplier and no covering inventory found — route to manual review." },
];

/**
 * The phased "AI Data Plane" adoption journey: caching is the entry
 * point, not the whole story. This app currently implements Phase 1 only.
 */
const AI_DATA_PLANE_JOURNEY = {
  quote:
    "This is a journey: an initial adoption with caching as a great first use case, followed by consolidating more of that effort into the AI data plane Couchbase provides.",
  phases: [
    {
      phase: 1,
      name: "Context caching (this build)",
      status: "implemented",
      description:
        "Cache non-frequently-changing data and once-daily Snowflake pulls in Couchbase to cut round trips, latency, and LLM/Snowflake credit cost. See Context caching (Couchbase) below.",
    },
    {
      phase: 2,
      name: "Logging, observability & behavioral monitoring",
      status: "implemented",
      description:
        "Buyer accept/reject tracking and per-agent accuracy are implemented (see Agent Accuracy). Full tracing/retention tooling for IT GRC/EY audit is a roadmap item.",
    },
    {
      phase: 3,
      name: "Centralized MCP tools & vector embeddings (RBAC/governance)",
      status: "implemented",
      description:
        "Centralizing MCP tools and vector embeddings in Couchbase brings role-based access control and governance over those tools that agents wouldn't otherwise have. Not built here — this demo's ERP/Snowflake access is mocked, not a real MCP tool layer.",
    },
  ],
};

/**
 * Business-unit roster, modeled on a large industrial enterprise with
 * 500+ manufacturing/repair/service facilities grouped into 18 business
 * units. These are fictional placeholders in the same spirit as the rest
 * of this app's mock supplier and org data, not real business-unit names.
 */
const BUSINESS_UNITS = [
  { code: "DH", name: "Downhole", confirmed: true },
  { code: "WT", name: "Wellbore Technologies" },
  { code: "RT", name: "Rig Technologies" },
  { code: "CPS", name: "Completion & Production Solutions" },
  { code: "DIS", name: "Drilling & Intervention Solutions" },
  { code: "TUB", name: "Tubular Inspection & Services" },
  { code: "TCS", name: "Tank & Cementing Solutions" },
  { code: "MPD", name: "Managed Pressure Drilling" },
  { code: "FLC", name: "Flow Control" },
  { code: "SUB", name: "Subsea Technologies" },
  { code: "ART", name: "Artificial Lift" },
  { code: "INS", name: "Instrumentation & Sensors" },
  { code: "PKG", name: "Packers & Isolation" },
  { code: "CMT", name: "Cementing Products" },
  { code: "WLN", name: "Wireline Services" },
  { code: "FIS", name: "Fishing & Intervention Tools" },
  { code: "RIG", name: "Rig Solutions International" },
  { code: "GLB", name: "Global Field Services" },
];

/** The 5 LMN business processes every business unit is aligned to. */
const LMN_PROCESSES = ["Source to Pay", "Demand to Deliver", "Order to Cash", "Finance", "HR"];
const PROCUREMENT_COMMAND_CENTER_PROCESS = "Source to Pay";

/**
 * Agent build-out roadmap: 8 agents targeted for the current program
 * increment (Q4 2026), 18-19 by end of Q4, ~100 planned by end of 2027 —
 * illustrative context, not a claim about this demo's scope.
 */
const AGENT_ROADMAP = {
  quote: "Roadmap: 18 to 19 agents built by the end of Q4, growing to close to 100 agents in the plan by the end of 2027.",
  currentProgramIncrement: { target: 8, quarter: "Q4 2026", group: "Procure to Pay" },
  endOfQ4_2026: 18,
  endOf2027: 100,
  completionTarget: "Q4 2026 (Procurement Command Center)",
};

/**
 * Purchase requests. `recommendation` starts as "pending" — the actual
 * buy_now / dont_buy / source verdict is computed live by the agent
 * engine (see src/agents) and cached in Couchbase, mirroring the
 * "context caching" pattern the reference app is built around.
 */
const PURCHASE_REQUESTS = [
  {
    id: "PR-100239",
    item: "6-IN Gate Valve",
    qty: 50,
    uom: "EA",
    sourceErp: "JDE",
    location: "Houston, TX",
    buyingOrg: "Houston Plant 01 - Org H01",
    businessUnit: "DH",
    needBy: "2026-07-26",
    leadTimeDays: 12,
    urgent: true,
    currentSupplier: { name: "Delta Valve & Supply", price: 1595 },
    candidateSuppliers: [
      { name: "ABC Industrial Supply", price: 1225, leadTimeDays: 12 },
      { name: "Gulf Coast Oilfield Supply", price: 1340, leadTimeDays: 9 },
    ],
    contract: { number: "PCC-2025-441", expires: "2027-12-31" },
  },
  {
    id: "PR-100255",
    item: "Valve Kit 4-IN",
    qty: 340,
    uom: "EA",
    sourceErp: "Omega ERP",
    location: "Midland, TX",
    buyingOrg: "Midland Plant 08 - Org M08",
    businessUnit: "WT",
    needBy: "2026-08-02",
    leadTimeDays: null,
    urgent: false,
    currentSupplier: { name: "Baker Supply", price: 120.59 },
    candidateSuppliers: [],
    inventoryElsewhere: { org: "Houston Service Center - Org HSC", qty: 340 },
    contract: null,
  },
  {
    id: "PR-100242",
    item: "Drill Pipe Protectors",
    qty: 210,
    uom: "EA",
    sourceErp: "Oracle EBS",
    location: "Odessa, TX",
    buyingOrg: "Odessa Field Yard - Org OFY",
    businessUnit: "RT",
    needBy: "2026-07-29",
    leadTimeDays: 8,
    urgent: true,
    currentSupplier: { name: "Permian Basin Parts Co.", price: 42.1 },
    candidateSuppliers: [{ name: "Baker Supply", price: 39.9, leadTimeDays: 6 }],
    contract: { number: "PCC-2024-118", expires: "2026-11-30" },
  },
  {
    id: "PR-100248",
    item: "Instrument Cable",
    qty: 4000,
    uom: "FT",
    sourceErp: "JDE",
    location: "Houston, TX",
    buyingOrg: "Houston Plant 01 - Org H01",
    businessUnit: "CPS",
    needBy: "2026-07-31",
    leadTimeDays: 10,
    urgent: true,
    currentSupplier: { name: "TX Wellhead Solutions", price: 2.35 },
    candidateSuppliers: [
      { name: "Sooner Pipe & Supply", price: 2.1, leadTimeDays: 10 },
      { name: "Apex Drilling Supply", price: 1.95, leadTimeDays: 18 },
    ],
    contract: null,
  },
  {
    id: "PR-100261",
    item: "Bearing Assembly",
    qty: 60,
    uom: "EA",
    sourceErp: "Oracle EBS",
    location: "Singapore",
    buyingOrg: "Singapore Service Center - Org SG1",
    businessUnit: "DIS",
    needBy: "2026-08-05",
    leadTimeDays: null,
    urgent: false,
    currentSupplier: { name: "Sooner Pipe & Supply", price: 232.0 },
    candidateSuppliers: [],
    openPoElsewhere: { org: "Singapore Service Center - Org SG1", poNumber: "PO-88214", qty: 60 },
    contract: null,
  },
  {
    id: "PR-100266",
    item: "Mud Pump Liner",
    qty: 24,
    uom: "EA",
    sourceErp: "JDE",
    location: "Houston, TX",
    buyingOrg: "Houston Plant 01 - Org H01",
    businessUnit: "TUB",
    needBy: "2026-08-08",
    leadTimeDays: 15,
    urgent: false,
    currentSupplier: { name: "Baker Supply", price: 1840 },
    candidateSuppliers: [{ name: "ABC Industrial Supply", price: 1695, leadTimeDays: 15 }],
    contract: { number: "PCC-2025-302", expires: "2027-03-31" },
  },
  {
    id: "PR-100271",
    item: "BOP Ram Rubber Kit",
    qty: 18,
    uom: "EA",
    sourceErp: "Omega ERP",
    location: "Midland, TX",
    buyingOrg: "Midland Plant 08 - Org M08",
    businessUnit: "TCS",
    needBy: "2026-08-01",
    leadTimeDays: 20,
    urgent: true,
    currentSupplier: { name: "TX Wellhead Solutions", price: 610 },
    candidateSuppliers: [
      { name: "Gulf Coast Oilfield Supply", price: 585, leadTimeDays: 22 },
      { name: "Baker Supply", price: 560, leadTimeDays: 28 },
    ],
    contract: null,
  },
  {
    id: "PR-100274",
    item: "Wireline Cable",
    qty: 12000,
    uom: "FT",
    sourceErp: "Oracle EBS",
    location: "Odessa, TX",
    buyingOrg: "Odessa Field Yard - Org OFY",
    businessUnit: "MPD",
    needBy: "2026-08-12",
    leadTimeDays: null,
    urgent: false,
    currentSupplier: { name: "Sooner Pipe & Supply", price: 3.1 },
    candidateSuppliers: [],
    inventoryElsewhere: { org: "Houston Plant 01 - Org H01", qty: 15500 },
    contract: null,
  },
  {
    id: "PR-100279",
    item: "Rotary Table Bushing",
    qty: 8,
    uom: "EA",
    sourceErp: "JDE",
    location: "Houston, TX",
    buyingOrg: "Houston Plant 01 - Org H01",
    businessUnit: "FLC",
    needBy: "2026-08-14",
    leadTimeDays: 9,
    urgent: false,
    currentSupplier: { name: "Apex Drilling Supply", price: 3120 },
    candidateSuppliers: [{ name: "ABC Industrial Supply", price: 2990, leadTimeDays: 14 }],
    contract: null,
  },
  {
    id: "PR-100283",
    item: "Kelly Valve",
    qty: 6,
    uom: "EA",
    sourceErp: "Omega ERP",
    location: "Midland, TX",
    buyingOrg: "Midland Plant 08 - Org M08",
    businessUnit: "SUB",
    needBy: "2026-08-04",
    leadTimeDays: 11,
    urgent: true,
    currentSupplier: { name: "Baker Supply", price: 4550 },
    candidateSuppliers: [
      { name: "Delta Valve & Supply", price: 4400, leadTimeDays: 11 },
      { name: "TX Wellhead Solutions", price: 4310, leadTimeDays: 16 },
    ],
    contract: { number: "PCC-2026-009", expires: "2028-01-31" },
  },
  {
    id: "PR-100288",
    item: "Choke Manifold Valve",
    qty: 4,
    uom: "EA",
    sourceErp: "Oracle EBS",
    location: "Singapore",
    buyingOrg: "Singapore Service Center - Org SG1",
    businessUnit: "ART",
    needBy: "2026-08-20",
    leadTimeDays: 30,
    urgent: false,
    currentSupplier: { name: "Gulf Coast Oilfield Supply", price: 9800 },
    candidateSuppliers: [{ name: "ABC Industrial Supply", price: 9200, leadTimeDays: 32 }],
    contract: null,
  },
  {
    id: "PR-100292",
    item: "Cement Head Assembly",
    qty: 3,
    uom: "EA",
    sourceErp: "JDE",
    location: "Houston, TX",
    buyingOrg: "Houston Plant 01 - Org H01",
    businessUnit: "INS",
    needBy: "2026-08-06",
    leadTimeDays: null,
    urgent: false,
    currentSupplier: { name: "Baker Supply", price: 12500 },
    candidateSuppliers: [],
    inventoryElsewhere: { org: "Odessa Field Yard - Org OFY", qty: 4 },
    contract: null,
  },
  {
    id: "PR-100296",
    item: "Swivel Packing Set",
    qty: 40,
    uom: "EA",
    sourceErp: "Omega ERP",
    location: "Midland, TX",
    buyingOrg: "Midland Plant 08 - Org M08",
    businessUnit: "PKG",
    needBy: "2026-08-10",
    leadTimeDays: 7,
    urgent: true,
    currentSupplier: { name: "TX Wellhead Solutions", price: 88 },
    candidateSuppliers: [{ name: "Sooner Pipe & Supply", price: 79, leadTimeDays: 7 }],
    contract: { number: "PCC-2025-441", expires: "2027-12-31" },
  },
  {
    id: "PR-100301",
    item: "Top Drive Motor Brush Set",
    qty: 100,
    uom: "EA",
    sourceErp: "JDE",
    location: "Houston, TX",
    buyingOrg: "Houston Plant 01 - Org H01",
    businessUnit: "CMT",
    needBy: "2026-08-15",
    leadTimeDays: 14,
    urgent: false,
    currentSupplier: { name: "ABC Industrial Supply", price: 26.5 },
    candidateSuppliers: [
      { name: "Baker Supply", price: 24.75, leadTimeDays: 14 },
      { name: "Apex Drilling Supply", price: 22.9, leadTimeDays: 24 },
    ],
    contract: null,
  },
  {
    id: "PR-100305",
    item: "Shale Shaker Screen",
    qty: 240,
    uom: "EA",
    sourceErp: "Oracle EBS",
    location: "Odessa, TX",
    buyingOrg: "Odessa Field Yard - Org OFY",
    businessUnit: "WLN",
    needBy: "2026-08-03",
    leadTimeDays: null,
    urgent: false,
    currentSupplier: { name: "Gulf Coast Oilfield Supply", price: 61 },
    candidateSuppliers: [],
    inventoryElsewhere: { org: "Houston Plant 01 - Org H01", qty: 300 },
    contract: null,
  },
  {
    id: "PR-100309",
    item: "Mud Motor Stator",
    qty: 5,
    uom: "EA",
    sourceErp: "Omega ERP",
    location: "Midland, TX",
    buyingOrg: "Midland Plant 08 - Org M08",
    businessUnit: "FIS",
    needBy: "2026-08-18",
    leadTimeDays: 21,
    urgent: false,
    currentSupplier: { name: "Baker Supply", price: 15400 },
    candidateSuppliers: [{ name: "TX Wellhead Solutions", price: 14800, leadTimeDays: 25 }],
    contract: null,
  },
  {
    id: "PR-100312",
    item: "Wellhead Flange 13-5/8in",
    qty: 10,
    uom: "EA",
    sourceErp: "JDE",
    location: "Houston, TX",
    buyingOrg: "Houston Plant 01 - Org H01",
    businessUnit: "RIG",
    needBy: "2026-08-09",
    leadTimeDays: 13,
    urgent: true,
    currentSupplier: { name: "Delta Valve & Supply", price: 3350 },
    candidateSuppliers: [
      { name: "ABC Industrial Supply", price: 3100, leadTimeDays: 13 },
      { name: "Sooner Pipe & Supply", price: 3210, leadTimeDays: 10 },
    ],
    contract: { number: "PCC-2025-441", expires: "2027-12-31" },
  },
  {
    id: "PR-100316",
    item: "Rig Floor Safety Harness",
    qty: 30,
    uom: "EA",
    sourceErp: "Oracle EBS",
    location: "Singapore",
    buyingOrg: "Singapore Service Center - Org SG1",
    businessUnit: "GLB",
    needBy: "2026-08-22",
    leadTimeDays: null,
    urgent: false,
    currentSupplier: { name: "Apex Drilling Supply", price: 145 },
    candidateSuppliers: [],
    inventoryElsewhere: { org: "Odessa Field Yard - Org OFY", qty: 45 },
    contract: null,
  },
];

const BUYER = {
  id: "USR-MK",
  name: "Maya Kumar",
  role: "Buyer",
  team: "Houston Procurement",
};

const GAMIFICATION = {
  weeklyQuestGoal: 50000,
  teamMonthlyGoal: 250000,
  team: "Houston Procurement",
  recognitionFeed: [
    {
      id: "REC-1",
      text: "PR-100255 added $41K of verified savings. Strong buyer decision.",
      source: "Procurement Command Center",
      at: "just now",
    },
  ],
};

/**
 * Baseline "already issued" purchase orders so PO Summary / PO Management
 * and the "POs Created this month" KPI have something realistic to show
 * on first load. POs created through the live PR -> PO flow are appended
 * on top of these at runtime.
 */
function buildBaselinePurchaseOrders(count = 42) {
  const items = [
    "Gate Valve", "Drill Collar", "Mud Pump Liner", "Wireline Cable", "Kelly Valve",
    "Bearing Assembly", "BOP Ram Rubber Kit", "Shale Shaker Screen", "Wellhead Flange",
    "Rotary Table Bushing", "Cement Head Assembly", "Choke Manifold Valve", "Swivel Packing Set",
  ];
  const orgs = [
    { org: "Houston Plant 01 - Org H01", erp: "JDE" },
    { org: "Odessa Field Yard - Org OFY", erp: "Oracle EBS" },
    { org: "Midland Plant 08 - Org M08", erp: "Omega ERP" },
    { org: "Singapore Service Center - Org SG1", erp: "Oracle EBS" },
  ];
  const orders = [];
  for (let i = 0; i < count; i++) {
    const supplier = SUPPLIERS[i % SUPPLIERS.length];
    const orgInfo = orgs[i % orgs.length];
    const item = items[i % items.length];
    const qty = 5 + ((i * 7) % 90);
    const unitPrice = 40 + ((i * 53) % 900);
    orders.push({
      id: `PO-882${String(10 + i).padStart(2, "0")}`,
      status: i % 11 === 0 ? "Pending approval" : "Issued",
      item,
      qty,
      uom: "EA",
      supplier: supplier.name,
      buyingOrg: orgInfo.org,
      sourceErp: orgInfo.erp,
      value: Math.round(qty * unitPrice * 100) / 100,
      createdAt: `2026-0${6 + (i % 3)}-${String(1 + (i % 27)).padStart(2, "0")}`,
      origin: "baseline",
    });
  }
  return orders;
}

const BASELINE_PURCHASE_ORDERS = buildBaselinePurchaseOrders(42);

module.exports = {
  SUPPLIERS,
  CONNECTED_SYSTEMS,
  AI_AGENTS,
  PURCHASE_REQUESTS,
  BASELINE_PURCHASE_ORDERS,
  BUYER,
  GAMIFICATION,
  CONTEXT_HUB,
  TRUST_LAYER,
  BUSINESS_RULES,
  AI_DATA_PLANE_JOURNEY,
  BUSINESS_UNITS,
  LMN_PROCESSES,
  PROCUREMENT_COMMAND_CENTER_PROCESS,
  AGENT_ROADMAP,
};

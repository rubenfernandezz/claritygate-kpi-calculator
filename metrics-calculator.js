/* ClarityGate — Metrics Calculator
   Vanilla JS · single source of truth · localStorage persistence.

   Sections (top → bottom):
     1.  Constants + tooltip dictionary
     2.  Defaults + state
     3.  Path / formatting / helpers
     4.  Calculation engine (pure)
     5.  Linked-input handlers (monthly↔annual, show-up↔no-show, churn↔retention)
     6.  Renderers (KPI strip, main planner, sidebar, funnel viz, scenarios, reality check, experiments, metric guide)
     7.  Scenarios (CRUD)
     8.  Experiments (CRUD lab notebook)
     9.  Solver (3 reverse modes)
     10. Tabs, modal, tooltip popover
     11. Persistence (save / load / import / export)
     12. Init
*/

// ============================================================
// 1. Constants + tooltips
// ============================================================
const STORAGE_KEY = 'claritygate.kpiCalculator.portfolio.v4';
const CURRENCY = '£';
const SCHEMA_VERSION = 4;
const WEEKS_PER_MONTH = 52 / 12;   // ≈ 4.333 — converts a monthly rate to a true weekly one

const TOOLTIPS = {
  // tabs
  'tab-planner':     { title: 'Planner',     body: 'The default mode: revenue target → required sales activity. Move sliders to see how upstream activity has to change.' },
  'tab-solver':      { title: 'Solver',      body: 'Reverse-engineer the other direction: given a constraint (e.g. only X dials/day), what does the missing KPI need to be?' },
  'tab-experiments': { title: 'Experiments', body: 'Lab notebook for KPI experiments. Track hypothesis → variable → constants → sample size → result → decision. One variable at a time.' },

  // top bar actions
  'action-import':      { title: 'Import JSON', body: 'Load a previously-exported JSON file. Deep-merges into defaults so partial files still work.' },
  'action-export-json': { title: 'Export JSON', body: 'Download full state + derived outputs. Re-importable.' },
  'action-export-csv':  { title: 'Export CSV',  body: 'Flat key/value CSV for Excel/Sheets. Not re-importable.' },
  'action-reset':       { title: 'Reset',       body: 'Restore every input to its starting value and clear saved state. Confirmation required.' },
  'save-status':        { title: 'Save status', body: 'Auto-save runs ~400ms after your last edit. Green = saved to this browser. Amber = pending.' },
  'save-scenario':      { title: 'Save to scenario', body: 'Write the current funnel rates back to the active scenario. Use this after tweaking, to commit your changes.' },

  // modes
  'mode-A': { title: 'Mode A — New revenue / month', body: 'Every £ comes from new wins this month. No repeat orders. Default for un-validated offers.' },
  'mode-B': { title: 'Mode B — Repeat orders',       body: 'Revenue per client = AOV × avg repeat orders + setup fee. Reduces required new clients proportionally.' },
  'mode-C': { title: 'Mode C — Retainer / MRR',      body: 'Recurring model. Monthly acquisitions = client gap ÷ ramp months + target clients × monthly churn.' },

  // revenue
  targetMonthly:   { title: 'Target monthly revenue', body: 'The number you want at steady state. Everything back-calculates from this. Linked to annual.', formula: 'gap = target − current' },
  targetAnnual:    { title: 'Target annual revenue',  body: 'Auto-linked to monthly × 12. Edit either field — the other follows.', formula: 'annual = monthly × 12' },
  timeframeMonths: { title: 'Timeframe to goal',      body: 'Months until you expect to be at target run-rate.' },
  currentMonthly:  { title: 'Current monthly revenue',body: 'Your actual monthly revenue now. Gap = target − this.' },

  // offer
  aov:             { title: 'AOV (average order/project value)', body: 'Your single biggest lever. Doubling AOV halves required dial volume. Validate with prospects ASAP.', formula: 'clients = gap ÷ (AOV + setup fee)' },
  avgRepeatOrders: { title: 'Repeat orders / client', body: '1 = no repeats. 2 = each client buys twice on average over the goal timeframe.', tag: 'Mode B only' },
  setupFee:        { title: 'One-off setup fee',       body: 'Upfront fee on top of AOV / MRR.' },
  mrrPerClient:    { title: 'MRR per client',          body: 'Average monthly fee per active retainer client.', tag: 'Mode C only' },
  monthlyChurn:    { title: 'Monthly churn rate',      body: 'Percentage of active clients lost per month. You must replace these on top of growth. Linked to retention months.', tag: 'Mode C only' },
  retentionMonths: { title: 'Expected retention',      body: 'Average months a client stays active. Linked to churn (retention ≈ 1 ÷ monthly_churn).', tag: 'Mode C only' },

  // activity & capacity
  workingDays:       { title: 'Working days / month',    body: 'How many days you actually do outbound. Use your own schedule, allowing for days spent on other work.' },
  callsPerHour:      { title: 'Dials per productive hour', body: 'Use measured dials per productive calling hour, excluding breaks and other work. Changing this rescales max dials/day (= this × max hours/day).', formula: 'max dials/day = dials/hour × max hours/day' },
  safetyMultiplier:  { title: 'Safety multiplier',       body: 'Pads activity above the bare minimum. Choose a margin explicitly; this is a planning assumption.' },
  capMaxDials:       { title: 'Max sustainable dials / day', body: 'Your honest daily ceiling. Linked to max hours/day via dials-per-hour — editing it adjusts max hours to stay consistent.', formula: 'max dials/day = dials/hour × max hours/day' },
  capMaxHours:       { title: 'Max productive hours / day',  body: 'Your chosen productive calling time limit. Linked to max dials/day via dials-per-hour.', formula: 'max dials/day = dials/hour × max hours/day' },

  // solver
  'solve-aov':    { title: 'Solve for AOV',    body: 'Given your gatekeeper funnel and dial capacity, what does each client need to be worth to hit your revenue target?' },
  'solve-maxRev': { title: 'Solve for ceiling',body: 'Given the hours/day you can commit and your gatekeeper funnel, what is the maximum realistic monthly revenue?' },
  'solve-gk':     { title: 'Solve a gatekeeper rate', body: 'Given a dial budget and a revenue target, what does ONE rate in the gatekeeper funnel need to be — holding the other seven at their § 4 values?' },
  gkSolveFor:     { title: 'Rate to solve for', body: 'Pick which of the 8 gatekeeper rates is the unknown. The other seven are read from the Cold-Call Funnel card (§ 4) in the Planner.' },
  solveTarget:    { title: 'Target monthly revenue', body: 'The revenue you want to hit. Used as the goal in AOV and gatekeeper modes.' },
  solveAov:       { title: 'AOV assumption', body: 'The price per client you plan to charge.' },
  solveDaily:     { title: 'Daily dial capacity', body: 'How many dials per day you are willing/able to do.' },
  solveHours:     { title: 'Productive hours / day', body: 'How many actual call-hours you can commit per day (not total clock hours).' },

  // detailed gatekeeper funnel
  'df-direction':  { title: 'Calculation direction', body: 'Reverse: start from the clients your revenue goal needs and work UP to required dials. Forward: start from a dial volume and work DOWN to clients + revenue.' },
  dForwardDials:   { title: 'Dials / month (forward)', body: 'Total dials you plan to make per month. The funnel multiplies down from here to projected clients and revenue.', tag: 'Forward only' },
  dPur:  { title: 'PUR — Pick-up rate', body: 'Of dials made, how many are answered by a human. The top of the gatekeeper funnel.', formula: 'pick-ups = dials × PUR' },
  dGr:   { title: 'GR — Gatekeeper rate', body: 'Of pick-ups, the share that land on a gatekeeper rather than a stakeholder directly. The remaining (1 − GR) reach a stakeholder straight away.', formula: 'gatekeeper interactions = pick-ups × GR' },
  dGbr:  { title: 'GBR — Gatekeeper bypass rate', body: 'Of gatekeeper interactions, how many you get past to a stakeholder. Feeds the gatekeeper branch back into total stakeholders.', formula: 'via gatekeeper = pick-ups × GR × GBR' },
  dQr:   { title: 'QR — Qualification rate', body: 'Of stakeholders reached, how many are genuinely qualified (right firm, need, budget, authority).', formula: 'qualified = stakeholders × QR' },
  dAbr:  { title: 'ABR — Appointment booking rate', body: 'Of qualified stakeholders, how many agree to a booked appointment. NOTE: here ABR is measured vs QUALIFIED stakeholders, not vs total dials.', formula: 'appointments = qualified × ABR' },
  dSur:  { title: 'SUR — Show-up rate', body: 'Of booked appointments, how many actually attend the sales call.', formula: 'sales calls = appointments × SUR' },
  dGfr:  { title: 'GFR — Gone-forward / pitch rate', body: 'Of attended sales calls, how many advance to a real pitch / proposal.', formula: 'pitches = sales calls × GFR' },
  dScr:  { title: 'SCR — Sale close rate', body: 'Of pitches delivered, how many become paying clients.', formula: 'clients = pitches × SCR' },
};

// ============================================================
// 2. Defaults + state
// ============================================================
const DEFAULTS = {
  schemaVersion: SCHEMA_VERSION,
  activeTab: 'planner',
  goalMode: 'A',
  activeScenarioId: 'realistic',

  revenue: { targetMonthly: 10000, targetAnnual: 120000, timeframeMonths: 12, currentMonthly: 0 },

  offer: { aov: 2000, avgRepeatOrders: 1, mrrPerClient: 0, setupFee: 0, retentionMonths: 12, monthlyChurn: 0 },

  // The single source-of-truth funnel: the 8-stage cold-call gatekeeper-branch
  // model. Drives the top bar, daily plan, diagram, scenarios and solver.
  // Headline figures always solve REVERSE from the revenue target's clients;
  // the direction toggle affects only the §4 projection panel + §5 diagram.
  funnel: {
    direction: 'reverse',   // 'reverse' (from target clients) | 'forward' (from dials)
    forwardDials: 1500,     // total dials/month, used in forward direction
    pur: 30,  // pick-up rate            (dials → pick-ups)
    gr:  50,  // gatekeeper rate         (pick-ups → gatekeeper interactions)
    gbr: 40,  // gatekeeper bypass rate  (gatekeeper interactions → stakeholders)
    qr:  25,  // qualification rate      (stakeholders → qualified)
    abr: 50,  // appointment booking     (qualified → appointments)
    sur: 80,  // show-up rate            (appointments → sales calls)
    gfr: 50,  // gone-forward/pitch rate (sales calls → pitches)
    scr: 20,  // sale close rate         (pitches → clients)
  },

  activity: { workingDays: 22, callsPerHour: 15, safetyMultiplier: 1.0 },

  capacity: { maxDialsPerDay: 60, maxHoursPerDay: 4 },

  scenarios: [
    { id: 'conservative', name: 'Conservative', type: 'conservative', description: '', pur: 22, gr: 65, gbr: 28, qr: 18, abr: 35, sur: 65, gfr: 38, scr: 12 },
    { id: 'realistic',    name: 'Realistic',    type: 'realistic',    description: '', pur: 30, gr: 50, gbr: 40, qr: 25, abr: 50, sur: 80, gfr: 50, scr: 20 },
    { id: 'bestCase',     name: 'Best case',    type: 'bestCase',     description: '', pur: 42, gr: 38, gbr: 55, qr: 35, abr: 65, sur: 90, gfr: 65, scr: 30 },
  ],

  experiments: [],

  solver: {
    mode: 'aov',
    target: 10000, aov: 2000,
    // dailyDials = hoursPerDay × callsPerHour (kept consistent via LINKED).
    dailyDials: 60, hoursPerDay: 4, callsPerHour: 15, workingDays: 22,
    gkSolveFor: 'scr',   // which gatekeeper rate to solve for in the 'gk' mode
  },
};

// The 8 gatekeeper rate keys that define a funnel / scenario.
const GK_RATES = ['pur', 'gr', 'gbr', 'qr', 'abr', 'sur', 'gfr', 'scr'];

function clone(o) { return JSON.parse(JSON.stringify(o)); }
let state = clone(DEFAULTS);

// ============================================================
// 3. Helpers
// ============================================================
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  const target = parts.reduce((o, k) => o[k], obj);
  target[last] = value;
}
const fmtMoney = n => isFinite(n) ? CURRENCY + Math.round(n).toLocaleString('en-GB') : '—';
const fmtMoneyDp = (n, dp = 2) => isFinite(n) ? CURRENCY + n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '—';
const fmtInt = n => isFinite(n) ? Math.ceil(n).toLocaleString('en-GB') : '—';
const fmtNum = (n, dp = 1) => isFinite(n) ? n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '—';
const fmtPct = (frac, dp = 1) => isFinite(frac) ? (frac * 100).toFixed(dp) + '%' : '—';
const r = pct => pct / 100;
function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function genId(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ============================================================
// 4. Calculation engine (pure)
// ============================================================
const calc = {
  clientsPerMonth(s) {
    const { goalMode, revenue, offer } = s;
    const gap = Math.max(0, revenue.targetMonthly - revenue.currentMonthly);
    if (goalMode === 'C') {
      if (offer.mrrPerClient <= 0) return { clients: gap > 0 ? Infinity : 0, gap };
      // Existing clients (currentMonthly) reduce the acquisition ramp, the same
      // way the gap (target − current) reduces it in Modes A/B. Churn is replaced
      // against the steady-state target base.
      const targetActive  = revenue.targetMonthly  / offer.mrrPerClient;
      const currentActive = revenue.currentMonthly  / offer.mrrPerClient;
      const replacements = targetActive * r(offer.monthlyChurn);
      const ramp = Math.max(0, targetActive - currentActive) / Math.max(1, revenue.timeframeMonths);
      return { clients: ramp + replacements, gap, active: targetActive, replacements };
    }
    const repeats = goalMode === 'B' ? Math.max(1, offer.avgRepeatOrders) : 1;
    const revenuePerClient = offer.aov * repeats + offer.setupFee;
    const clients = revenuePerClient > 0 ? gap / revenuePerClient : (gap > 0 ? Infinity : 0);
    return { clients, gap };
  },

  activity(dialsSafe, { workingDays, callsPerHour }) {
    const daily   = workingDays  > 0 ? dialsSafe / workingDays : Infinity;
    // Weekly is the true monthly rate spread over the calendar weeks in a month
    // (52/12 ≈ 4.333), so weekly × WEEKS_PER_MONTH always reconciles with monthly
    // regardless of working-days/month. (Previously hardcoded daily × 5, which
    // assumed a fixed 5-day week independent of workingDays.)
    const monthly = dialsSafe;
    const weekly  = isFinite(monthly) ? monthly / WEEKS_PER_MONTH : Infinity;
    const hours   = callsPerHour > 0 ? daily / callsPerHour : Infinity;
    return { daily, weekly, monthly, hours };
  },

  revenuePer(rev, { dialsSafe, booked, attended }) {
    // Divide-by-zero (and divide-by-Infinity, which happens when a funnel rate
    // is 0 and dials blow up) returns Infinity → fmt shows "—", matching every
    // other guarded division. (Previously returned 0 → misleading "£0.00".)
    const div = (n, d) => (d > 0 && isFinite(d) && isFinite(n)) ? n / d : Infinity;
    return {
      perDial:     div(rev, dialsSafe),
      perBooked:   div(rev, booked),
      perAttended: div(rev, attended),
    };
  },
};

// ----- Detailed gatekeeper-branch funnel (pure) -----
// Stakeholder reach factor per pick-up:
//   Stakeholders = Pick-ups × [(1 − GR) + (GR × GBR)]
//   · direct      = Pick-ups × (1 − GR)
//   · via gatekeeper = (Pick-ups × GR) × GBR
function gkFactor(rates) {
  const gr = r(rates.gr), gbr = r(rates.gbr);
  return (1 - gr) + (gr * gbr);
}
// Build the gatekeeper branch volumes from a known pick-ups figure.
function gkBranch(pickups, rates) {
  const gr = r(rates.gr), gbr = r(rates.gbr);
  const gkInteractions = pickups * gr;          // pick-ups that hit a gatekeeper
  const directStake    = pickups * (1 - gr);    // pick-ups straight to a stakeholder
  const viaGatekeeper  = gkInteractions * gbr;  // gatekeeper interactions bypassed
  return { gkInteractions, directStake, viaGatekeeper, stakeholders: directStake + viaGatekeeper };
}
// Clients won per dial through the whole gatekeeper chain (forward composite).
function gkComposite(rates) {
  return r(rates.pur) * gkFactor(rates) * r(rates.qr) * r(rates.abr)
       * r(rates.sur) * r(rates.gfr) * r(rates.scr);
}

const calcDetailed = {
  // FORWARD: dials → clients (multiply down the chain)
  forward(dials, rates) {
    const pur = r(rates.pur), qr = r(rates.qr), abr = r(rates.abr),
          sur = r(rates.sur), gfr = r(rates.gfr), scr = r(rates.scr);
    const pickups      = dials * pur;
    const branch       = gkBranch(pickups, rates);
    const stakeholders = branch.stakeholders;
    const qualified    = stakeholders * qr;
    const appointments = qualified * abr;
    const salesCalls   = appointments * sur;
    const pitches      = salesCalls * gfr;
    const clients      = pitches * scr;
    return { dials, pickups, ...branch, stakeholders, qualified, appointments, salesCalls, pitches, clients };
  },

  // REVERSE: clients → dials (divide up the chain).
  // Gatekeeper step: Pick-ups = Total stakeholders ÷ [(1 − GR) + (GR × GBR)]
  reverse(clients, rates) {
    if (clients === 0) return calcDetailed.forward(0, rates);
    const pur = r(rates.pur), qr = r(rates.qr), abr = r(rates.abr),
          sur = r(rates.sur), gfr = r(rates.gfr), scr = r(rates.scr);
    const gk = gkFactor(rates);
    const div = (n, d) => (d > 0 && isFinite(n)) ? n / d : Infinity;
    const pitches      = div(clients, scr);
    const salesCalls   = div(pitches, gfr);
    const appointments = div(salesCalls, sur);
    const qualified    = div(appointments, abr);
    const stakeholders = div(qualified, qr);
    const pickups      = div(stakeholders, gk);
    const dials        = div(pickups, pur);
    // Branch volumes (forward-derived from the solved pick-ups, for the diagram)
    const branch = isFinite(pickups) ? gkBranch(pickups, rates)
                 : { gkInteractions: Infinity, directStake: Infinity, viaGatekeeper: Infinity, stakeholders };
    return { dials, pickups, gkInteractions: branch.gkInteractions, directStake: branch.directStake,
             viaGatekeeper: branch.viaGatekeeper, stakeholders, qualified, appointments,
             salesCalls, pitches, clients };
  },
};

function computeSummary(useState = state) {
  const cpm = calc.clientsPerMonth(useState);
  const df  = useState.funnel;
  const safety = useState.activity.safetyMultiplier;

  // HEADLINE: always solve the gatekeeper funnel REVERSE from the clients the
  // revenue goal requires. This drives the top bar, daily plan and rev/dial.
  const rev = calcDetailed.reverse(cpm.clients, df);
  const dialsSafe = isFinite(rev.dials) ? rev.dials * safety : Infinity;
  const f = {
    dials: rev.dials, dialsSafe,
    booked: rev.appointments, attended: rev.salesCalls,
    pitches: rev.pitches, qualified: rev.qualified,
    stakeholders: rev.stakeholders, pickups: rev.pickups,
  };
  const a   = calc.activity(dialsSafe, useState.activity);
  const gap = Math.max(0, useState.revenue.targetMonthly - useState.revenue.currentMonthly);
  const rp  = calc.revenuePer(gap, { dialsSafe, booked: f.booked, attended: f.attended });

  // DIAGRAM + §4 PROJECTION: direction-dependent. Forward projects from a dial
  // budget; reverse mirrors the headline. The direction toggle changes only
  // this `det` view, never the headline above.
  const det = df.direction === 'forward'
    ? calcDetailed.forward(df.forwardDials, df)
    : rev;
  det.direction = df.direction;
  const effectiveAov = useState.goalMode === 'C' ? useState.offer.mrrPerClient
    : useState.offer.aov * (useState.goalMode === 'B' ? Math.max(1, useState.offer.avgRepeatOrders) : 1) + useState.offer.setupFee;
  det.projectedRevenue = isFinite(det.clients) ? det.clients * effectiveAov : Infinity;

  return { cpm, f, a, gap, rp, det };
}

// ============================================================
// 5. Linked-input handlers
// ============================================================
const LINKED = {
  // [pathA, pathB, fn(valueA) → valueB, fn(valueB) → valueA]
  'revenue.targetMonthly': { partner: 'revenue.targetAnnual',  toPartner: v => v * 12 },
  'revenue.targetAnnual':  { partner: 'revenue.targetMonthly', toPartner: v => v / 12 },
  // Capacity caps are bound by throughput: max dials/day = dials/hour × max hours/day.
  // Edit hours or throughput → dials follows. Edit dials → hours follows.
  'capacity.maxHoursPerDay': { partner: 'capacity.maxDialsPerDay', toPartner: v => Math.round(v * state.activity.callsPerHour) },
  'capacity.maxDialsPerDay': { partner: 'capacity.maxHoursPerDay', toPartner: v => state.activity.callsPerHour > 0 ? Math.round((v / state.activity.callsPerHour) * 100) / 100 : state.capacity.maxHoursPerDay },
  'activity.callsPerHour':   { partner: 'capacity.maxDialsPerDay', toPartner: v => Math.round(v * state.capacity.maxHoursPerDay) },
  // Solver capacity inputs are bound by the same throughput identity, so the
  // AOV/Gatekeeper modes (which use dailyDials) and the Ceiling mode (which uses
  // hours × dials/hr) never disagree about daily volume.
  // dailyDials = hoursPerDay × callsPerHour.
  'solver.hoursPerDay':  { partner: 'solver.dailyDials',  toPartner: v => Math.round(v * state.solver.callsPerHour) },
  'solver.callsPerHour': { partner: 'solver.dailyDials',  toPartner: v => Math.round(v * state.solver.hoursPerDay) },
  'solver.dailyDials':   { partner: 'solver.hoursPerDay', toPartner: v => state.solver.callsPerHour > 0 ? Math.round((v / state.solver.callsPerHour) * 100) / 100 : state.solver.hoursPerDay },
  'offer.monthlyChurn':    { partner: 'offer.retentionMonths', toPartner: v => v > 0 ? clamp(100 / v, 0.1, 120) : 120 },
  'offer.retentionMonths': { partner: 'offer.monthlyChurn',    toPartner: v => v > 0 ? clamp(100 / v, 0,   100) : 0 },
};
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function applyLink(path, value) {
  const link = LINKED[path];
  if (!link) return;
  const partnerValue = link.toPartner(value);
  setPath(state, link.partner, partnerValue);
  syncDom(link.partner, partnerValue);
}
function syncDom(path, value) {
  document.querySelectorAll(`[data-input="${path}"]`).forEach(row => {
    row.querySelectorAll('input').forEach(i => { i.value = value; });
  });
}

// ============================================================
// 6. Renderers
// ============================================================
function recalcAndRender() {
  const sum = computeSummary();
  renderPlanner(sum);
  renderKpiStrip(sum);
  renderFunnelViz(sum);
  renderDetailedFunnel(sum);
  renderScenarioComparison(sum);
  renderRealityCheck(sum);
  renderScenariosList();
  renderExperiments();
  if (state.activeTab === 'solver') runSolver();
}

function renderKpiStrip({ cpm, f, a, rp, gap }) {
  setText('kpi-gap',      fmtMoney(gap));
  setText('kpi-clients',  fmtNum(cpm.clients, 2));
  setText('kpi-dials',    fmtInt(f.dialsSafe));
  setText('kpi-daily',    fmtInt(a.daily));
  setText('kpi-hours',    fmtNum(a.hours, 1));
  setText('kpi-rev-dial', fmtMoneyDp(rp.perDial, 2));

  // Status pill: feasible / amber / danger based on capacity
  const status = document.getElementById('kpi-status');
  const overDials = a.daily > state.capacity.maxDialsPerDay;
  const overHours = a.hours > state.capacity.maxHoursPerDay;
  const veryOver = a.hours > 8 || a.daily > 200;
  if (veryOver) {
    status.className = 'kpi-status danger';
    status.textContent = 'Not feasible';
  } else if (overDials || overHours) {
    status.className = 'kpi-status amber';
    status.textContent = 'Tight';
  } else if (gap === 0 && state.revenue.targetMonthly > 0) {
    status.className = 'kpi-status';
    status.textContent = 'On target';
  } else {
    status.className = 'kpi-status';
    status.textContent = 'Feasible';
  }
}

function renderPlanner({ cpm, f, a, gap, rp }) {  // eslint-disable-line no-unused-vars
  setText('out-gap', fmtMoney(gap));
  setText('out-annual', fmtMoney(state.revenue.targetMonthly * 12));
  setText('out-clients-per-month', fmtNum(cpm.clients, 2));
  setText('out-clients-mode-note',
    state.goalMode === 'A' ? 'Mode A — no repeats assumed' :
    state.goalMode === 'B' ? `Mode B — ÷ ${fmtNum(state.offer.avgRepeatOrders, 1)} repeat orders` :
                             'Mode C — retainer (acquisition + churn replacement)');

  let effective;
  if (state.goalMode === 'C') {
    const retention = state.offer.monthlyChurn > 0 ? (100 / state.offer.monthlyChurn) : state.offer.retentionMonths;
    effective = state.offer.mrrPerClient * retention + state.offer.setupFee;
  } else if (state.goalMode === 'B') {
    effective = state.offer.aov * state.offer.avgRepeatOrders + state.offer.setupFee;
  } else {
    effective = state.offer.aov + state.offer.setupFee;
  }
  setText('out-effective-rev', fmtMoney(effective));
  setText('out-effective-rev-note',
    state.goalMode === 'A' ? 'AOV + setup' :
    state.goalMode === 'B' ? 'AOV × repeats + setup' :
                             'MRR × retention + setup');

  setText('out-daily',   fmtInt(a.daily));
  setText('out-weekly',  fmtInt(a.weekly));
  setText('out-monthly', fmtInt(a.monthly));
  setText('out-hours',   fmtNum(a.hours, 1));

  // In-card warnings
  const warns = [];
  if (a.daily > 200) warns.push({ tone: 'danger', text: `Workload heuristic: ${fmtInt(a.daily)} daily dials exceeds the built-in 200-dial warning threshold. Review your measured capacity.` });
  if (a.hours > 8) warns.push({ tone: 'danger', text: `Workload heuristic: ${fmtNum(a.hours, 1)} productive hrs/day exceeds the built-in 8-hour warning threshold. Review your schedule and assumptions.` });
  else if (a.hours > 5) warns.push({ tone: 'warn', text: `Workload heuristic: ${fmtNum(a.hours, 1)} hrs/day exceeds the built-in 5-hour warning threshold. Compare it with your available time.` });
  if (!isFinite(f.dials)) warns.push({ tone: 'danger', text: 'Required activity is undefined — check funnel rates and offer value.' });
  document.getElementById('activity-warnings').innerHTML = warns.map(renderWarning).join('');
}

function renderWarning(m) {
  const klass = m.tone === 'danger' ? 'danger' : (m.tone === 'good' ? 'good' : '');
  return `<div class="warning ${klass}">${escapeHtml(m.text)}</div>`;
}

// ----- Gatekeeper-branch funnel visualisation -----
function dfNode(label, value, sub, cls = '') {
  return `<div class="df-node ${cls}">
    <div class="df-node-val">${fmtInt(value)}</div>
    <div class="df-node-label">${escapeHtml(label)}</div>
    ${sub ? `<div class="df-node-sub">${escapeHtml(sub)}</div>` : ''}
  </div>`;
}
function dfArrow(metric, ratePct, cls = '') {
  return `<div class="df-arrow ${cls}">
    <span class="df-line"></span>
    <span class="df-rate">${escapeHtml(metric)}: ${fmtNum(ratePct, 2)}%</span>
  </div>`;
}

function renderFunnelViz({ det }) {
  const viz = document.getElementById('funnel-viz');
  if (!viz) return;
  const d = state.funnel;
  const isForward = det.direction === 'forward';

  // Identify the steepest single conversion drop (the bottleneck node).
  const gk = gkFactor(d);
  const transitions = [
    { key: 'pickups',      frac: r(d.pur) },
    { key: 'stakeholders', frac: gk        },
    { key: 'qualified',    frac: r(d.qr)   },
    { key: 'appointments', frac: r(d.abr)  },
    { key: 'salesCalls',   frac: r(d.sur)  },
    { key: 'pitches',      frac: r(d.gfr)  },
    { key: 'clients',      frac: r(d.scr)  },
  ].filter(t => isFinite(t.frac) && t.frac > 0);
  let bottleneck = null;
  if (transitions.length) {
    bottleneck = transitions.reduce((min, t) => t.frac < min.frac ? t : min, transitions[0]).key;
  }
  const bn = key => key === bottleneck ? 'bottleneck' : '';

  const dirNote = isForward
    ? `Forward — projecting from ${fmtInt(det.dials)} dials/month`
    : `Reverse — solving from ${fmtNum(det.clients, 2)} clients/month`;

  const html = `
    <div class="df-dir-note">${escapeHtml(dirNote)}</div>
    <div class="dfunnel">
      ${dfNode('Dials', det.dials, 'per month')}
      ${dfArrow('PUR', d.pur)}
      ${dfNode('Pick-ups', det.pickups, 'human answered')}

      <div class="df-split">
        <div class="df-split-rates">
          <span class="df-rate br">GR: ${fmtNum(d.gr, 2)}% → gatekeeper</span>
          <span class="df-rate br">${fmtNum(100 - d.gr, 2)}% → direct</span>
        </div>
        <div class="df-branches">
          <div class="df-branch">
            ${dfNode('Gatekeeper interactions', det.gkInteractions, 'hit a gatekeeper', 'sub')}
            ${dfArrow('GBR', d.gbr, 'small')}
            ${dfNode('Reached via gatekeeper', det.viaGatekeeper, 'bypassed', 'sub')}
          </div>
          <div class="df-branch">
            ${dfNode('Direct stakeholder contact', det.directStake, 'no gatekeeper', 'sub')}
          </div>
        </div>
        <div class="df-converge">both paths converge ↓</div>
      </div>

      ${dfNode('Total stakeholders', det.stakeholders, 'reached', bn('stakeholders'))}
      ${dfArrow('QR', d.qr)}
      ${dfNode('Qualified', det.qualified, 'right fit', bn('qualified'))}
      ${dfArrow('ABR', d.abr)}
      ${dfNode('Appointments', det.appointments, 'booked', bn('appointments'))}
      ${dfArrow('SUR', d.sur)}
      ${dfNode('Sales calls', det.salesCalls, 'attended', bn('salesCalls'))}
      ${dfArrow('GFR', d.gfr)}
      ${dfNode('Pitches', det.pitches, 'delivered', bn('pitches'))}
      ${dfArrow('SCR', d.scr)}
      ${dfNode('Clients acquired', det.clients, fmtMoney(det.projectedRevenue) + ' / mo', 'final ' + bn('clients'))}
    </div>`;
  viz.innerHTML = html;
}

// Detailed funnel summary outputs + direction-dependent input visibility.
function renderDetailedFunnel({ det }) {
  const isForward = det.direction === 'forward';
  setText('out-df-dials',   fmtInt(det.dials));
  setText('out-df-clients', fmtNum(det.clients, 2));
  setText('out-df-revenue', fmtMoney(det.projectedRevenue));
  document.querySelector('#out-df-revenue-wrap .label').textContent = state.goalMode === 'C'
    ? 'New recurring revenue / mo' : 'Projected revenue / mo';
  document.querySelector('#out-df-revenue-wrap .sub').textContent = state.goalMode === 'C'
    ? 'new clients × MRR; excludes setup fees' : (state.goalMode === 'B'
      ? 'clients × (AOV × repeat orders + setup)' : 'clients × (AOV + setup)');
  setText('out-df-stake',   fmtInt(det.stakeholders));

  const dialsOut = document.getElementById('out-df-dials-wrap');
  const clientsOut = document.getElementById('out-df-clients-wrap');
  const revOut = document.getElementById('out-df-revenue-wrap');
  if (dialsOut)   dialsOut.classList.toggle('highlight', !isForward);
  if (clientsOut) clientsOut.classList.toggle('highlight', isForward);
  if (revOut)     revOut.classList.toggle('highlight', isForward);

  // Forward-only input (dials/month) visibility
  const fwdRow = document.getElementById('df-forward-row');
  if (fwdRow) fwdRow.style.display = isForward ? '' : 'none';

  // Direction toggle active state
  document.querySelectorAll('#df-direction button').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-direction') === det.direction));
}

// ----- Scenario comparison table -----
function renderScenarioComparison({ cpm }) {
  const active = state.activeScenarioId;
  const scenarios = state.scenarios;

  // Compute each scenario's outputs by solving its gatekeeper rates REVERSE
  // against the shared revenue goal + global activity/offer settings.
  const results = scenarios.map(sc => {
    const det = calcDetailed.reverse(cpm.clients, sc);
    const dialsSafe = isFinite(det.dials) ? det.dials * state.activity.safetyMultiplier : Infinity;
    const a = calc.activity(dialsSafe, state.activity);
    const gap = Math.max(0, state.revenue.targetMonthly - state.revenue.currentMonthly);
    const rp = calc.revenuePer(gap, { dialsSafe, booked: det.appointments, attended: det.salesCalls });
    return { sc, det, dialsSafe, a, rp };
  });

  const activeIdx = scenarios.findIndex(s => s.id === active);
  const activeR = activeIdx >= 0 ? results[activeIdx] : null;

  // Rows: rate rows are shown plainly (no diff colour — "better" is ambiguous
  // per rate); output rows are diff-coloured vs the active scenario.
  const rateRow = (label, key) => ({ label, fn: r => fmtNum(r.sc[key], r.sc[key] < 10 ? 1 : 0) + '%', plain: true });
  const rows = [
    rateRow('PUR', 'pur'),
    rateRow('GR',  'gr'),
    rateRow('GBR', 'gbr'),
    rateRow('QR',  'qr'),
    rateRow('ABR', 'abr'),
    rateRow('SUR', 'sur'),
    rateRow('GFR', 'gfr'),
    rateRow('SCR', 'scr'),
    { label: 'Stakeholders / mo', fn: r => fmtInt(r.det.stakeholders), diff: r => r.det.stakeholders, lowerBetter: true },
    { label: 'Dials / mo',        fn: r => fmtInt(r.dialsSafe),        diff: r => r.dialsSafe,        lowerBetter: true },
    { label: 'Daily dials',       fn: r => fmtInt(r.a.daily),          diff: r => r.a.daily,          lowerBetter: true },
    { label: 'Hours / day',       fn: r => fmtNum(r.a.hours, 1),       diff: r => r.a.hours,          lowerBetter: true },
    { label: 'Revenue / dial',    fn: r => fmtMoneyDp(r.rp.perDial, 2),diff: r => r.rp.perDial,       lowerBetter: false },
  ];

  const head = `<thead><tr><th>Metric</th>${scenarios.map((sc, i) =>
    `<th class="${sc.id === active ? 'active-col' : ''}">${escapeHtml(sc.name)}</th>`
  ).join('')}</tr></thead>`;

  const body = rows.map(row => {
    const cells = results.map((r, i) => {
      const v = row.fn(r);
      const isActive = scenarios[i].id === active;
      if (row.plain || !activeR || isActive) {
        return `<td class="${isActive ? 'active-col' : ''}">${escapeHtml(v)}</td>`;
      }
      const cur = row.diff(r);
      const act = row.diff(activeR);
      const delta = cur - act;
      const pct = act !== 0 ? delta / act : 0;
      const significant = Math.abs(pct) > 0.05;
      let klass = 'diff-neutral';
      let arrow = '';
      if (significant) {
        const easier = row.lowerBetter ? cur < act : cur > act;
        klass = easier ? 'diff-easier' : 'diff-harder';
        arrow = easier ? '↓' : '↑';
      }
      return `<td class="${klass}"><span class="diff-arrow">${arrow}</span>${escapeHtml(v)}</td>`;
    }).join('');
    return `<tr><td>${escapeHtml(row.label)}</td>${cells}</tr>`;
  }).join('');

  document.getElementById('scenario-comparison').innerHTML = `
    <table class="scenario-table">${head}<tbody>${body}</tbody></table>`;
}

// ----- Reality check (sidebar) -----
function renderRealityCheck(summary) {
  const items = generateRealityCheck(summary);
  const html = items.map(it => `
    <div class="reality-item ${it.tone}"><span class="ico">${it.icon}</span>${escapeHtml(it.text)}</div>
  `).join('');
  document.getElementById('reality-panel').innerHTML = html || '<div class="reality-item">Set inputs to see insights.</div>';
}

function generateRealityCheck(summary) {
  const items = [];
  const { f, a, gap } = summary;

  if (gap === 0 && state.revenue.targetMonthly > 0) {
    items.push({ tone: 'feasible', icon: '✓', text: 'On target — plan growth or run experiments.' });
    return items;
  }
  if (!isFinite(f.dials)) {
    items.push({ tone: 'infeasible', icon: '✕', text: 'Required activity is undefined — check funnel rates and offer value.' });
    return items;
  }

  // Feasibility
  const overDials = a.daily > state.capacity.maxDialsPerDay;
  const overHours = a.hours > state.capacity.maxHoursPerDay;
  if (!overDials && !overHours) {
    items.push({ tone: 'feasible', icon: '✓', text: `Feasible: ${fmtInt(a.daily)} dials/day, ${fmtNum(a.hours, 1)} hrs/day.` });
  } else {
    const probs = [];
    if (overDials) probs.push(`${fmtInt(a.daily)} dials/day vs cap ${state.capacity.maxDialsPerDay}`);
    if (overHours) probs.push(`${fmtNum(a.hours, 1)} hrs/day vs cap ${state.capacity.maxHoursPerDay}`);
    items.push({ tone: 'infeasible', icon: '✕', text: `Over capacity: ${probs.join('; ')}.` });
  }

  // Describe the smallest conversion factor in the user's current model.
  // This is a numerical comparison, not an industry target or causal diagnosis.
  const fn = state.funnel;
  const stages = [
    { name: 'pick-up', fraction: r(fn.pur) },
    { name: 'stakeholder reach after pick-up', fraction: gkFactor(fn) },
    { name: 'qualification', fraction: r(fn.qr) },
    { name: 'appointment booking', fraction: r(fn.abr) },
    { name: 'show-up', fraction: r(fn.sur) },
    { name: 'pitch', fraction: r(fn.gfr) },
    { name: 'close', fraction: r(fn.scr) },
  ];
  const smallest = stages.reduce((min, stage) => stage.fraction < min.fraction ? stage : min);
  items.push({ tone: 'bottleneck', icon: '!', text: `Smallest conversion factor: ${smallest.name} at ${fmtPct(smallest.fraction, 1)} in your inputs. This identifies the largest proportional drop, not the best intervention.` });

  // Leverage — simulate +50% AOV, see how many dials are saved
  if (state.offer.aov > 0 && state.goalMode !== 'C') {
    const cur = summary.f.dialsSafe;
    const simState = clone(state);
    simState.offer.aov = state.offer.aov * 1.5;
    const sim = computeSummary(simState);
    if (isFinite(cur) && isFinite(sim.f.dialsSafe) && cur > 0) {
      const reduction = (cur - sim.f.dialsSafe) / cur;
      if (reduction > 0.05) {
        items.push({ tone: 'leverage', icon: '→',
          text: `Lifting AOV ${fmtMoney(state.offer.aov)} → ${fmtMoney(simState.offer.aov)} cuts required dials by ${fmtPct(reduction, 0)}.` });
      }
    }
  }
  return items;
}

// ============================================================
// 7. Scenarios — CRUD
// ============================================================
function currentScenario() {
  return state.scenarios.find(s => s.id === state.activeScenarioId) || state.scenarios[0];
}

function loadScenario(id) {
  const sc = state.scenarios.find(s => s.id === id);
  if (!sc) return;
  state.activeScenarioId = id;
  GK_RATES.forEach(k => { if (sc[k] != null) state.funnel[k] = sc[k]; });
  hydrateAllInputs();
  applyModeVisibility();
  scheduleSave();
  recalcAndRender();
}

function saveActiveScenario() {
  const sc = currentScenario();
  if (!sc) return;
  GK_RATES.forEach(k => { sc[k] = state.funnel[k]; });
  scheduleSave();
  recalcAndRender();
  flashButton('btn-save-scenario', 'Saved ✓');
}

function addScenario(initial = {}) {
  const sc = {
    id: genId('sc'),
    name: initial.name || 'Custom scenario',
    type: initial.type || 'custom',
    description: initial.description || '',
  };
  GK_RATES.forEach(k => { sc[k] = initial[k] != null ? initial[k] : state.funnel[k]; });
  state.scenarios.push(sc);
  state.activeScenarioId = sc.id;
  loadScenario(sc.id);
}

function duplicateScenario(id) {
  const src = state.scenarios.find(s => s.id === id);
  if (!src) return;
  addScenario({ ...src, name: src.name + ' (copy)', type: 'custom' });
}

function deleteScenario(id) {
  if (state.scenarios.length <= 1) return;  // never delete last
  const idx = state.scenarios.findIndex(s => s.id === id);
  if (idx === -1) return;
  if (!confirm(`Delete scenario "${state.scenarios[idx].name}"?`)) return;
  state.scenarios.splice(idx, 1);
  if (state.activeScenarioId === id) {
    state.activeScenarioId = state.scenarios[0].id;
    loadScenario(state.activeScenarioId);
  }
  scheduleSave();
  recalcAndRender();
}

function renameScenario(id) {
  const sc = state.scenarios.find(s => s.id === id);
  if (!sc) return;
  openModal({
    title: 'Rename scenario',
    body: `
      <div class="modal-row">
        <label>Name</label>
        <input type="text" id="modal-input-name" value="${escapeHtml(sc.name)}" />
      </div>
      <div class="modal-row">
        <label>Type</label>
        <select id="modal-input-type">
          <option value="conservative" ${sc.type === 'conservative' ? 'selected' : ''}>Conservative</option>
          <option value="realistic"    ${sc.type === 'realistic'    ? 'selected' : ''}>Realistic</option>
          <option value="bestCase"     ${sc.type === 'bestCase'     ? 'selected' : ''}>Best case</option>
          <option value="custom"       ${sc.type === 'custom'       ? 'selected' : ''}>Custom</option>
        </select>
      </div>
      <div class="modal-row">
        <label>Description (optional)</label>
        <input type="text" id="modal-input-desc" value="${escapeHtml(sc.description || '')}" />
      </div>
    `,
    confirmLabel: 'Save',
    onConfirm: () => {
      sc.name = document.getElementById('modal-input-name').value.trim() || sc.name;
      sc.type = document.getElementById('modal-input-type').value;
      sc.description = document.getElementById('modal-input-desc').value.trim();
      scheduleSave();
      recalcAndRender();
    }
  });
}

function isScenarioModified(sc) {
  return GK_RATES.some(k => Math.abs((sc[k] ?? 0) - state.funnel[k]) > 0.001);
}

function renderScenariosList() {
  const list = document.getElementById('scenarios-list');
  const active = state.activeScenarioId;
  list.innerHTML = state.scenarios.map(sc => {
    const isActive = sc.id === active;
    const modified = isActive && isScenarioModified(sc);
    return `
      <div class="scenario-row ${isActive ? 'active' : ''} ${modified ? 'modified' : ''}" data-scenario-id="${escapeHtml(sc.id)}">
        <span class="dot"></span>
        <div class="sc-text">
          <div class="sc-name">${escapeHtml(sc.name)}</div>
          <div class="sc-rates">
            <span class="sc-type ${escapeHtml(sc.type)}">${sc.type === 'bestCase' ? 'best' : sc.type}</span>
            ABR ${fmtNum(sc.abr,0)}% · SCR ${fmtNum(sc.scr,0)}%
          </div>
        </div>
        <button class="sc-menu" data-sc-menu="${escapeHtml(sc.id)}" aria-label="Scenario menu">⋯</button>
        <div class="sc-dropdown" data-sc-dropdown="${escapeHtml(sc.id)}">
          <button data-sc-action="rename"    data-sc-id="${escapeHtml(sc.id)}">Rename / Edit</button>
          <button data-sc-action="duplicate" data-sc-id="${escapeHtml(sc.id)}">Duplicate</button>
          <button data-sc-action="setdefault" data-sc-id="${escapeHtml(sc.id)}">Save working rates</button>
          <hr/>
          <button class="danger" data-sc-action="delete" data-sc-id="${escapeHtml(sc.id)}" ${state.scenarios.length <= 1 ? 'disabled' : ''}>Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function bindScenariosList() {
  const list = document.getElementById('scenarios-list');
  list.addEventListener('click', (e) => {
    const menuBtn = e.target.closest('[data-sc-menu]');
    if (menuBtn) {
      e.stopPropagation();
      closeAllScenarioDropdowns();
      const id = menuBtn.getAttribute('data-sc-menu');
      const dd = document.querySelector(`[data-sc-dropdown="${id}"]`);
      if (dd) dd.classList.add('visible');
      return;
    }
    const action = e.target.closest('[data-sc-action]');
    if (action) {
      e.stopPropagation();
      const id = action.getAttribute('data-sc-id');
      const act = action.getAttribute('data-sc-action');
      closeAllScenarioDropdowns();
      if (act === 'rename')     renameScenario(id);
      if (act === 'duplicate')  duplicateScenario(id);
      if (act === 'setdefault') { state.activeScenarioId = id; saveActiveScenario(); }
      if (act === 'delete')     deleteScenario(id);
      return;
    }
    const row = e.target.closest('[data-scenario-id]');
    if (row) loadScenario(row.getAttribute('data-scenario-id'));
  });

  document.addEventListener('click', closeAllScenarioDropdowns);

  document.getElementById('btn-add-scenario').addEventListener('click', () => {
    addScenario({ name: 'Custom ' + (state.scenarios.length + 1), type: 'custom' });
  });
  document.getElementById('btn-save-scenario').addEventListener('click', saveActiveScenario);
}
function closeAllScenarioDropdowns() {
  document.querySelectorAll('.sc-dropdown.visible').forEach(d => d.classList.remove('visible'));
}

// ============================================================
// 8. Experiments — lab notebook
// ============================================================
function newExperiment() {
  return {
    id: genId('exp'),
    createdAt: new Date().toISOString(),
    name: 'New experiment',
    hypothesis: '',
    metric: 'Appointment booking rate',
    variable: '',
    constants: '',
    currentVersion: 'v1',
    newVersion: 'v2',
    sampleSize: 200,
    timeframeDays: 14,
    baseline: 0,
    targetKpi: 0,
    result: '',     // user-entered post-test
    decision: '',   // 'keep' | 'iterate' | 'discard'
    nextTest: '',
    notes: '',
  };
}

function addExperiment() {
  state.experiments.unshift(newExperiment());
  scheduleSave();
  renderExperiments();
}
function deleteExperiment(id) {
  if (!confirm('Delete this experiment?')) return;
  state.experiments = state.experiments.filter(e => e.id !== id);
  scheduleSave();
  renderExperiments();
}

function kpiRec(current, target) {
  if (!isFinite(current) || !isFinite(target) || target <= 0) {
    return { tone: '', title: 'Set target KPI', body: '' };
  }
  const ratio = current / target;
  if (ratio >= 1.0) return { tone: 'good',   title: 'Protect what works — controlled optimisation only.', body: `${fmtNum(current,2)}% meets/exceeds the ${fmtNum(target,2)}% KPI. Don't rewrite; A/B test secondary variables.` };
  if (ratio >= 0.80) return { tone: 'mild',   title: 'Slight modification.',  body: `${fmtNum(current,2)}% is ${fmtPct(ratio,0)} of target. Tune wording, ordering, tone — one variable at a time.` };
  if (ratio >= 0.50) return { tone: 'warn',   title: 'Moderate modification.',body: `${fmtNum(current,2)}% is ${fmtPct(ratio,0)} of target. Something meaningful is off — change opener angle or qualification question.` };
  return                  { tone: 'danger', title: 'Complete modification — high-risk, not the default.', body: `${fmtNum(current,2)}% is ${fmtPct(ratio,0)} of target. Only rewrite after exhausting slight/moderate. A rewrite loses comparability with prior tests.` };
}

function renderExperiments() {
  const list = document.getElementById('experiments-list');
  if (state.experiments.length === 0) {
    list.innerHTML = `<div class="reality-item" style="padding:16px; text-align:center; color:var(--text-muted);">No experiments yet. Click <strong>+ New experiment</strong> to start your first one.</div>`;
    return;
  }
  list.innerHTML = state.experiments.map(exp => {
    const result = parseFloat(exp.result);
    const target = parseFloat(exp.targetKpi);
    const haveResult = isFinite(result) && exp.result !== '';
    const rec = haveResult ? kpiRec(result, target) : null;
    const decisionPill = exp.decision ? `<span class="decision-pill ${escapeHtml(exp.decision)}">${escapeHtml(exp.decision)}</span>` : '';
    return `
      <div class="experiment" data-exp-id="${escapeHtml(exp.id)}">
        <div class="experiment-header">
          <input type="text" class="experiment-name" data-exp-field="name" value="${escapeHtml(exp.name)}" />
          <div class="experiment-meta">
            ${decisionPill}
            <button class="btn btn-ghost btn-sm" data-exp-delete="${escapeHtml(exp.id)}" title="Delete">✕</button>
          </div>
        </div>

        <div class="experiment-grid">
          <div class="input-row"><div class="label">Metric</div>
            <div class="controls"><input type="text" data-exp-field="metric" value="${escapeHtml(exp.metric)}" style="width:100%"/></div>
          </div>
          <div class="input-row"><div class="label">Variable being tested</div>
            <div class="controls"><input type="text" data-exp-field="variable" value="${escapeHtml(exp.variable)}" placeholder="e.g. Cold-call opener" style="width:100%"/></div>
          </div>
          <div class="input-row"><div class="label">Hypothesis</div>
            <div class="controls"><input type="text" data-exp-field="hypothesis" value="${escapeHtml(exp.hypothesis)}" placeholder="If I change X, then Y will lift to Z because..." style="width:100%"/></div>
          </div>
          <div class="input-row"><div class="label">Constants (must NOT change)</div>
            <div class="controls"><input type="text" data-exp-field="constants" value="${escapeHtml(exp.constants)}" placeholder="List, time of day, calls/hr, dialler" style="width:100%"/></div>
          </div>
          <div class="input-row"><div class="label">Current version</div>
            <div class="controls"><input type="text" data-exp-field="currentVersion" value="${escapeHtml(exp.currentVersion)}" style="width:100%"/></div>
          </div>
          <div class="input-row"><div class="label">New version</div>
            <div class="controls"><input type="text" data-exp-field="newVersion" value="${escapeHtml(exp.newVersion)}" style="width:100%"/></div>
          </div>
          <div class="input-row"><div class="label">Sample size</div>
            <div class="controls"><input type="number" data-exp-field="sampleSize" value="${escapeHtml(exp.sampleSize)}" min="1" step="10"/><span class="unit">attempts</span></div>
          </div>
          <div class="input-row"><div class="label">Test timeframe</div>
            <div class="controls"><input type="number" data-exp-field="timeframeDays" value="${escapeHtml(exp.timeframeDays)}" min="1" step="1"/><span class="unit">days</span></div>
          </div>
          <div class="input-row"><div class="label">Baseline (before)</div>
            <div class="controls"><input type="number" data-exp-field="baseline" value="${escapeHtml(exp.baseline)}" min="0" step="0.1"/><span class="unit">%</span></div>
          </div>
          <div class="input-row"><div class="label">Target KPI</div>
            <div class="controls"><input type="number" data-exp-field="targetKpi" value="${escapeHtml(exp.targetKpi)}" min="0" step="0.1"/><span class="unit">%</span></div>
          </div>
          <div class="input-row"><div class="label">Result (after)</div>
            <div class="controls"><input type="number" data-exp-field="result" value="${escapeHtml(exp.result)}" min="0" step="0.1" placeholder="Fill after test"/><span class="unit">%</span></div>
          </div>
          <div class="input-row"><div class="label">Decision</div>
            <div class="controls" style="gap:6px;">
              <div class="toggle-group" data-exp-decision="${escapeHtml(exp.id)}" style="flex:1">
                <button data-decision="keep"    class="${exp.decision === 'keep' ? 'active' : ''}">Keep</button>
                <button data-decision="iterate" class="${exp.decision === 'iterate' ? 'active' : ''}">Iterate</button>
                <button data-decision="discard" class="${exp.decision === 'discard' ? 'active' : ''}">Discard</button>
              </div>
            </div>
          </div>
          <div class="input-row" style="grid-column: 1 / -1"><div class="label">Next test</div>
            <div class="controls"><input type="text" data-exp-field="nextTest" value="${escapeHtml(exp.nextTest)}" placeholder="What follows from this result?" style="width:100%"/></div>
          </div>
          <div class="input-row" style="grid-column: 1 / -1"><div class="label">Notes</div>
            <div class="controls"><input type="text" data-exp-field="notes" value="${escapeHtml(exp.notes)}" placeholder="Anything else worth recording" style="width:100%"/></div>
          </div>
        </div>

        ${rec ? `<div class="reco ${rec.tone}"><div class="reco-title">${escapeHtml(rec.title)}</div><div class="reco-body">${escapeHtml(rec.body)}</div></div>` : ''}
      </div>
    `;
  }).join('');
}

function bindExperimentsList() {
  const list = document.getElementById('experiments-list');
  list.addEventListener('input', (e) => {
    const field = e.target.getAttribute('data-exp-field');
    if (!field) return;
    const card = e.target.closest('[data-exp-id]');
    const id = card.getAttribute('data-exp-id');
    const exp = state.experiments.find(x => x.id === id);
    if (!exp) return;
    const val = e.target.type === 'number' ? (e.target.value === '' ? '' : parseFloat(e.target.value)) : e.target.value;
    exp[field] = val;
    scheduleSave();
    // If baseline/target/result changed, re-render to update recommendation
    if (['baseline','targetKpi','result'].includes(field)) renderExperiments();
  });
  list.addEventListener('click', (e) => {
    const del = e.target.getAttribute('data-exp-delete');
    if (del) { deleteExperiment(del); return; }
    const decisionBtn = e.target.closest('[data-decision]');
    if (decisionBtn) {
      const grp = decisionBtn.closest('[data-exp-decision]');
      const id = grp.getAttribute('data-exp-decision');
      const exp = state.experiments.find(x => x.id === id);
      if (!exp) return;
      const choice = decisionBtn.getAttribute('data-decision');
      exp.decision = exp.decision === choice ? '' : choice;
      scheduleSave();
      renderExperiments();
    }
  });
  document.getElementById('btn-add-experiment').addEventListener('click', addExperiment);
}

// ============================================================
// 9. Solver — reverse modes (all on the gatekeeper funnel)
// ============================================================
const SOLVE_FORMULAS = {
  aov:    'AOV = target ÷ (dials/mo × PUR × [(1−GR)+(GR×GBR)] × QR × ABR × SUR × GFR × SCR)',
  maxRev: 'maxRev = hours × callsPerHr × workingDays × [gatekeeper funnel composite] × AOV',
  gk:     'clients = dials × PUR × [(1−GR)+(GR×GBR)] × QR × ABR × SUR × GFR × SCR — solved for one rate',
};

// Labels for the gatekeeper rates (used by the solver dropdown + output).
const GK_RATE_LABELS = {
  pur: 'PUR — Pick-up rate',
  gr:  'GR — Gatekeeper rate',
  gbr: 'GBR — Gatekeeper bypass rate',
  qr:  'QR — Qualification rate',
  abr: 'ABR — Appointment booking rate',
  sur: 'SUR — Show-up rate',
  gfr: 'GFR — Gone-forward / pitch rate',
  scr: 'SCR — Sale close rate',
};

// Solve for one gatekeeper rate given the client target, dial budget, and the
// other seven rates (read from state.funnel). Returns required % + feasibility.
function solveGatekeeperRate(which, clientsTarget, dialBudget, R) {
  const f = { pur: r(R.pur), qr: r(R.qr), abr: r(R.abr), sur: r(R.sur), gfr: r(R.gfr), scr: r(R.scr) };
  const linearKeys = ['pur', 'qr', 'abr', 'sur', 'gfr', 'scr'];
  const prod = keys => keys.reduce((p, k) => p * f[k], 1);

  if (clientsTarget <= 0 || dialBudget <= 0) {
    return { pct: NaN, feasible: false, reason: 'zero' };
  }

  if (linearKeys.includes(which)) {
    // requiredFrac = clients ÷ (dials × GK × ∏ other linear fractions)
    const gk = gkFactor(R);
    const others = dialBudget * gk * prod(linearKeys.filter(k => k !== which));
    if (others <= 0) return { pct: NaN, feasible: false, reason: 'zero' };
    const frac = clientsTarget / others;
    return { pct: frac * 100, feasible: frac > 0 && frac <= 1, reason: frac > 1 ? 'over' : '' };
  }

  // GR / GBR feed the non-linear gatekeeper factor. Solve required GK first.
  const baseProduct = dialBudget * prod(linearKeys);   // everything except the GK factor
  if (baseProduct <= 0) return { pct: NaN, feasible: false, reason: 'zero' };
  const gkReq = clientsTarget / baseProduct;            // required value of (1−GR)+(GR×GBR)
  if (gkReq <= 0 || gkReq > 1) {
    return { pct: NaN, feasible: false, reason: gkReq > 1 ? 'over' : 'zero', gkReq };
  }
  if (which === 'gbr') {
    const gr = r(R.gr);
    if (gr <= 0) return { pct: NaN, feasible: false, reason: 'no-gr' };
    const gbr = (gkReq - (1 - gr)) / gr;   // invert GK = (1−GR)+(GR×GBR)
    return { pct: gbr * 100, feasible: gbr >= 0 && gbr <= 1, reason: gbr > 1 ? 'over' : (gbr < 0 ? 'under' : ''), gkReq };
  }
  // which === 'gr': GK = 1 − GR(1 − GBR)  →  GR = (1 − GK) ÷ (1 − GBR)
  const gbr = r(R.gbr);
  if (gbr >= 1) return { pct: NaN, feasible: false, reason: 'gbr-full' };
  const gr = (1 - gkReq) / (1 - gbr);
  return { pct: gr * 100, feasible: gr >= 0 && gr <= 1, reason: gr > 1 ? 'over' : (gr < 0 ? 'under' : ''), gkReq };
}

function runSolver() {
  const s = state.solver;
  showSolverInputs(s.mode);
  setText('solver-formula', SOLVE_FORMULAS[s.mode] || '');

  let label = '', value = '—', interp = '', feasible = true;
  const comp = gkComposite(state.funnel);   // clients per dial through the gatekeeper funnel

  if (s.mode === 'aov') {
    const dialsAvail = s.dailyDials * s.workingDays;
    const clients = dialsAvail * comp;
    const reqAOV = clients > 0 ? s.target / clients : Infinity;
    label = 'Required AOV';
    value = fmtMoney(reqAOV);
    feasible = isFinite(reqAOV) && reqAOV > 0;
    interp = feasible
      ? `At ${s.dailyDials} dials/day × ${s.workingDays} days through your § 4 gatekeeper funnel (≈${fmtPct(comp, 3)} dial→client), you'll close ~${fmtNum(clients, 2)} clients/month. To hit ${fmtMoney(s.target)}/mo each client must be worth ${fmtMoney(reqAOV)}.`
      : 'Funnel rates produce 0 clients. Lift the § 4 gatekeeper rates or daily dials.';
  }

  else if (s.mode === 'maxRev') {
    const dialsCap = s.hoursPerDay * s.callsPerHour * s.workingDays;
    const clients = dialsCap * comp;
    const maxRev = clients * s.aov;
    label = 'Realistic monthly ceiling';
    value = fmtMoney(maxRev);
    feasible = maxRev > 0;
    interp = feasible
      ? `Committing ${s.hoursPerDay} hrs/day × ${s.callsPerHour} dials/hr × ${s.workingDays} days = ${fmtInt(dialsCap)} dials/mo. Through your § 4 gatekeeper funnel that's ~${fmtNum(clients, 2)} clients × ${fmtMoney(s.aov)} AOV = ${fmtMoney(maxRev)}/mo ceiling.`
      : 'Set non-zero § 4 rates and capacity to compute.';
  }

  else if (s.mode === 'gk') {
    const R = state.funnel;
    const which = s.gkSolveFor;
    const clientsTarget = s.aov > 0 ? s.target / s.aov : 0;
    const dialBudget = s.dailyDials * s.workingDays;
    const res = solveGatekeeperRate(which, clientsTarget, dialBudget, R);
    const rateName = GK_RATE_LABELS[which] || which.toUpperCase();
    // List the seven held rates
    const held = Object.keys(GK_RATE_LABELS).filter(k => k !== which)
      .map(k => `${k.toUpperCase()} ${fmtNum(R[k], 1)}%`).join(' · ');

    label = `Required ${rateName.split(' — ')[0]}`;
    feasible = res.feasible;
    if (isFinite(res.pct)) {
      value = fmtNum(res.pct, 2) + '%';
    } else {
      value = '—';
    }
    const head = `To win ${fmtNum(clientsTarget, 2)} clients/mo (${fmtMoney(s.target)} ÷ ${fmtMoney(s.aov)} AOV) from ${fmtInt(dialBudget)} dials/mo (${s.dailyDials}/day × ${s.workingDays} days), holding ${held}: `;
    if (feasible) {
      interp = head + `your ${rateName} needs to be ${fmtNum(res.pct, 2)}%.`;
    } else if (res.reason === 'over') {
      interp = head + `the required ${rateName} exceeds 100% — impossible. Raise AOV, raise dials, lift the other rates, or lower the target.`;
    } else if (res.reason === 'under') {
      interp = head + `the required rate is below 0%. ${which === 'gbr' ? 'The direct-contact branch already exceeds the target with GBR at 0%.' : 'Even GR at 0% cannot reach this target with the other rates held fixed.'}`;
    } else if (res.reason === 'no-gr') {
      interp = `Can't solve GBR when GR is 0% — no gatekeeper interactions exist to bypass. Set GR above 0 in § 4.`;
    } else if (res.reason === 'gbr-full') {
      interp = `Can't solve GR when GBR is 100% — the gatekeeper factor is 1 regardless of GR. Lower GBR in § 4.`;
    } else {
      interp = 'Set a non-zero AOV, dial budget, and the other seven rates (§ 4) to compute.';
    }
  }

  setText('solver-result-label', label);
  setText('solver-result-value', value);
  setText('solver-result-interp', interp);
  document.getElementById('solver-result').classList.toggle('infeasible', !feasible);
}

function showSolverInputs(mode) {
  document.querySelectorAll('.solver-input').forEach(row => {
    const modes = row.getAttribute('data-solve-modes').split(' ');
    row.style.display = modes.includes(mode) ? '' : 'none';
  });
}

function bindSolver() {
  const grp = document.getElementById('solver-mode-switch');
  grp.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      grp.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.solver.mode = btn.getAttribute('data-solve');
      runSolver();
      scheduleSave();
    });
  });

  const gkSel = document.getElementById('solver-gk-select');
  if (gkSel) {
    gkSel.value = state.solver.gkSolveFor;
    gkSel.addEventListener('change', () => {
      state.solver.gkSolveFor = gkSel.value;
      runSolver();
      scheduleSave();
    });
  }
}

// ============================================================
// 10. Tabs, modal, tooltip popover
// ============================================================
function bindTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
    });
  });
}
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
  document.querySelectorAll('.tabpanel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  document.getElementById('nav-planner').classList.toggle('hidden',     tab !== 'planner');
  document.getElementById('nav-solver').classList.toggle('hidden',      tab !== 'solver');
  document.getElementById('nav-experiments').classList.toggle('hidden', tab !== 'experiments');
  if (tab === 'solver') runSolver();
  scheduleSave();
}

// Modal helper
let modalConfirmHandler = null;
function openModal({ title, body, confirmLabel = 'OK', onConfirm }) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-confirm').textContent = confirmLabel;
  document.getElementById('modal-backdrop').classList.add('visible');
  modalConfirmHandler = onConfirm;
}
function closeModal() {
  document.getElementById('modal-backdrop').classList.remove('visible');
  modalConfirmHandler = null;
}
function bindModal() {
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-confirm').addEventListener('click', () => {
    if (modalConfirmHandler) modalConfirmHandler();
    closeModal();
  });
  document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
}

// Tooltip popover
function initTooltips() {
  const tip = document.getElementById('tooltip');
  let activeTarget = null;

  const show = (target) => {
    const data = TOOLTIPS[target.getAttribute('data-tooltip')];
    if (!data) return;
    activeTarget = target;
    tip.innerHTML = `
      <div class="tooltip-title">${escapeHtml(data.title)}</div>
      <div class="tooltip-body">${escapeHtml(data.body)}</div>
      ${data.formula ? `<code class="tooltip-formula">${escapeHtml(data.formula)}</code>` : ''}
      ${data.tag ? `<span class="tooltip-tag">${escapeHtml(data.tag)}</span>` : ''}
    `;
    tip.classList.add('visible');
    tip.setAttribute('aria-hidden', 'false');
    position(target);
  };
  const hide = () => {
    tip.classList.remove('visible');
    tip.setAttribute('aria-hidden', 'true');
    activeTarget = null;
  };
  const position = (target) => {
    const tr = target.getBoundingClientRect();
    const pr = tip.getBoundingClientRect();
    const m = 8;
    let top = tr.bottom + m;
    let left = tr.left + tr.width/2 - pr.width/2;
    if (top + pr.height > window.innerHeight - 8) top = tr.top - pr.height - m;
    if (left < 8) left = 8;
    if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
  };

  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tooltip]');
    if (t && t !== activeTarget) show(t);
  });
  document.addEventListener('mouseout', (e) => {
    const t = e.target.closest('[data-tooltip]');
    if (!t || t !== activeTarget) return;
    const rel = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-tooltip]');
    if (rel === t) return;
    hide();
  });
  document.addEventListener('focusin',  (e) => { const t = e.target.closest('[data-tooltip]'); if (t) show(t); });
  document.addEventListener('focusout', (e) => { const t = e.target.closest('[data-tooltip]'); if (t === activeTarget) hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}

// ============================================================
// 11. Persistence + status
// ============================================================
function setSaveStatus(state_, text) {
  const pill = document.getElementById('save-status');
  pill.className = 'save-status ' + (state_ || '');
  setText('save-status-text', text);
}

function saveState() {
  try {
    setSaveStatus('saving', 'Saving…');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setSaveStatus('saved', 'Saved');
  } catch (e) {
    setSaveStatus('dirty', 'Save failed');
    console.warn(e);
  }
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    state = normalizeState(parsed);
    return true;
  } catch (e) {
    console.warn('Load failed', e);
    return false;
  }
}
// Treat imported files and browser storage as untrusted input. Only copy known
// fields into fresh objects; never recursively assign attacker-controlled keys.
function normalizeState(incoming) {
  const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!record(incoming)) throw new Error('Expected a state object.');
  if (incoming.schemaVersion != null && incoming.schemaVersion !== SCHEMA_VERSION) throw new Error('Unsupported schema version; expected version 4.');
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const numeric = (v, fallback, min = 0, max = 1e12) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
  const text = (v, fallback = '') => typeof v === 'string' ? v.slice(0, 10000) : fallback;
  const choice = (v, values, fallback) => values.includes(v) ? v : fallback;
  const clean = clone(DEFAULTS);
  const bounds = {
    'revenue.timeframeMonths': [1, 60], 'offer.avgRepeatOrders': [1, 20],
    'offer.monthlyChurn': [0, 100], 'offer.retentionMonths': [0.1, 120],
    'activity.workingDays': [1, 31], 'activity.callsPerHour': [1, 200],
    'activity.safetyMultiplier': [1, 5], 'capacity.maxHoursPerDay': [0, 24],
    'capacity.maxDialsPerDay': [0, 4800], 'solver.workingDays': [1, 31],
    'solver.callsPerHour': [1, 200], 'solver.hoursPerDay': [0, 24],
    'solver.dailyDials': [0, 4800],
  };
  for (const group of ['revenue', 'offer', 'funnel', 'activity', 'capacity', 'solver']) {
    if (!record(incoming[group]) || !own(incoming, group)) continue;
    for (const key of Object.keys(clean[group])) {
      if (typeof clean[group][key] !== 'number' || !own(incoming[group], key)) continue;
      const [min, max] = group === 'funnel' && GK_RATES.includes(key) ? [0, 100]
        : (bounds[group + '.' + key] || [0, 1e12]);
      clean[group][key] = numeric(incoming[group][key], clean[group][key], min, max);
    }
  }
  clean.activeTab = choice(incoming.activeTab, ['planner', 'solver', 'experiments'], clean.activeTab);
  clean.goalMode = choice(incoming.goalMode, ['A', 'B', 'C'], clean.goalMode);
  clean.funnel.direction = choice(incoming.funnel?.direction, ['forward', 'reverse'], clean.funnel.direction);
  clean.solver.mode = choice(incoming.solver?.mode, ['aov', 'maxRev', 'gk'], clean.solver.mode);
  clean.solver.gkSolveFor = choice(incoming.solver?.gkSolveFor, GK_RATES, clean.solver.gkSolveFor);
  const id = (v, fallback) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v) ? v : fallback;
  if (Array.isArray(incoming.scenarios)) {
    if (incoming.scenarios.length > 100) throw new Error('Maximum 100 scenarios per import.');
    const ids = new Set();
    clean.scenarios = incoming.scenarios.filter(record).map((sc, i) => {
      let scId = id(sc.id, 'import-sc-' + i);
      if (ids.has(scId)) scId = genId('sc');
      ids.add(scId);
      const out = { id: scId, name: text(sc.name, 'Imported scenario'),
        description: text(sc.description), type: choice(sc.type,
          ['conservative', 'realistic', 'bestCase', 'custom'], 'custom') };
      GK_RATES.forEach(k => { out[k] = numeric(sc[k], clean.funnel[k], 0, 100); });
      return out;
    });
    if (!clean.scenarios.length) clean.scenarios = clone(DEFAULTS.scenarios);
  }
  clean.activeScenarioId = clean.scenarios.some(s => s.id === incoming.activeScenarioId)
    ? incoming.activeScenarioId : clean.scenarios[0].id;
  if (Array.isArray(incoming.experiments)) {
    if (incoming.experiments.length > 200) throw new Error('Maximum 200 experiments per import.');
    const ids = new Set();
    clean.experiments = incoming.experiments.filter(record).map((exp, i) => {
      const out = newExperiment();
      for (const key of Object.keys(out)) {
        if (!own(exp, key)) continue;
        out[key] = typeof out[key] === 'number' ? numeric(exp[key], out[key]) : text(exp[key], out[key]);
      }
      out.result = exp.result === '' ? '' : numeric(exp.result, '', 0, 100);
      out.baseline = numeric(exp.baseline, 0, 0, 100);
      out.targetKpi = numeric(exp.targetKpi, 0, 0, 100);
      out.decision = choice(exp.decision, ['', 'keep', 'iterate', 'discard'], '');
      out.id = id(exp.id, 'import-exp-' + i);
      if (ids.has(out.id)) out.id = genId('exp');
      ids.add(out.id);
      return out;
    });
  }
  clean.revenue.targetAnnual = clean.revenue.targetMonthly * 12;
  clean.capacity.maxDialsPerDay = Math.round(clean.activity.callsPerHour * clean.capacity.maxHoursPerDay);
  clean.solver.dailyDials = Math.round(clean.solver.callsPerHour * clean.solver.hoursPerDay);
  return clean;
}
function resetDefaults() {
  if (!confirm('Reset all inputs to defaults? This clears your saved state and any custom scenarios / experiments.')) return;
  state = clone(DEFAULTS);
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  hydrateAllInputs();
  applyModeVisibility();
  switchTab('planner');
  recalcAndRender();
  setSaveStatus('saved', 'Reset');
}

// Debouncers
let recalcRaf = null;
function scheduleRecalc() {
  if (recalcRaf) return;
  recalcRaf = requestAnimationFrame(() => { recalcRaf = null; recalcAndRender(); });
}
let saveTimer = null;
function scheduleSave() {
  setSaveStatus('dirty', 'Unsaved…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);
}

// Export / Import
function exportJSON() {
  const payload = {
    exportedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    state,
    derived: deriveSummaryFlat(),
  };
  download('claritygate-metrics.json', JSON.stringify(payload, null, 2), 'application/json');
}
function exportCSV() {
  const d = deriveSummaryFlat();
  const sc = currentScenario();
  const rows = [
    ['Section','Metric','Value'],
    ['Meta',    'Schema version',     SCHEMA_VERSION],
    ['Meta',    'Goal mode',          state.goalMode],
    ['Meta',    'Active scenario',    sc ? sc.name : ''],
    ['Revenue', 'Target monthly (£)', state.revenue.targetMonthly],
    ['Revenue', 'Target annual (£)',  state.revenue.targetAnnual],
    ['Revenue', 'Current monthly (£)',state.revenue.currentMonthly],
    ['Revenue', 'Gap / month (£)',    d.gap],
    ['Revenue', 'Timeframe (months)', state.revenue.timeframeMonths],
    ['Offer',   'AOV (£)',            state.offer.aov],
    ['Offer',   'Avg repeat orders',  state.offer.avgRepeatOrders],
    ['Offer',   'Setup fee (£)',      state.offer.setupFee],
    ['Offer',   'MRR/client (£)',     state.offer.mrrPerClient],
    ['Offer',   'Monthly churn (%)',  state.offer.monthlyChurn],
    ['Activity','Working days/mo',    state.activity.workingDays],
    ['Activity','Calls/hour',         state.activity.callsPerHour],
    ['Activity','Safety multiplier',  state.activity.safetyMultiplier],
    ['Capacity','Max dials/day',      state.capacity.maxDialsPerDay],
    ['Capacity','Max hours/day',      state.capacity.maxHoursPerDay],
    ['Required','Clients/month',      d.clientsPerMonth],
    ['Required','Attended/mo',        d.attended],
    ['Required','Booked/mo',          d.booked],
    ['Required','Dials/mo',           d.dialsSafe],
    ['Required','Daily dials',        d.daily],
    ['Required','Productive hrs/day', d.hours],
    ['Efficiency','Revenue/dial (£)', d.revPerDial],
    ['Efficiency','Revenue/booked (£)', d.revPerBooked],
    ['Efficiency','Revenue/call (£)', d.revPerAttended],
    ['GatekeeperFunnel','Direction',          d.dfDirection],
    ['GatekeeperFunnel','PUR (%)',            state.funnel.pur],
    ['GatekeeperFunnel','GR (%)',             state.funnel.gr],
    ['GatekeeperFunnel','GBR (%)',            state.funnel.gbr],
    ['GatekeeperFunnel','QR (%)',             state.funnel.qr],
    ['GatekeeperFunnel','ABR (%)',            state.funnel.abr],
    ['GatekeeperFunnel','SUR (%)',            state.funnel.sur],
    ['GatekeeperFunnel','GFR (%)',            state.funnel.gfr],
    ['GatekeeperFunnel','SCR (%)',            state.funnel.scr],
    ['GatekeeperFunnel','Dials/mo',           d.dfDials],
    ['GatekeeperFunnel','Pick-ups/mo',        d.dfPickups],
    ['GatekeeperFunnel','Stakeholders/mo',    d.dfStakeholders],
    ['GatekeeperFunnel','Qualified/mo',       d.dfQualified],
    ['GatekeeperFunnel','Appointments/mo',    d.dfAppointments],
    ['GatekeeperFunnel','Sales calls/mo',     d.dfSalesCalls],
    ['GatekeeperFunnel','Pitches/mo',         d.dfPitches],
    ['GatekeeperFunnel','Clients/mo',         d.dfClients],
    ['GatekeeperFunnel','Projected revenue/mo (£)', d.dfProjectedRevenue],
  ];
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
  download('claritygate-metrics.csv', csv, 'text/csv');
}
function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  // Quote alone does not prevent formula execution in spreadsheet software.
  if (typeof v === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}
function importJSON(file) {
  if (file.size > 2 * 1024 * 1024) { alert('Import failed: maximum file size is 2 MB.'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const incoming = parsed.state || parsed;
      const next = normalizeState(incoming);
      state = next;
      hydrateAllInputs();
      applyModeVisibility();
      document.getElementById('solver-gk-select').value = state.solver.gkSolveFor;
      document.querySelectorAll('#solver-mode-switch button').forEach(b => b.classList.toggle('active', b.dataset.solve === state.solver.mode));
      switchTab(state.activeTab);
      recalcAndRender();
      saveState();
      flashButton('btn-import', 'Imported ✓');
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  };
  reader.onerror = () => alert('Could not read file.');
  reader.readAsText(file);
}

function deriveSummaryFlat() {
  const s = computeSummary();
  return {
    gap: s.gap,
    clientsPerMonth: s.cpm.clients,
    attended: s.f.attended,
    booked: s.f.booked,
    dials: s.f.dials,
    dialsSafe: s.f.dialsSafe,
    daily: s.a.daily,
    weekly: s.a.weekly,
    hours: s.a.hours,
    revPerDial: s.rp.perDial,
    revPerBooked: s.rp.perBooked,
    revPerAttended: s.rp.perAttended,
    // Detailed gatekeeper funnel
    dfDirection: s.det.direction,
    dfDials: s.det.dials,
    dfPickups: s.det.pickups,
    dfStakeholders: s.det.stakeholders,
    dfQualified: s.det.qualified,
    dfAppointments: s.det.appointments,
    dfSalesCalls: s.det.salesCalls,
    dfPitches: s.det.pitches,
    dfClients: s.det.clients,
    dfProjectedRevenue: s.det.projectedRevenue,
  };
}

// ============================================================
// 12. Input binding + mode visibility + metric guide
// ============================================================
function bindInputs() {
  document.querySelectorAll('[data-input]').forEach(row => {
    const path = row.getAttribute('data-input');
    const isText = row.getAttribute('data-input-type') === 'text';
    const inputs = row.querySelectorAll('input');
    if (isText) {
      const inp = inputs[0];
      inp.value = getPath(state, path) || '';
      inp.addEventListener('input', () => {
        setPath(state, path, inp.value);
        scheduleSave();
      });
      return;
    }
    const range  = row.querySelector('input[type="range"]');
    const number = row.querySelector('input[type="number"]');
    const setBoth = v => {
      if (range)  range.value  = v;
      if (number) number.value = v;
    };
    setBoth(getPath(state, path));
    const onChange = (src) => {
      let v = parseFloat(src.value);
      if (!isFinite(v)) v = 0;
      const min = src.min === '' ? 0 : Number(src.min);
      const max = src.max === '' ? 1e12 : Number(src.max);
      v = clamp(v, min, max);
      setPath(state, path, v);
      setBoth(v);
      applyLink(path, v);
      scheduleRecalc();
      scheduleSave();
    };
    if (range)  range.addEventListener('input', () => onChange(range));
    if (number) number.addEventListener('input', () => onChange(number));
  });
}
function syncBoundDom(path, value) { syncDom(path, value); }
function hydrateAllInputs() {
  document.querySelectorAll('[data-input]').forEach(row => {
    const path = row.getAttribute('data-input');
    const value = getPath(state, path);
    row.querySelectorAll('input').forEach(i => { i.value = value == null ? '' : value; });
  });
}

function bindModeSwitch() {
  const group = document.getElementById('goal-mode');
  group.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.goalMode = btn.getAttribute('data-mode');
      applyModeVisibility();
      recalcAndRender();
      scheduleSave();
    });
  });
  // Gatekeeper funnel direction toggle (reverse / forward) — affects only the
  // §4 projection panel + §5 diagram, never the headline (always reverse).
  const dgrp = document.getElementById('df-direction');
  if (dgrp) {
    dgrp.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        dgrp.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.funnel.direction = btn.getAttribute('data-direction');
        recalcAndRender();
        scheduleSave();
      });
    });
  }
}
function applyModeVisibility() {
  document.querySelectorAll('.mode-c').forEach(el => el.classList.toggle('collapsed', state.goalMode !== 'C'));
  const repeat = document.getElementById('repeat-orders-row');
  if (repeat) repeat.style.opacity = state.goalMode === 'B' ? '1' : '0.5';
  document.querySelectorAll('#goal-mode button').forEach(b => b.classList.toggle('active', b.getAttribute('data-mode') === state.goalMode));
}

// AOV presets
function bindAovPresets() {
  document.getElementById('aov-presets').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-val]');
    if (!btn) return;
    const v = parseFloat(btn.getAttribute('data-val'));
    state.offer.aov = v;
    syncDom('offer.aov', v);
    updateAovPresetActive();
    scheduleRecalc();
    scheduleSave();
  });
}
function updateAovPresetActive() {
  document.querySelectorAll('#aov-presets button').forEach(b => {
    b.classList.toggle('active', parseFloat(b.getAttribute('data-val')) === state.offer.aov);
  });
}

function renderMetricGuide() {
  const list = document.getElementById('metric-guide');
  list.innerHTML = (window.METRIC_GUIDE || []).map(item => `
    <div class="benchmark metric-reference">
      <div class="top"><span class="name">${escapeHtml(item.metric)}</span></div>
      <p class="metric-formula">${escapeHtml(item.formula)}</p>
      <div class="relevance">${escapeHtml(item.description)}</div>
    </div>
  `).join('');
}

function flashButton(id, msg) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = original; }, 1300);
}

// ============================================================
// 13. Init
// ============================================================
function init() {
  loadState();
  bindInputs();
  bindModeSwitch();
  bindTabs();
  bindModal();
  bindSolver();
  bindScenariosList();
  bindExperimentsList();
  bindAovPresets();
  applyModeVisibility();
  updateAovPresetActive();
  initTooltips();
  switchTab(state.activeTab || 'planner');

  // Wire solver buttons mode state to active class
  document.querySelectorAll('#solver-mode-switch button').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-solve') === state.solver.mode);
  });

  renderMetricGuide();
  recalcAndRender();
  setSaveStatus('saved', 'Saved');

  // Top-bar actions
  document.getElementById('btn-export-json').addEventListener('click', exportJSON);
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-reset').addEventListener('click', resetDefaults);

  const fileInput = document.getElementById('file-import');
  document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importJSON(file);
    e.target.value = '';
  });

  // AOV preset highlight when user types AOV
  const aovRow = document.querySelector('[data-input="offer.aov"]');
  if (aovRow) {
    aovRow.addEventListener('input', updateAovPresetActive);
  }
}

document.addEventListener('DOMContentLoaded', init);

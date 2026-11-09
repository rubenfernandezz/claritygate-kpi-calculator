const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ document: { addEventListener() {} }, console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'metrics-calculator.js'), 'utf8'), context);
const run = expression => vm.runInContext(expression, context);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' != ' + expected);

test('default gatekeeper branches reconcile and forward/reverse calculations agree', () => {
  near(run('gkComposite(DEFAULTS.funnel)'), 0.0021);
  near(run('calcDetailed.forward(1000, DEFAULTS.funnel).clients'), 2.1);
  near(run('calcDetailed.reverse(2.1, DEFAULTS.funnel).dials'), 1000);
  near(run('gkBranch(300, DEFAULTS.funnel).stakeholders'), 210);
  near(run('computeSummary(DEFAULTS).a.daily'), 5 / .0021 / 22);
});
test('revenue modes include setup fees and retainer acquisition plus churn replacement', () => {
  near(run('calc.clientsPerMonth({...clone(DEFAULTS), offer: {...DEFAULTS.offer, setupFee: 500}}).clients'), 4);
  near(run("calc.clientsPerMonth({...clone(DEFAULTS), goalMode:'B', offer: {...DEFAULTS.offer, avgRepeatOrders:2, setupFee:1000}}).clients"), 2);
  near(run("calc.clientsPerMonth({...clone(DEFAULTS), goalMode:'C', revenue:{...DEFAULTS.revenue,currentMonthly:2000,timeframeMonths:10}, offer:{...DEFAULTS.offer,mrrPerClient:1000,monthlyChurn:5}}).clients"), 1.3);
});
test('forward preview never changes reverse headline activity', () => {
  near(run("computeSummary({...clone(DEFAULTS),funnel:{...DEFAULTS.funnel,direction:'forward',forwardDials:1000}}).f.dials"), 5/.0021);
  near(run("computeSummary({...clone(DEFAULTS),funnel:{...DEFAULTS.funnel,direction:'forward',forwardDials:1000}}).det.clients"),2.1);
});
test('projection uses repeat-order value or new contracted MRR for its revenue mode', () => {
  near(run("computeSummary({...clone(DEFAULTS),goalMode:'B',offer:{...DEFAULTS.offer,avgRepeatOrders:2,setupFee:500},funnel:{...DEFAULTS.funnel,direction:'forward',forwardDials:1000}}).det.projectedRevenue"),9450);
  near(run("computeSummary({...clone(DEFAULTS),goalMode:'C',offer:{...DEFAULTS.offer,mrrPerClient:1000,setupFee:500},funnel:{...DEFAULTS.funnel,direction:'forward',forwardDials:1000}}).det.projectedRevenue"),2100);
});
test('unreachable positive targets are undefined; zero targets need no dials', () => {
  assert.equal(run('calcDetailed.reverse(1,{...DEFAULTS.funnel,scr:0}).dials'),Infinity);
  assert.equal(run('calcDetailed.reverse(0,{...DEFAULTS.funnel,scr:0}).dials'),0);
  assert.equal(run('calc.clientsPerMonth({...clone(DEFAULTS),offer:{...DEFAULTS.offer,aov:0}}).clients'),Infinity);
  assert.equal(run("calc.clientsPerMonth({...clone(DEFAULTS),goalMode:'C'}).clients"),Infinity);
  assert.equal(run('computeSummary({...clone(DEFAULTS),revenue:{...DEFAULTS.revenue,currentMonthly:10000}}).f.dials'),0);
});
test('monthly, weekly and daily activity reconcile', () => {
  near(run('calc.activity(1000,DEFAULTS.activity).weekly * 52/12'),1000);
  near(run('calc.activity(1000,DEFAULTS.activity).daily * 22'),1000);
  near(run('calc.activity(1000,DEFAULTS.activity).hours * 15 * 22'),1000);
});
test('each of the eight rate solvers recovers a feasible known solution', () => {
  for (const rate of ['pur','gr','gbr','qr','abr','sur','gfr','scr']) {
    near(run('solveGatekeeperRate('+JSON.stringify(rate)+',2.1,1000,DEFAULTS.funnel).pct'),run('DEFAULTS.funnel.'+rate));
    assert.equal(run('solveGatekeeperRate('+JSON.stringify(rate)+',2.1,1000,DEFAULTS.funnel).feasible'),true);
  }
  assert.equal(run("solveGatekeeperRate('gbr',1,1000,{...DEFAULTS.funnel,gr:0}).reason"),'no-gr');
  assert.equal(run("solveGatekeeperRate('gr',2,1000,{...DEFAULTS.funnel,gbr:100}).reason"),'gbr-full');
  assert.equal(run("solveGatekeeperRate('scr',100,1,DEFAULTS.funnel).feasible"),false);
});
test('imports allowlist fields and cannot pollute prototypes', () => {
  run('normalizeState(JSON.parse(\'{"__proto__":{"portfolioPolluted":true},"constructor":{"prototype":{"portfolioPolluted":true}},"funnel":{"__proto__":{"portfolioPolluted":true},"pur":200},"unknown":"discard"}\'))');
  assert.equal(run('({}).portfolioPolluted'),undefined);
  assert.equal(run('normalizeState({unknown:1}).unknown'),undefined);
  assert.equal(run('normalizeState({funnel:{pur:200,scr:-10}}).funnel.pur'),100);
  assert.equal(run('normalizeState({funnel:{pur:200,scr:-10}}).funnel.scr'),0);
});
test('imports reject root arrays/null and excessive collections; malformed values cannot enter markup', () => {
  for(const value of ['null','[]','"text"','{schemaVersion:999}']) assert.throws(()=>run('normalizeState('+value+')'));
  assert.throws(()=>run('normalizeState({scenarios:Array(101).fill({})})'));
  assert.throws(()=>run('normalizeState({experiments:Array(201).fill({})})'));
  assert.equal(run('normalizeState({scenarios:[]}).scenarios.length'),3);
  assert.equal(run('normalizeState({experiments:[{id:\'\"><img src=x>\',sampleSize:\'\"><img src=x>\',decision:\'<img src=x>\'}]}).experiments[0].sampleSize'),200);
  assert.equal(run('normalizeState({experiments:[{decision:\'<img src=x>\'}]}).experiments[0].decision'),'');
  assert.equal(run("normalizeState({activeTab:'missing'}).activeTab"),'planner');
});
test('exports round-trip supported state and linked identities remain consistent', () => {
  near(run('normalizeState(clone(DEFAULTS)).revenue.targetAnnual'),120000);
  near(run('normalizeState({revenue:{targetMonthly:5000},capacity:{maxHoursPerDay:2},activity:{callsPerHour:20}}).capacity.maxDialsPerDay'),40);
  near(run('normalizeState({solver:{hoursPerDay:2,callsPerHour:20}}).solver.dailyDials'),40);
  assert.deepEqual(JSON.parse(run('JSON.stringify(normalizeState(clone(DEFAULTS)))')),JSON.parse(run('JSON.stringify(DEFAULTS)')));
});
test('HTML escaping covers attribute boundaries; CSV neutralizes formula prefixes and CR', () => {
  assert.equal(run('escapeHtml(\'"<tag>&\\\'\')'),'&quot;&lt;tag&gt;&amp;&#39;');
  for(const v of ['=1+1',' +1','@SUM(1)','-1','\t=1']) {
    context.csvTest=v;
    assert.ok(run('csvCell(csvTest)').includes("'"));
  }
  assert.equal(run('csvCell(-1)'),'-1');
  assert.equal(run('csvCell("a\\rb")'),'"a\rb"');
});

test('sidebar feedback uses the entered funnel rather than external target rates', () => {
  const messages = run('generateRealityCheck(computeSummary()).map(item => item.text).join(" ")');
  assert.match(messages, /close at 20.0%/);
  assert.doesNotMatch(messages, /reference ~|target ~|industry/);
});

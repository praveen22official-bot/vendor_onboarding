// Run: node --test tests.js
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./engine.js');
const S = require('./scenarios.js');

const NOW = new Date('2026-10-26T12:00:00Z');
const DAY = 86400000;
const at = (d) => new Date(NOW.getTime() + d * DAY);
const clone = (o) => JSON.parse(JSON.stringify(o));
const world = () => S.build(NOW);
const get = (w, id) => w.scenarios.find((s) => s.id === id);
const open = (r) => r.checks.filter((c) => ['required', 'review', 'block'].includes(c.outcome));
const ids = (r) => open(r).map((c) => c.rule_id);

/** run all steps of a scenario through a case store, carrying the case id like a real resubmission */
function run(w, id, store) {
  const sc = get(w, id);
  store = store || new E.CaseStore({ context: w.context });
  let cid = null, out, outs = [];
  sc.steps.forEach((s, i) => {
    const sub = clone(s); if (cid) sub.case_id = cid;
    out = store.submit(sub, at(i)); cid = out.case.id; outs.push(out);
  });
  return { store, cid, out, outs, sc };
}

/* ------------------------------ validators ------------------------------ */
test('GSTIN: generated is valid; one mistyped character and a bad state code are rejected', () => {
  const g = E.gen.gstin('27AABCT1234F1Z');
  assert.equal(E.V.gstin(g).ok, true);
  assert.equal(E.V.gstin(g.slice(0, 14) + (g[14] === 'A' ? 'B' : 'A')).ok, false);
  assert.equal(E.V.gstin(E.gen.gstin('98AABCT1234F1Z')).ok, false);
  assert.equal(E.V.gstin(g).pan, 'AABCT1234F');
});
test('PAN: holder-type letter is enforced', () => {
  assert.equal(E.V.pan('AABCT1234F').ok, true);
  assert.equal(E.V.pan('AABDT1234F').ok, false);
  assert.equal(E.V.pan('AABC1234FF').ok, false);
});
test('IBAN, ABA, UK VAT, DE VAT checksums', () => {
  assert.equal(E.V.iban('DE89 3704 0044 0532 0130 00').ok, true);
  assert.equal(E.V.iban('DE89370400440532013001').ok, false);
  assert.equal(E.V.iban('DE8937040044053201300').ok, false); // wrong length
  assert.equal(E.V.aba('021000021').ok, true);
  assert.equal(E.V.aba('021000022').ok, false);
  assert.equal(E.V.ukVat(E.gen.ukVat('9807806')).ok, true);
  assert.equal(E.V.ukVat('GB980780685').ok, false);
  assert.equal(E.V.deVat(E.gen.deVat('13669597')).ok, true);
  assert.equal(E.V.deVat('DE136695977').ok, false);
});
test('EIN prefix table and SSN sanity', () => {
  assert.equal(E.V.ein('12-3456789').ok, true);
  assert.equal(E.V.ein('07-1234567').ok, false);
  assert.equal(E.V.ssn('666-12-3456').ok, false);
});
test('CIN: year inside the CIN must be plausible', () => {
  assert.equal(E.V.cin('U72900MH2018PTC310442').ok, true);
  assert.equal(E.V.cin('U72900MH2099PTC310442').ok, false);
});

/* ---------------------------- name matching ----------------------------- */
test('name matching tiers', () => {
  const m = E.nameMatch;
  assert.equal(m('Acme Solutions Pvt Ltd', 'ACME SOLUTIONS PRIVATE LIMITED').level, 'equivalent');
  assert.equal(m('Harbor & Pine Pvt Ltd', 'HARBOR AND PINE PRIVATE LIMITED').level, 'equivalent');
  assert.equal(m('Solutions Acme', 'Acme Solutions').level, 'equivalent');
  assert.equal(m('Acme Solutions', 'Acme Solutons').level, 'close');
  assert.equal(m('Acme Inc', 'Acme LLC').level, 'close');           // different legal form is not "the same"
  assert.equal(m('Pixelcraft', 'Pixelcraft Studio Pvt Ltd').level, 'partial');
  assert.equal(m('Rahul Deshpande', 'Crestwave Analytics').level, 'mismatch');
  assert.equal(m('', 'Acme').level, 'none');
});
test('wrong-country tax IDs are recognised', () => {
  const k = E.classifyTaxId('27AABCT1234F1Z8');
  assert.ok(k.some((x) => x.country === 'IN'));
  assert.ok(E.classifyTaxId('ABCPE1234F').some((x) => x.kind.includes('PAN')));
  assert.ok(E.classifyTaxId('GB980780684').some((x) => x.country === 'GB'));
});

/* ----------------------- baselines and edge cases ----------------------- */
test('every scenario ends as expected, and every finding cites a real rule', () => {
  const w = world();
  w.scenarios.forEach((sc) => {
    const { outs } = run(w, sc.id);
    const first = outs[0].result;
    const e = sc.expect;
    assert.equal(first.status, e.status, `${sc.id} first status`);
    if (e.waiting_on) assert.equal(first.waiting_on, e.waiting_on, `${sc.id} waiting_on`);
    (e.rules || []).forEach((r) => assert.ok(ids(first).includes(r), `${sc.id} should raise ${r}, got ${ids(first)}`));
    (e.conditions || []).forEach((c) => assert.ok(first.conditions.some((x) => x.code === c), `${sc.id} condition ${c}`));
    if (e.final) {
      const last = outs[outs.length - 1].result;
      assert.equal(last.status, e.final.status, `${sc.id} final status`);
      assert.equal(last.waiting_on, e.final.waiting_on, `${sc.id} final waiting_on`);
      e.final.rules.forEach((r) => assert.ok(ids(last).includes(r), `${sc.id} final should raise ${r}`));
    }
    outs.forEach((o) => o.result.checks.forEach((c) => assert.ok(E.RULES[c.rule_id], 'unknown rule ' + c.rule_id)));
  });
});
test('S1: wrong-country tax ID is called out by name; vendor message lists numbered, actionable items', () => {
  const w = world();
  const r = run(w, 'S1').out.result;
  assert.match(r.vendor_message.body, /PAN/);
  assert.ok(r.vendor_message.items.length >= 6);
  r.vendor_message.items.forEach((i) => { assert.ok(i.found && i.needed); });
});
test('S0: approved, nothing required, no conditions', () => {
  const r = run(world(), 'S0').out.result;
  assert.equal(r.status, 'approved');
  assert.equal(r.conditions.length, 0);
  assert.equal(r.internal.hold_payments, false);
});

test('E1a: missing GSTIN is valid for a sub-threshold sole proprietor: approved with conditions', () => {
  const r = run(world(), 'E1a').out.result;
  assert.equal(r.status, 'approved');
  assert.deepEqual(r.conditions.map((c) => c.code).sort(), ['NO_TAX_ON_INVOICE', 'REVERIFY', 'SPEND_CAP']);
  const cap = r.conditions.find((c) => c.code === 'SPEND_CAP');
  assert.equal(cap.amount, 1800000);
  assert.match(r.vendor_message.body, /don't charge GST/i);
});
test('E1b: exemption is credible on turnover but contradicted by our own spend', () => {
  const r = run(world(), 'E1b').out.result;
  assert.equal(r.status, 'pending'); assert.equal(r.waiting_on, 'vendor');
  assert.match(r.vendor_message.body, /register for GST/);
});
test('E1: turnover exactly at the threshold means registration is required', () => {
  const w = world();
  const sub = clone(get(w, 'E1a').steps[0]);
  sub.declarations.exemption_turnover.amount = 2000000;
  const r = E.evaluate(sub, { now: NOW, context: w.context });
  assert.ok(open(r).some((c) => c.rule_id === 'EXM-01' && /registration is required/.test(c.label)));
});
test('E1: claiming exemption while also giving a GSTIN is contradictory', () => {
  const w = world();
  const sub = clone(get(w, 'E1a').steps[0]);
  sub.tax.gstin = E.gen.gstin('32' + sub.tax.pan + '1Z');
  const r = E.evaluate(sub, { now: NOW, context: w.context });
  assert.ok(open(r).some((c) => c.rule_id === 'FMT-01' && /exempt/.test(c.detail)));
});

test('E2: round 2 fixed what we asked, but a quiet bank change is caught, held, and routed to the ORIGINAL contact', () => {
  const w = world();
  const { out, store, cid } = run(w, 'E2');
  const r = out.result;
  assert.equal(r.status, 'pending'); assert.equal(r.waiting_on, 'internal');
  assert.ok(ids(r).includes('CASE-01'));
  assert.equal(r.internal.hold_payments, true);
  assert.equal(r.priority, 'high');
  assert.equal(r.vendor_message.to, 'divya@crestwave.in');
  assert.match(r.vendor_message.body, /bank account number/);
  assert.doesNotMatch(r.vendor_message.body, /bank\.account/);
  // the legitimate fix itself passed
  assert.ok(!ids(r).includes('DOC-03') && !ids(r).includes('VER-02'));
  // reviewer needs a reason
  assert.throws(() => store.resolve(cid, { rule: 'CASE-01', decision: 'clear', by: 'a' }, at(3)), /note is required/);
  const ok = store.resolve(cid, { rule: 'CASE-01', decision: 'clear', by: 'priya', note: 'Called Divya on the number from round 1; new bank confirmed.' }, at(3));
  assert.equal(ok.result.status, 'approved');
  assert.ok(ok.result.conditions.some((c) => c.code === 'FIRST_PAYMENT_CHECK'));
  assert.ok(ok.case.audit.some((a) => a.event === 'review_cleared' && /Called Divya/.test(a.detail)));
});
test('E2: the same swap, rejected by the reviewer, ends the case', () => {
  const w = world();
  const { store, cid } = run(w, 'E2');
  const rej = store.resolve(cid, { rule: 'CASE-01', decision: 'reject', by: 'priya', note: 'Contact denies changing banks.' }, at(3));
  assert.equal(rej.result.status, 'rejected');
  assert.doesNotMatch(rej.result.vendor_message.body, /denies|fraud/i);
});
test('E2: a legitimate fix to a bank-holder mismatch (new company account) is NOT treated as a quiet change', () => {
  const w = world();
  const r1 = clone(get(w, 'S0').steps[0]);
  r1.bank.account_holder_name = 'Rohan Iyer';
  r1.documents.find((d) => d.declared_type === 'cancelled_cheque').extracted.holder_name = 'Rohan Iyer';
  const store = new E.CaseStore({ context: w.context });
  const a = store.submit(r1, NOW);
  assert.ok(ids(a.result).includes('XREF-01'));
  const r2 = clone(get(w, 'S0').steps[0]); r2.case_id = a.case.id; r2.bank.account_number = '50200099999999';
  r2.documents.find((d) => d.declared_type === 'cancelled_cheque').extracted.account_last4 = '9999';
  const b = store.submit(r2, at(1));
  assert.equal(b.result.status, 'approved');
  assert.ok(!ids(b.result).includes('CASE-01'));
});
test('E2: unchanged resubmissions loop to the round limit, then stop emailing and go to a person', () => {
  const w = world();
  const store = new E.CaseStore({ context: w.context });
  const s = get(w, 'S1').steps[0];
  let cid = null, last;
  for (let i = 0; i < 3; i++) { const sub = clone(s); if (cid) sub.case_id = cid; last = store.submit(sub, at(i)); cid = last.case.id; assert.ok(!ids(last.result).includes('CASE-01')); }
  assert.ok(ids(last.result).includes('CASE-02'));
  assert.equal(last.result.waiting_on, 'both');
});

test('E3: same-name-different-country watchlist hit is held silently; the vendor is told nothing', () => {
  const w = world();
  const { out, store, cid } = run(w, 'E3');
  const r = out.result;
  assert.equal(r.status, 'pending'); assert.equal(r.waiting_on, 'internal');
  assert.equal(r.internal.hold_payments, true);
  assert.equal(r.checks.filter((c) => c.rule_id === 'RISK-01' && c.outcome === 'review').length, 1, 'legal name + bank holder are one finding');
  assert.doesNotMatch(r.vendor_message.body, /sanction|watch|screen|denied|DL-|compliance/i);
  assert.equal(r.vendor_message.items.length, 0);
  const cleared = store.resolve(cid, { rule: 'RISK-01', decision: 'clear', by: 'compliance', note: 'Different entity: CIN, directors and address do not relate to the UAE entry.' }, at(2));
  assert.equal(cleared.result.status, 'approved');
});
test('S2: exact name + country match is a rejection with a neutral decline', () => {
  const r = run(world(), 'S2').out.result;
  assert.equal(r.status, 'rejected');
  assert.doesNotMatch(r.vendor_message.body, /sanction|watch|screen|denied|DL-|Kavak Trading is/i);
  assert.match(r.vendor_message.body, /unable to proceed/);
});

test('E4a: urgent bank change from a look-alike domain: high priority, hold, callback to the contact ON FILE', () => {
  const r = run(world(), 'E4a').out.result;
  assert.equal(r.status, 'pending'); assert.equal(r.priority, 'high');
  assert.equal(r.vendor_message.to, 'meera.rao@brightlinelogistics.in');
  assert.notEqual(r.vendor_message.to, 'accounts@brightline-logistics.in');
  const c = r.checks.find((x) => x.rule_id === 'RISK-05');
  assert.ok(c.evidence.signals.length >= 4);
  assert.ok(c.evidence.signals.some((s) => /look-alike/.test(s)));
  assert.match(c.detail, /business-email-compromise/);
  assert.match(r.internal.actions.join(' '), /number ON FILE/);
  assert.equal(r.internal.hold_payments, true);
});
test('E4b: even a calm, portal-authenticated bank change needs the callback (normal priority)', () => {
  const r = run(world(), 'E4b').out.result;
  assert.equal(r.status, 'pending'); assert.equal(r.priority, 'normal');
  assert.equal(r.internal.hold_payments, true);
});
test('E4: after a successful callback the change is approved with a first-payment condition', () => {
  const w = world();
  const { store, cid } = run(w, 'E4b');
  const r = store.resolve(cid, { rule: 'RISK-05', decision: 'clear', by: 'sam', note: 'Called Meera on +91 98450 11223; confirmed.' }, at(1));
  assert.equal(r.result.status, 'approved');
  assert.ok(r.result.conditions.some((c) => c.code === 'FIRST_PAYMENT_CHECK'));
});

/* ---------------------------- other behaviours --------------------------- */
test('registry outage does not penalise the vendor; it becomes a condition', () => {
  const w = world();
  const r = E.evaluate(get(w, 'S0').steps[0], { now: NOW, context: Object.assign({}, w.context, { registry: null }) });
  assert.equal(r.status, 'approved');
  assert.ok(r.conditions.some((c) => c.code === 'MANUAL_TAX_VERIFY'));
});
test('a cancelled GST registration is a rejection, and the vendor is told it can reapply', () => {
  const w = world();
  const sub = get(w, 'S0').steps[0];
  const g = sub.tax.gstin;
  w.context.registry[g] = { status: 'cancelled', status_since: '2026-03-01', legal_name: 'TESSERA ANALYTICS PRIVATE LIMITED' };
  const r = E.evaluate(sub, { now: NOW, context: w.context });
  assert.equal(r.status, 'rejected');
  assert.match(r.vendor_message.body, /cancelled/);
  assert.match(r.vendor_message.body, /submit again/);
});
test('sharing a bank account with a blocked vendor is a confidential rejection', () => {
  const w = world();
  const sub = clone(get(w, 'S0').steps[0]);
  Object.assign(sub.bank, { account_number: '60400099887766', ifsc: 'HDFC0001234' });
  sub.documents.find((d) => d.declared_type === 'cancelled_cheque').extracted.account_last4 = '7766';
  const r = E.evaluate(sub, { now: NOW, context: w.context });
  assert.equal(r.status, 'rejected');
  assert.doesNotMatch(r.vendor_message.body, /V-0877|blocked|fraud/i);
});
test('very new entity with a large contract goes to a person', () => {
  const w = world();
  const sub = clone(get(w, 'S0').steps[0]);
  sub.vendor.incorporation_date = new Date(NOW.getTime() - 40 * DAY).toISOString().slice(0, 10);
  sub.vendor.registration_number = 'U72900MH2026PTC310442';
  sub.request.estimated_annual_spend.amount = 9000000;
  const r = E.evaluate(sub, { now: NOW, context: w.context });
  assert.ok(ids(r).includes('XREF-07'));
});
test('GSTIN that embeds a different PAN is caught', () => {
  const w = world();
  const sub = clone(get(w, 'S0').steps[0]);
  sub.tax.gstin = E.gen.gstin('27AAECS9999Q1Z');
  const r = E.evaluate(sub, { now: NOW, context: w.context });
  assert.ok(ids(r).includes('XREF-04'));
});
test('bank proof for a different account is caught', () => {
  const w = world();
  const sub = clone(get(w, 'S0').steps[0]);
  sub.documents.find((d) => d.declared_type === 'cancelled_cheque').extracted.account_last4 = '0000';
  assert.ok(ids(E.evaluate(sub, { now: NOW, context: w.context })).includes('DOC-05'));
});
test('a wrong document uploaded under the right label is detected', () => {
  const w = world();
  const sub = clone(get(w, 'S0').steps[0]);
  sub.documents.find((d) => d.declared_type === 'gst_certificate').extracted.detected_type = 'pan_card';
  const r = E.evaluate(sub, { now: NOW, context: w.context });
  assert.ok(ids(r).includes('DOC-01'));
});
test('an expired document is refused; one expiring soon only adds a condition', () => {
  const w = world();
  const a = clone(get(w, 'S0').steps[0]);
  a.documents.find((d) => d.declared_type === 'gst_certificate').extracted.expires_on = '2026-01-01';
  assert.ok(ids(E.evaluate(a, { now: NOW, context: w.context })).includes('DOC-02'));
  const b = clone(get(w, 'S0').steps[0]);
  b.documents.find((d) => d.declared_type === 'gst_certificate').extracted.expires_on = new Date(NOW.getTime() + 10 * DAY).toISOString().slice(0, 10);
  const r = E.evaluate(b, { now: NOW, context: w.context });
  assert.equal(r.status, 'approved');
  assert.ok(r.conditions.length >= 1);
});
test('an empty submission does not crash and asks for everything', () => {
  const r = E.evaluate({}, { now: NOW });
  assert.equal(r.status, 'pending');
  assert.ok(r.vendor_message.items.length >= 5);
});
test('evaluation is deterministic', () => {
  const w = world();
  const a = E.evaluate(get(w, 'S1').steps[0], { now: NOW, context: w.context });
  const b = E.evaluate(get(w, 'S1').steps[0], { now: NOW, context: w.context });
  assert.deepEqual(a.checks, b.checks);
});
test('other countries: UK and German vendors validate and route by their own rules', () => {
  const w = world();
  const gb = {
    submission_id: 'GB1',
    vendor: { legal_name: 'Fenwick & Ross Ltd', country: 'GB', entity_type: 'company', registration_number: '01234567', incorporation_date: '2012-01-10', address: { line1: '1 High St', city: 'Leeds', postal_code: 'LS1 4AB', country: 'GB' }, contact: { name: 'Jo Fenwick', email: 'jo@fenwickross.co.uk', phone: '+44 113 496 0000' }, website: 'fenwickross.co.uk' },
    tax: { vat_number: E.gen.ukVat('9807806') },
    bank: { account_holder_name: 'Fenwick and Ross Limited', bank_name: 'Barclays', currency: 'GBP', sort_code: '20-00-00', account_number: '55779911' },
    declarations: { sanctions_clean: true, pep: false, beneficial_owners: [{ name: 'Jo Fenwick', ownership_pct: 100, country: 'GB' }] },
    request: { estimated_annual_spend: { amount: 30000, currency: 'GBP' } },
    documents: [
      { declared_type: 'certificate_of_incorporation', filename: 'coi.pdf', extracted: { detected_type: 'certificate_of_incorporation', legible: true, name: 'FENWICK & ROSS LIMITED', id_number: '01234567' } },
      { declared_type: 'vat_certificate', filename: 'vat.pdf', extracted: { detected_type: 'vat_certificate', legible: true, name: 'Fenwick & Ross Ltd', id_number: E.gen.ukVat('9807806') } },
      { declared_type: 'bank_letter', filename: 'bank.pdf', extracted: { detected_type: 'bank_letter', legible: true, holder_name: 'Fenwick and Ross Limited', account_last4: '9911', issued_on: '2026-10-01' } },
    ],
  };
  const reg = { [E.gen.ukVat('9807806')]: { status: 'active', legal_name: 'FENWICK & ROSS LIMITED' } };
  const r = E.evaluate(gb, { now: NOW, context: { registry: reg, vendors: [] } });
  assert.equal(r.status, 'approved', JSON.stringify(open(r).map((c) => c.detail)));
  const bad = clone(gb); bad.tax.vat_number = 'GB980780685';
  assert.ok(ids(E.evaluate(bad, { now: NOW, context: { registry: reg, vendors: [] } })).includes('FMT-01'));
});

/* ------------------------------- lifecycle ------------------------------ */
test('S3 timeline: reminder at day 7, final reminder at day 14, close at day 30; reopen inside 60 days', () => {
  const w = world();
  const store = new E.CaseStore({ context: w.context });
  const sc = get(w, 'S3');
  const first = store.submit(clone(sc.steps[0]), NOW);
  const cid = first.case.id;
  assert.equal(first.case.status, 'pending');
  assert.deepEqual(store.tick(at(6)), []);
  const d7 = store.tick(at(7));
  assert.equal(d7.length, 1); assert.equal(d7[0].type, 'reminder_1');
  assert.deepEqual(store.tick(at(7)), [], 'idempotent');
  const d14 = store.tick(at(14));
  assert.equal(d14.length, 1); assert.equal(d14[0].type, 'reminder_2');
  assert.match(d14[0].message.body, /16 days/);
  const d30 = store.tick(at(30));
  assert.equal(d30[0].type, 'expired');
  assert.equal(store.get(cid).status, 'rejected');
  assert.match(d30[0].message.body, /reopen/);
  const late = clone(sc.steps[1]); late.case_id = cid;
  const re = store.submit(late, at(45));
  assert.equal(re.result.status, 'approved');
  assert.ok(re.case.audit.some((a) => a.event === 'reopened'));
});
test('S3: a reply after the reopen window is refused (new application needed)', () => {
  const w = world();
  const store = new E.CaseStore({ context: w.context });
  const sc = get(w, 'S3');
  const cid = store.submit(clone(sc.steps[0]), NOW).case.id;
  store.tick(at(31));
  const late = clone(sc.steps[1]); late.case_id = cid;
  const re = store.submit(late, at(31 + 61));
  assert.equal(re.refused, true);
});
test('internal review that sits too long escalates once', () => {
  const w = world();
  const store = new E.CaseStore({ context: w.context });
  store.submit(clone(get(w, 'E3').steps[0]), NOW);
  assert.deepEqual(store.tick(at(2)), []);
  const ev = store.tick(at(3));
  assert.equal(ev[0].type, 'internal_overdue');
  assert.deepEqual(store.tick(at(5)), []);
});
test('a review clearance is bound to the evidence: if the vendor then changes the name, it is reviewed afresh', () => {
  const w = world();
  const store = new E.CaseStore({ context: w.context });
  const a = store.submit(clone(get(w, 'E3').steps[0]), NOW);
  store.resolve(a.case.id, { rule: 'RISK-01', decision: 'clear', by: 'c', note: 'different entity' }, at(1));
  const sub = clone(get(w, 'E3').steps[0]); sub.case_id = a.case.id;
  const r = store.submit(sub, at(2));
  assert.equal(r.result.status, 'approved', 'same facts: the earlier clearance still applies');
});

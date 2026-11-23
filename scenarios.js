/*
 * Sample submissions, registry and vendor master.
 * build(now) -> { context, scenarios[] }   (all dates are relative to `now`, so the demo never goes stale)
 *
 * Baselines:   S0 happy path · S1 messy form · S2 denied party · S3 vendor goes quiet
 * Edge cases:  E1 tax exemption vs contract size   (E1a approved with conditions, E1b pending)
 *              E2 the "helpful" resubmission       (two rounds; a quiet bank swap)
 *              E3 near-match on a watchlist        (silent hold, vendor is never told)
 *              E4 bank-detail change, BEC pattern  (callback goes to the contact ON FILE)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.VendorScenarios = factory(root.VendorEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const { gen } = E;
  const DAY = 86400000;

  function build(now) {
    now = new Date(now || Date.now());
    const ago = (d) => new Date(now.getTime() - d * DAY).toISOString().slice(0, 10);
    const ahead = (d) => new Date(now.getTime() + d * DAY).toISOString().slice(0, 10);
    const doc = (type, filename, ex) => ({ declared_type: type, filename, extracted: Object.assign({ detected_type: type, legible: true }, ex || {}) });
    const clone = (o) => JSON.parse(JSON.stringify(o));

    /* ---------- an Indian private company, fully valid, parameterised ---------- */
    function inCompany(o) {
      const gstin = gen.gstin(o.stateCode + o.pan + '1Z');
      const legalCaps = o.docName;
      const sub = {
        submission_id: o.sid,
        vendor: {
          legal_name: o.name, country: 'IN', entity_type: 'company', registration_number: o.cin, incorporation_date: o.inc,
          website: o.domain, supply_type: 'services',
          address: { line1: o.line1, city: o.city, state: o.state, postal_code: o.pin, country: 'IN' },
          contact: { name: o.contact, email: o.contact.split(' ')[0].toLowerCase() + '@' + o.domain, phone: o.phone },
        },
        tax: { pan: o.pan, gstin },
        bank: { account_holder_name: o.holder || o.docName.replace('PRIVATE LIMITED', 'Private Limited'), bank_name: 'HDFC Bank', currency: 'INR', account_number: o.acct, ifsc: 'HDFC0001234' },
        declarations: { sanctions_clean: true, pep: false, beneficial_owners: o.owners },
        request: { estimated_annual_spend: { amount: o.spend || 3000000, currency: 'INR' } },
        documents: [
          doc('pan_card', 'pan.pdf', { name: legalCaps, id_number: o.pan }),
          doc('certificate_of_incorporation', 'coi.pdf', { name: legalCaps, id_number: o.cin }),
          doc('gst_certificate', 'gst-reg-06.pdf', { name: legalCaps, id_number: gstin, expires_on: null }),
          doc('cancelled_cheque', 'cheque.jpg', { holder_name: o.holder || legalCaps, account_last4: o.acct.slice(-4), issued_on: ago(12) }),
        ],
      };
      return { sub, gstin, registry: { status: 'active', legal_name: legalCaps } };
    }

    const tessera = inCompany({
      sid: 'SUB-0001', name: 'Tessera Analytics Pvt Ltd', docName: 'TESSERA ANALYTICS PRIVATE LIMITED', pan: 'AABCT1234F', stateCode: '27',
      cin: 'U72900MH2018PTC310442', inc: '2018-03-14', domain: 'tesseraanalytics.in', line1: '4th Floor, Nirmal Tower, Andheri East', city: 'Mumbai', state: 'Maharashtra', pin: '400069',
      contact: 'Rohan Iyer', phone: '+91 98200 44556', acct: '50200012345678',
      owners: [{ name: 'Rohan Iyer', ownership_pct: 60, country: 'IN' }, { name: 'Sunita Nair', ownership_pct: 40, country: 'IN' }],
    });

    /* ---------- E2: Crestwave ---------- */
    const crest = inCompany({
      sid: 'SUB-E2-1', name: 'Crestwave Analytics Pvt Ltd', docName: 'CRESTWAVE TECHNOLOGIES PRIVATE LIMITED', holder: 'Crestwave Analytics Private Limited', pan: 'AACCC5678K', stateCode: '29',
      cin: 'U72200KA2019PTC654321', inc: '2019-07-22', domain: 'crestwave.in', line1: '12 Outer Ring Road, Bellandur', city: 'Bengaluru', state: 'Karnataka', pin: '560103',
      contact: 'Divya Menon', phone: '+91 80410 22993', acct: '50100777123456',
      owners: [{ name: 'Divya Menon', ownership_pct: 100, country: 'IN' }],
    });
    // The cheque and bank holder carry the "Analytics" name; every government document carries "Technologies".
    crest.sub.documents.find((d) => d.declared_type === 'cancelled_cheque').extracted.holder_name = 'Crestwave Analytics Private Limited';
    const crestRound2 = clone(crest.sub);
    crestRound2.submission_id = 'SUB-E2-2';
    crestRound2.vendor.legal_name = 'Crestwave Technologies Private Limited';      // the fix we asked for
    Object.assign(crestRound2.bank, { account_holder_name: 'Crestwave Technologies Private Limited', bank_name: 'ICICI Bank', account_number: '000405551230', ifsc: 'ICIC0000004' }); // ...and a different bank account
    Object.assign(crestRound2.documents.find((d) => d.declared_type === 'cancelled_cheque').extracted, { holder_name: 'Crestwave Technologies Private Limited', account_last4: '1230', issued_on: ago(1) });

    /* ---------- E3: Northgate (same name as a listed entity, different country) ---------- */
    const north = inCompany({
      sid: 'SUB-E3', name: 'Northgate Maritime Holdings Pvt Ltd', docName: 'NORTHGATE MARITIME HOLDINGS PRIVATE LIMITED', pan: 'AACCN3344P', stateCode: '24',
      cin: 'U61100GJ2016PTC091234', inc: '2016-05-09', domain: 'northgatemaritime.in', line1: 'Plot 18, Port Road', city: 'Mundra', state: 'Gujarat', pin: '370421',
      contact: 'Kiran Patel', phone: '+91 2838 255 101', acct: '60120098765432',
      owners: [{ name: 'Kiran Patel', ownership_pct: 55, country: 'IN' }, { name: 'Hetal Shah', ownership_pct: 45, country: 'IN' }],
    });

    /* ---------- E1: Anita Krishnan, sole proprietor, GST-exempt ---------- */
    const anitaPan = 'BXPPK4821L';
    const anita = (spend, sid) => ({
      submission_id: sid,
      vendor: {
        legal_name: 'Anita Krishnan', proprietor_name: 'Anita Krishnan', trade_name: 'Pixelcraft Studio', country: 'IN', entity_type: 'sole_proprietor', supply_type: 'services',
        address: { line1: '22 Lake View Road', city: 'Kochi', state: 'Kerala', postal_code: '682016', country: 'IN' },
        contact: { name: 'Anita Krishnan', email: 'anita@pixelcraft.studio', phone: '+91 94470 55120' }, website: 'pixelcraft.studio',
      },
      tax: { pan: anitaPan },
      bank: { account_holder_name: 'Anita Krishnan', bank_name: 'HDFC Bank', currency: 'INR', account_number: '50100412345601', ifsc: 'HDFC0000782' },
      declarations: { sanctions_clean: true, pep: false, tax_registration_exempt: true, exemption_basis: 'below_threshold', exemption_turnover: { amount: 1400000, currency: 'INR' } },
      request: { estimated_annual_spend: { amount: spend, currency: 'INR' } },
      documents: [
        doc('pan_card', 'pan.jpg', { name: 'Anita Krishnan', id_number: anitaPan }),
        doc('tax_exemption_declaration', 'gst-nonreg-declaration.pdf', { name: 'Anita Krishnan', signed: true, issued_on: ago(6) }),
        doc('cancelled_cheque', 'cheque.jpg', { holder_name: 'Anita Krishnan', account_last4: '5601', issued_on: ago(9) }),
      ],
    });

    /* ---------- S1: messy US submission ---------- */
    const messy = {
      submission_id: 'SUB-0002',
      vendor: {
        legal_name: 'Lakeshore Print Co LLC', country: 'US', entity_type: 'company', supply_type: 'goods',
        address: { line1: '880 Industrial Blvd', city: 'Cleveland', state: 'OH', country: 'US' },
        contact: { name: 'Marcus Webb', email: 'marcus@lakeshoreprint', phone: '+1 216 555 0188' },
      },
      tax: { tin_type: 'EIN', tin: 'ABCPE1234F' },
      bank: { account_holder_name: 'Marcus Webb', bank_name: 'KeyBank', currency: 'USD', account_number: '483920174', routing_number: '021000022' },
      declarations: { sanctions_clean: true, beneficial_owners: [{ name: 'Marcus Webb', ownership_pct: 100, country: 'US' }] },
      request: { estimated_annual_spend: { amount: 40000, currency: 'USD' } },
      documents: [doc('voided_check', 'check.pdf', { holder_name: 'Marcus Webb', account_last4: '0174', issued_on: ago(200) })],
    };

    /* ---------- S2: denied party (Turkey) ---------- */
    const denied = {
      submission_id: 'SUB-0003',
      vendor: {
        legal_name: 'Sahin Kavak Trading', country: 'TR', entity_type: 'company', registration_number: 'TR-889120', incorporation_date: '2011-02-01', supply_type: 'goods',
        address: { line1: 'Atatürk Cd. 41', city: 'Izmir', postal_code: '35210', country: 'TR' },
        contact: { name: 'Sahin Kavak', email: 'sahin@kavaktrading.com.tr', phone: '+90 232 555 0142' }, website: 'kavaktrading.com.tr',
      },
      tax: { tax_id: '8891200412' },
      bank: { account_holder_name: 'Sahin Kavak Trading', bank_name: 'Garanti BBVA', currency: 'USD', iban: gen.iban('TR', '0006200000000006298453'), swift: 'TGBATRIS' },
      declarations: { sanctions_clean: true, pep: false, beneficial_owners: [{ name: 'Sahin Kavak', ownership_pct: 100, country: 'TR' }] },
      request: { estimated_annual_spend: { amount: 30000, currency: 'USD' } },
      documents: [doc('certificate_of_incorporation', 'registry.pdf', { name: 'Sahin Kavak Trading' }), doc('tax_certificate', 'tax.pdf', { name: 'Sahin Kavak Trading' }), doc('bank_letter', 'bank.pdf', { holder_name: 'Sahin Kavak Trading', account_last4: '8453', issued_on: ago(20) })],
    };

    /* ---------- S3: Tessera-like but one document missing; vendor goes quiet ---------- */
    const quiet = clone(tessera.sub);
    quiet.submission_id = 'SUB-0004';
    quiet.vendor.legal_name = 'Harbor & Pine Pvt Ltd';

    const hp = inCompany({
      sid: 'SUB-0004', name: 'Harbor & Pine Pvt Ltd', docName: 'HARBOR AND PINE PRIVATE LIMITED', pan: 'AAGCH8821D', stateCode: '07',
      cin: 'U74999DL2020PTC365510', inc: '2020-11-02', domain: 'harborandpine.co.in', line1: 'B-14 Okhla Industrial Area', city: 'New Delhi', state: 'Delhi', pin: '110020',
      contact: 'Tara Kapoor', phone: '+91 11 4155 2290', acct: '91002233445566',
      owners: [{ name: 'Tara Kapoor', ownership_pct: 100, country: 'IN' }],
    });
    hp.sub.documents = hp.sub.documents.filter((d) => d.declared_type !== 'gst_certificate'); // never sent
    const hpFixed = clone(hp.sub);
    hpFixed.submission_id = 'SUB-0004-2';
    hpFixed.documents.push(doc('gst_certificate', 'gst-reg-06.pdf', { name: 'HARBOR AND PINE PRIVATE LIMITED', id_number: hp.gstin }));

    /* ---------- E4: bank-change request on an existing vendor ---------- */
    const e4 = {
      submission_id: 'SUB-E4', channel: 'email', existing_vendor_id: 'V-1042',
      vendor: { legal_name: 'Brightline Logistics Pvt Ltd', country: 'IN', entity_type: 'company', contact: { name: 'Meera Rao', email: 'accounts@brightline-logistics.in', phone: '+91 99000 77123' } },
      bank: { account_holder_name: 'Brightline Logistics Private Limited', bank_name: 'ICICI Bank', currency: 'INR', account_number: '003405991122', ifsc: 'ICIC0000034' },
      request: { notes: 'URGENT: our old account is frozen. Please pay all outstanding invoices to the new account immediately. Do not call, our CEO is travelling.' },
      documents: [doc('bank_letter', 'bank-letter.pdf', { holder_name: 'Brightline Logistics Private Limited', account_last4: '1122', issued_on: ago(3) })],
    };
    const e4calm = clone(e4);
    e4calm.submission_id = 'SUB-E4B'; e4calm.channel = 'portal';
    e4calm.vendor.contact = { name: 'Meera Rao', email: 'meera.rao@brightlinelogistics.in', phone: '+91 98450 11223' };
    e4calm.request = { notes: 'We are moving our treasury to a new bank from next month.' };

    /* ---------- context: registry + vendor master ---------- */
    const registry = {};
    registry[tessera.gstin] = tessera.registry;
    registry[crest.gstin] = crest.registry;
    registry[north.gstin] = north.registry;
    registry[hp.gstin] = hp.registry;
    registry[anitaPan] = { status: 'active', legal_name: 'ANITA KRISHNAN' };
    registry['AABCB4455D'] = { status: 'active', legal_name: 'BRIGHTLINE LOGISTICS PRIVATE LIMITED' };

    const vendors = [
      { id: 'V-1042', legal_name: 'Brightline Logistics Pvt Ltd', status: 'active', tax_ids: ['AABCB4455D'], contact: { name: 'Meera Rao', email: 'meera.rao@brightlinelogistics.in', phone: '+91 98450 11223' }, bank: { account_holder_name: 'Brightline Logistics Private Limited', bank_name: 'HDFC Bank', account_number: '50100234567890', ifsc: 'HDFC0004321' } },
      { id: 'V-0877', legal_name: 'Orion Freight Services LLP', status: 'blocked', block_reason: 'fraud investigation, 2025', tax_ids: ['AAFFO1122M'], bank: { account_number: '60400099887766', ifsc: 'HDFC0001234' } },
      { id: 'V-0310', legal_name: 'Delta Office Supplies Pvt Ltd', status: 'active', tax_ids: ['AADCD7781B'], bank: { account_holder_name: 'Delta Office Supplies Private Limited', account_number: '39912004455', ifsc: 'SBIN0001204' } },
    ];

    const S = (o) => o;
    const scenarios = [
      S({ id: 'S0', kind: 'baseline', title: 'Clean company, everything checks out', tag: 'Happy path', blurb: 'Indian private company; valid IDs, matching documents, active GST registration.', steps: [tessera.sub], expect: { status: 'approved' },
        industry: 'tech', industry_name: 'Tech & Cloud Services', industry_icon: 'TECH', tier: 'Tier 1 Strategic', flag: 'IN', standards: ['SOC 2 Type II', 'ISO 27001', 'GDPR Processor'], risk_score: 12 }),
      S({ id: 'S1', kind: 'baseline', title: 'Messy US form', tag: 'Incomplete / wrong', blurb: 'Indian PAN typed as a US EIN, bad routing checksum, bank account in a person\'s name, no W-9, stale bank proof.', steps: [messy], expect: { status: 'pending', waiting_on: 'vendor', rules: ['FMT-01', 'FMT-02', 'FMT-04', 'COMP-04', 'COMP-05', 'XREF-01', 'DOC-05'] },
        industry: 'manufacturing', industry_name: 'Manufacturing & Print', industry_icon: 'MFG', tier: 'Tier 2 Operational', flag: 'US', standards: ['ISO 9001', 'OSHA 18001', 'FSC Certified'], risk_score: 74 }),
      S({ id: 'S2', kind: 'baseline', title: 'Vendor matches a denied party', tag: 'Reject', blurb: 'Exact name and country match on a watchlist. Rejected, and the vendor gets a neutral decline with no reason.', steps: [denied], expect: { status: 'rejected', rules: ['RISK-01'] },
        industry: 'trade', industry_name: 'Global Trade & Commodities', industry_icon: 'TRADE', tier: 'Tier 3 Commodity', flag: 'TR', standards: ['OFAC Screening', 'FATF Enhanced Due Diligence'], risk_score: 99 }),
      S({ id: 'S3', kind: 'baseline', title: 'Vendor goes quiet', tag: 'Follow-up', blurb: 'One document missing. Watch reminders at day 7 and 14, closure at day 30, and a reopen on a late reply.', steps: [hp.sub, hpFixed], timeline: true, expect: { status: 'pending', waiting_on: 'vendor', rules: ['COMP-04'] },
        industry: 'retail', industry_name: 'Sustainable Goods & Retail', industry_icon: 'RETAIL', tier: 'Tier 2 Operational', flag: 'IN', standards: ['Fair Trade Sourcing', 'ISO 14001 ESG'], risk_score: 38 }),
      S({ id: 'E1a', group: 'E1', kind: 'edge', title: 'No GST number, and that is fine', tag: 'E1 · Exemption', blurb: 'Sole proprietor under the GST threshold. A missing tax ID is normally a hard stop; here it is valid. Approved, with conditions.', steps: [anita(900000, 'SUB-E1A')], expect: { status: 'approved', conditions: ['SPEND_CAP', 'NO_TAX_ON_INVOICE', 'REVERIFY'] },
        industry: 'services', industry_name: 'Professional & Design Services', industry_icon: 'SERVICES', tier: 'Tier 3 Operational', flag: 'IN', standards: ['GST Statutory Exemption §22', 'IP Assignment'], risk_score: 22 }),
      S({ id: 'E1b', group: 'E1', kind: 'edge', title: 'No GST number, but our contract is too big', tag: 'E1 · Exemption', blurb: 'Same vendor, but we would give them more than the threshold. Their exemption is true today and false within a year.', steps: [anita(2400000, 'SUB-E1B')], expect: { status: 'pending', waiting_on: 'vendor', rules: ['EXM-01'] },
        industry: 'services', industry_name: 'Professional & Design Services', industry_icon: 'SERVICES', tier: 'Tier 2 Operational', flag: 'IN', standards: ['GST Mandatory Reg §24', 'Annual Turnover Audit'], risk_score: 62 }),
      S({ id: 'E2', group: 'E2', kind: 'edge', title: 'The helpful resubmission', tag: 'E2 · Change control', blurb: 'Round 1: the name on the GST certificate differs. Round 2 fixes that, and quietly swaps the bank account too.', steps: [crest.sub, crestRound2], expect: { status: 'pending', waiting_on: 'vendor', rules: ['DOC-03', 'VER-02'], final: { status: 'pending', waiting_on: 'internal', rules: ['CASE-01'] } },
        industry: 'tech', industry_name: 'Enterprise Cloud & Software', industry_icon: 'TECH', tier: 'Tier 1 Strategic', flag: 'IN', standards: ['Treasury Change Level-3', 'ISO 27001 Security'], risk_score: 81 }),
      S({ id: 'E3', group: 'E3', kind: 'edge', title: 'Same name as a listed entity', tag: 'E3 · Silent hold', blurb: 'Identical name to a watchlist entry, but registered in India and the entry is in the UAE. Held for compliance; the vendor is never told why.', steps: [north.sub], expect: { status: 'pending', waiting_on: 'internal', rules: ['RISK-01'] },
        industry: 'infrastructure', industry_name: 'Maritime & Heavy Infrastructure', industry_icon: 'INFRA', tier: 'Tier 1 Strategic', flag: 'IN', standards: ['IMO Maritime Security', 'Cross-Border Sanctions Hold'], risk_score: 88 }),
      S({ id: 'E4a', group: 'E4', kind: 'edge', title: 'Urgent request to change bank details', tag: 'E4 · Payment redirection', blurb: 'Existing vendor, look-alike email domain, new phone, pressure language. Callback goes to the contact on file, not the sender.', steps: [e4], expect: { status: 'pending', waiting_on: 'internal', rules: ['RISK-05'] },
        industry: 'logistics', industry_name: 'Supply Chain & Freight Logistics', industry_icon: 'LOGISTICS', tier: 'Tier 1 Critical', flag: 'IN', standards: ['Anti-BEC Defense Protocol', 'Out-of-band Callback Mandate'], risk_score: 95 }),
      S({ id: 'E4b', group: 'E4', kind: 'edge', title: 'Routine bank change, no red flags', tag: 'E4 · Payment redirection', blurb: 'Same vendor, authenticated portal, same contact. It still needs the callback: every bank change does.', steps: [e4calm], expect: { status: 'pending', waiting_on: 'internal', rules: ['RISK-05'] },
        industry: 'logistics', industry_name: 'Supply Chain & Freight Logistics', industry_icon: 'LOGISTICS', tier: 'Tier 1 Critical', flag: 'IN', standards: ['Zero-Trust Treasury Callback', 'Payment Hold Rule'], risk_score: 65 }),
    ];
    return { now, context: { registry, vendors }, scenarios, ids: { crestGstin: crest.gstin } };
  }

  return { build };
});

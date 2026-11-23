/*
 * Vendor onboarding rules engine
 * ------------------------------
 * evaluate(submission, opts)  -> { status, reasons, checks[], vendor_message, internal, conditions, audit }
 * CaseStore                   -> lifecycle: rounds, change control, reminders, expiry, manual resolution
 *
 * Pure JS, no dependencies. Runs in Node and in the browser (UMD).
 * Every decision is the sum of named checks (RULES). Nothing is hidden: each check is returned
 * with its outcome, its reasoning, and the fields it looked at.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VendorEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* =====================================================================
   * 1. CONFIG  (everything a compliance team would want to tune)
   * ===================================================================== */
  const CONFIG = {
    buyer: 'Procurement',
    max_rounds: 3,
    sla: { reminder1_days: 7, reminder2_days: 14, expire_days: 30, internal_days: 3, reopen_window_days: 60 },
    bank_proof_max_age_days: 90,
    doc_expiry_warn_days: 30,
    new_entity_days: 180,
    // A brand-new entity asking for more than this per year gets a human look.
    new_entity_spend: { INR: 5000000, USD: 60000, EUR: 55000, GBP: 50000 },
    // Tax-registration exemption thresholds (demo values; set from your tax team).
    exemption: {
      IN: { label: 'GST', authority: 'GST', goods: 4000000, services: 2000000, currency: 'INR', watch_pct: 0.5, cap_pct: 0.9 },
      GB: { label: 'VAT', authority: 'VAT', goods: 90000, services: 90000, currency: 'GBP', watch_pct: 0.5, cap_pct: 0.9 },
      DE: { label: 'Kleinunternehmer', authority: 'VAT', goods: 25000, services: 25000, currency: 'EUR', watch_pct: 0.5, cap_pct: 0.9 },
    },
    // DEMO lists. Replace with your compliance team's lists / screening provider.
    embargoed_countries: ['KP', 'IR', 'SY', 'CU'],
    sanctions_list: [
      { id: 'DL-0412', name: 'Northgate Maritime Holdings', aliases: ['Northgate Shipping Co'], country: 'AE', type: 'entity', list: 'DEMO watchlist A' },
      { id: 'DL-0877', name: 'Viktor Rademacher', aliases: [], country: 'DE', type: 'individual', list: 'DEMO watchlist A' },
      { id: 'DL-1033', name: 'Sahin Kavak Trading', aliases: [], country: 'TR', type: 'entity', list: 'DEMO watchlist B' },
    ],
    free_email_domains: ['gmail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'proton.me', 'protonmail.com', 'rediffmail.com', 'aol.com', 'icloud.com'],
    urgency_terms: /\b(urgent|urgently|immediately|asap|right away|ceo|do not call|don't call|cannot be reached|can't be reached|overdue|final notice|today only)\b/i,
  };

  /* =====================================================================
   * 2. RULE CATALOGUE (the rule book; every emitted check cites one of these)
   * ===================================================================== */
  const CATEGORIES = ['Completeness', 'Format', 'Consistency', 'Documents', 'Verification', 'Exemption', 'Risk', 'Lifecycle'];
  const R = (category, title, desc) => ({ category, title, desc });
  const RULES = {
    'COMP-01': R('Completeness', 'Vendor details complete', 'Legal name, country, entity type, address and contact are present.'),
    'COMP-02': R('Completeness', 'Tax details complete', 'Every tax identifier required for the vendor\'s country is present (or a valid exemption is claimed).'),
    'COMP-03': R('Completeness', 'Bank details complete', 'Holder, bank, currency and the country-specific routing identifiers are present.'),
    'COMP-04': R('Completeness', 'Required documents attached', 'Each document required for this country and entity type is attached.'),
    'COMP-05': R('Completeness', 'Declarations answered', 'Sanctions and PEP declarations answered; beneficial owners declared for companies.'),
    'FMT-01': R('Format', 'Tax ID valid for the country', 'Format and checksum of PAN / GSTIN / EIN / SSN / UK VAT / DE USt-IdNr. Detects IDs from the wrong country.'),
    'FMT-02': R('Format', 'Bank identifiers valid', 'IFSC, ABA routing checksum, IBAN mod-97, UK sort code and account number formats.'),
    'FMT-03': R('Format', 'Company registration number valid', 'CIN / LLPIN, UK company number, German commercial-register number.'),
    'FMT-04': R('Format', 'Contact details well-formed', 'Email address is syntactically valid.'),
    'XREF-01': R('Consistency', 'Bank account holder matches legal name', 'Tiered name match: identical / equivalent / typo / shortened (trade name) / different (third party).'),
    'XREF-02': R('Consistency', 'Bank country matches vendor country', 'An account in a different country than the vendor\'s registration needs an explanation.'),
    'XREF-03': R('Consistency', 'Bank code matches bank name', 'IFSC bank prefix must belong to the bank the vendor named.'),
    'XREF-04': R('Consistency', 'Tax IDs agree with each other', 'GSTIN embeds the PAN; PAN holder-type matches entity type; GST state vs. address.'),
    'XREF-05': R('Consistency', 'Registration number fits the entity', 'CIN year matches incorporation date; incorporation date is not in the future.'),
    'XREF-06': R('Consistency', 'Address / phone / email coherent', 'Address country, phone prefix and email domain make sense for the vendor.'),
    'XREF-07': R('Consistency', 'Trading history fits requested spend', 'A very new entity with a large expected spend goes to a human.'),
    'DOC-01': R('Documents', 'Document is what it claims to be', 'Detected document type equals the declared type; file is legible and parsed.'),
    'DOC-02': R('Documents', 'Document is in date', 'Not expired; flags documents that expire soon.'),
    'DOC-03': R('Documents', 'Name on document matches legal name', 'Tiered name match between the document and the submitted legal name.'),
    'DOC-04': R('Documents', 'Number on document matches submission', 'The ID printed on the document equals the ID typed in the form.'),
    'DOC-05': R('Documents', 'Bank proof is recent and matches account', 'Age, account number tail and holder name on the bank proof.'),
    'DOC-06': R('Documents', 'Document integrity signals', 'Any tamper/alteration signal from document analysis goes to a human.'),
    'VER-01': R('Verification', 'Tax registration confirmed active', 'Lookup in the tax registry: active, cancelled/suspended, or not found.'),
    'VER-02': R('Verification', 'Registered name matches', 'The name on the registry equals the submitted legal name.'),
    'EXM-01': R('Exemption', 'Tax-registration exemption is supported', 'A vendor claiming it need not register must be below the threshold, declare turnover, and not contradict our expected spend.'),
    'RISK-01': R('Risk', 'Sanctions / watchlist screening', 'Vendor, trade name, bank holder and beneficial owners screened. Strong match = reject; near match = silent human review.'),
    'RISK-02': R('Risk', 'Embargoed jurisdiction', 'Vendor, address or bank in a blocked country.'),
    'RISK-03': R('Risk', 'Duplicate or conflicting vendor', 'Same tax ID, same bank account or near-identical name as an existing or blocked vendor.'),
    'RISK-04': R('Risk', 'Declarations raise a flag', 'Vendor declared a sanctions problem, or declared a politically exposed person.'),
    'RISK-05': R('Risk', 'Bank change on an existing vendor', 'Payment-redirection pattern. All bank changes need out-of-band callback to the contact on file.'),
    'CASE-01': R('Lifecycle', 'Resubmission changed only what was asked', 'Unrequested changes to identity or bank fields are treated as a new change request.'),
    'CASE-02': R('Lifecycle', 'Round limit', 'After the third failed round the case stops looping by email and goes to a person.'),
    'CASE-03': R('Lifecycle', 'Vendor response SLA', 'Reminders at day 7 and 14; case closed at day 30 without response.'),
  };

  /* =====================================================================
   * 3. SMALL HELPERS
   * ===================================================================== */
  const DAY = 86400000;
  const str = (v) => (v === undefined || v === null ? '' : String(v));
  const has = (v) => str(v).trim() !== '';
  const clean = (v) => str(v).replace(/[\s\-.]/g, '').toUpperCase();
  const getp = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  const ddiff = (a, b) => Math.floor((b - a) / DAY);
  const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
  const uniq = (a) => Array.from(new Set(a));
  const money = (amt, cur) => {
    try { return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(amt); }
    catch (e) { return cur + ' ' + amt; }
  };
  const last4 = (v) => clean(v).slice(-4);
  const domainOf = (e) => (str(e).split('@')[1] || '').toLowerCase().trim();
  const digitsOf = (v) => str(v).replace(/\D/g, '');
  const FIELD_LABELS = { 'bank.account_holder_name': 'bank account holder name', 'bank.bank_name': 'bank name', 'bank.account_number': 'bank account number', 'bank.ifsc': 'IFSC code', 'bank.iban': 'IBAN', 'bank.routing_number': 'routing number', 'bank.sort_code': 'sort code', 'bank.swift': 'SWIFT code', 'vendor.legal_name': 'legal name', 'vendor.country': 'country', 'vendor.registration_number': 'company registration number', 'declarations.beneficial_owners': 'beneficial owners', 'tax.pan': 'PAN', 'tax.gstin': 'GSTIN', 'tax.tin': 'taxpayer ID', 'tax.vat_number': 'VAT number' };
  const humanField = (p) => FIELD_LABELS[p] || str(p).split('.').pop().replace(/_/g, ' ');
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

  /* ---- name matching -------------------------------------------------- */
  const LEGAL_WORDS = new Set(['pvt', 'private', 'ltd', 'limited', 'llc', 'llp', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'plc', 'gmbh', 'ag', 'ug', 'kg', 'lp', 'pte', 'opc', 'mbh', 'sa', 'bv', 'nv']);
  const STRONG_FORMS = { llc: 'llc', inc: 'inc', incorporated: 'inc', corp: 'inc', corporation: 'inc', gmbh: 'gmbh', llp: 'llp', plc: 'plc', ag: 'ag', ug: 'ug', lp: 'lp', pte: 'pte' };

  function prepName(s) {
    let t = str(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
      .replace(/\bm\/s\.?\s+/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ');
    const all = t.split(/\s+/).filter(Boolean).filter((w) => w !== 'the');
    const core = all.filter((w) => !LEGAL_WORDS.has(w) && w !== 'and');
    const form = (all.find((w) => STRONG_FORMS[w]) && STRONG_FORMS[all.find((w) => STRONG_FORMS[w])]) || null;
    return { raw: all.join(' '), core, form };
  }
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  const sim = (a, b) => (!a.length && !b.length ? 1 : 1 - lev(a, b) / Math.max(a.length, b.length));

  /** Tiered comparison. level: exact | equivalent | close | partial | mismatch | none */
  function nameMatch(a, b) {
    const A = prepName(a), B = prepName(b);
    if (!A.core.length || !B.core.length) return { level: 'none', score: 0, note: 'a name is missing' };
    const ja = A.core.join(' '), jb = B.core.join(' ');
    if (ja === jb) {
      if (A.form && B.form && A.form !== B.form) return { level: 'close', score: 0.9, note: `same name but different legal form (${A.form.toUpperCase()} vs ${B.form.toUpperCase()})` };
      return A.raw === B.raw
        ? { level: 'exact', score: 1, note: 'identical' }
        : { level: 'equivalent', score: 1, note: 'same name; differs only in case, punctuation or legal-form wording' };
    }
    if ([...A.core].sort().join(' ') === [...B.core].sort().join(' ')) return { level: 'equivalent', score: 0.97, note: 'same words in a different order' };
    const s = sim(ja, jb);
    if (s >= 0.88) return { level: 'close', score: s, note: 'differs by a few characters (likely a typo)' };
    const [short, long] = A.core.length <= B.core.length ? [A.core, B.core] : [B.core, A.core];
    const contained = short.every((t) => long.some((u) => u === t || (t.length > 3 && sim(t, u) >= 0.85)));
    if (contained && short.length < long.length) return { level: 'partial', score: short.length / long.length, note: 'one name is a shortened form of the other' };
    const sa = new Set(A.core), sb = new Set(B.core);
    const inter = [...sa].filter((x) => sb.has(x)).length;
    const jac = inter / new Set([...sa, ...sb]).size;
    if (jac >= 0.5) return { level: 'partial', score: jac, note: 'the names share some words', shared: inter };
    return { level: 'mismatch', score: Math.max(s, jac), note: 'the names are different', shared: inter };
  }
  const nameOK = (m) => m.level === 'exact' || m.level === 'equivalent';

  /* ---- identifier validators ----------------------------------------- */
  const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const GST_STATES = { '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction' };
  const IFSC_BANKS = { HDFC: ['hdfc'], ICIC: ['icici'], SBIN: ['state bank', 'sbi'], UTIB: ['axis'], KKBK: ['kotak'], PUNB: ['punjab national', 'pnb'], BARB: ['baroda'], CNRB: ['canara'], IDIB: ['indian bank'], YESB: ['yes bank'], INDB: ['indusind'], IOBA: ['indian overseas'], BKID: ['bank of india'], UBIN: ['union bank'], FDRL: ['federal'] };
  const IBAN_LEN = { GB: 22, DE: 22, FR: 27, NL: 18, ES: 24, IT: 27, IE: 22, BE: 16, AT: 20, CH: 21, AE: 23 };
  const EIN_PREFIXES = new Set([].concat(
    range(1, 6), range(10, 16), range(20, 27), range(30, 39), range(40, 48), range(50, 68), range(71, 77), range(80, 88), range(90, 95), [98, 99]).map((n) => String(n).padStart(2, '0')));
  function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }

  function gstinCheckChar(s14) {
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      const p = GST_CHARS.indexOf(s14[i]) * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(p / 36) + (p % 36);
    }
    return GST_CHARS[(36 - (sum % 36)) % 36];
  }
  function ibanRem(s) {
    let rem = 0;
    for (const ch of s) {
      const val = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
      for (const d of val) rem = (rem * 10 + Number(d)) % 97;
    }
    return rem;
  }
  const fail = (reason) => ({ ok: false, reason });
  const V = {
    pan(v) {
      const s = clean(v);
      if (!/^[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z]$/.test(s)) return fail('a PAN is 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F) and the 4th letter must be a valid holder type');
      return { ok: true, normalized: s, holderType: s[3] };
    },
    gstin(v) {
      const s = clean(v);
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) return fail('a GSTIN is 15 characters: 2-digit state code, the 10-character PAN, an entity digit, "Z" and a check character');
      if (!GST_STATES[s.slice(0, 2)]) return fail(`state code ${s.slice(0, 2)} does not exist`);
      if (gstinCheckChar(s.slice(0, 14)) !== s[14]) return fail('the check character does not match, which usually means a mistyped character');
      return { ok: true, normalized: s, state: GST_STATES[s.slice(0, 2)], pan: s.slice(2, 12) };
    },
    cin(v) {
      const s = clean(v);
      if (!/^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(s)) return fail('a CIN is 21 characters, e.g. U12345MH2015PTC123456');
      const y = Number(s.slice(8, 12));
      if (y < 1850 || y > new Date().getFullYear()) return fail(`the incorporation year ${y} inside the CIN is not possible`);
      return { ok: true, normalized: s, year: y, klass: s.slice(12, 15) };
    },
    llpin(v) { const s = clean(v); return /^[A-Z]{3}[0-9]{4}$/.test(s) ? { ok: true, normalized: s } : fail('an LLPIN looks like AAA-1234'); },
    ifsc(v) { const s = clean(v); return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s) ? { ok: true, normalized: s, prefix: s.slice(0, 4) } : fail('an IFSC is 11 characters: 4 letters, a zero, then 6 letters/digits'); },
    inAccount(v) { return /^\d{9,18}$/.test(clean(v)) ? { ok: true } : fail('Indian account numbers are 9 to 18 digits'); },
    ein(v) {
      const s = clean(v);
      if (!/^\d{9}$/.test(s)) return fail('an EIN is 9 digits (XX-XXXXXXX)');
      if (!EIN_PREFIXES.has(s.slice(0, 2))) return fail(`the prefix ${s.slice(0, 2)} is not issued by the IRS`);
      return { ok: true, normalized: s };
    },
    ssn(v) {
      const s = clean(v);
      if (!/^\d{9}$/.test(s)) return fail('an SSN/ITIN is 9 digits');
      const area = s.slice(0, 3), grp = s.slice(3, 5), ser = s.slice(5);
      if (area === '000' || area === '666' || grp === '00' || ser === '0000') return fail('this number cannot be a valid SSN');
      return { ok: true, normalized: s };
    },
    aba(v) {
      const s = clean(v);
      if (!/^\d{9}$/.test(s)) return fail('an ABA routing number is 9 digits');
      const d = s.split('').map(Number);
      const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
      return sum % 10 === 0 ? { ok: true, normalized: s } : fail('the routing-number checksum fails, which usually means a mistyped digit');
    },
    usAccount(v) { return /^\d{4,17}$/.test(clean(v)) ? { ok: true } : fail('US account numbers are 4 to 17 digits'); },
    ukVat(v) {
      const s = clean(v);
      const m = /^GB(\d{9})(\d{3})?$/.exec(s);
      if (!m) return fail('a UK VAT number is "GB" followed by 9 digits (12 for branches)');
      const d = m[1];
      const total = [8, 7, 6, 5, 4, 3, 2].reduce((a, w, i) => a + w * Number(d[i]), 0);
      const cd = Number(d.slice(7));
      if ((total + cd) % 97 !== 0 && (total + cd + 55) % 97 !== 0) return fail('the check digits do not match, which usually means a mistyped digit');
      return { ok: true, normalized: s };
    },
    ukCompany(v) { return /^([0-9]{8}|[A-Z]{2}[0-9]{6})$/.test(clean(v)) ? { ok: true } : fail('a UK company number is 8 characters (e.g. 01234567 or SC123456)'); },
    sortCode(v) { return /^\d{6}$/.test(clean(v)) ? { ok: true } : fail('a UK sort code is 6 digits'); },
    ukAccount(v) { return /^\d{8}$/.test(clean(v)) ? { ok: true } : fail('a UK account number is 8 digits'); },
    deVat(v) {
      const s = clean(v);
      if (!/^DE\d{9}$/.test(s)) return fail('a German USt-IdNr is "DE" followed by 9 digits');
      const d = s.slice(2).split('').map(Number);
      let product = 10;
      for (let i = 0; i < 8; i++) { let sum = (d[i] + product) % 10; if (sum === 0) sum = 10; product = (2 * sum) % 11; }
      let check = 11 - product; if (check === 10) check = 0;
      return check === d[8] ? { ok: true, normalized: s } : fail('the check digit does not match, which usually means a mistyped digit');
    },
    deRegister(v) { return /^HR[AB]\d{1,6}$/.test(clean(v)) ? { ok: true } : fail('a German commercial-register number looks like HRB 12345'); },
    iban(v) {
      const s = clean(v);
      if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(s)) return fail('the IBAN format is invalid');
      const cc = s.slice(0, 2);
      if (IBAN_LEN[cc] && IBAN_LEN[cc] !== s.length) return fail(`IBANs for ${cc} have ${IBAN_LEN[cc]} characters; this has ${s.length}`);
      if (ibanRem(s.slice(4) + s.slice(0, 4)) !== 1) return fail('the IBAN check digits do not match, which usually means a mistyped character');
      return { ok: true, country: cc, normalized: s };
    },
  };

  /** Generators for valid identifiers (used by the sample data and tests). */
  const gen = {
    gstin: (body14) => body14 + gstinCheckChar(body14),
    iban(cc, bban) { const rem = ibanRem(bban + cc + '00'); return cc + String(98 - rem).padStart(2, '0') + bban; },
    deVat(d8) {
      let product = 10;
      for (let i = 0; i < 8; i++) { let sum = (Number(d8[i]) + product) % 10; if (sum === 0) sum = 10; product = (2 * sum) % 11; }
      let check = 11 - product; if (check === 10) check = 0;
      return 'DE' + d8 + check;
    },
    ukVat(d7) {
      const total = [8, 7, 6, 5, 4, 3, 2].reduce((a, w, i) => a + w * Number(d7[i]), 0);
      return 'GB' + d7 + String((97 - (total % 97)) % 97).padStart(2, '0');
    },
    aba(d8) {
      const w = [3, 7, 1, 3, 7, 1, 3, 7];
      const sum = d8.split('').reduce((a, c, i) => a + Number(c) * w[i], 0);
      return d8 + ((10 - (sum % 10)) % 10);
    },
  };

  /** "This looks like an Indian GSTIN" — for tax IDs typed into the wrong country's field. */
  function classifyTaxId(raw) {
    const s = clean(raw), out = [];
    if (V.gstin(s).ok) out.push({ country: 'IN', kind: 'GSTIN (India)' });
    else if (/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) out.push({ country: 'IN', kind: 'GSTIN (India)' });
    if (/^[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z]$/.test(s)) out.push({ country: 'IN', kind: 'PAN (India)' });
    if (/^GB(\d{9}|\d{12})$/.test(s)) out.push({ country: 'GB', kind: 'UK VAT number' });
    if (/^DE\d{9}$/.test(s)) out.push({ country: 'DE', kind: 'German USt-IdNr' });
    if (/^\d{9}$/.test(s)) out.push({ country: 'US', kind: 'US EIN/SSN' });
    return out;
  }
  const wrongCountryHint = (value, expected) => {
    const c = classifyTaxId(value).find((x) => x.country !== expected);
    return c ? ` It looks like a ${c.kind}, but the vendor is registered in ${expected}.` : '';
  };

  /* =====================================================================
   * 4. DOCUMENT & FIELD REQUIREMENTS (per country)
   * ===================================================================== */
  const DOC_LABEL = {
    pan_card: 'PAN card', gst_certificate: 'GST registration certificate', certificate_of_incorporation: 'certificate of incorporation',
    cancelled_cheque: 'cancelled cheque', bank_letter: 'bank letter', bank_statement: 'bank statement', voided_check: 'voided check',
    w9: 'Form W-9', vat_certificate: 'VAT registration certificate', commercial_register_extract: 'commercial-register extract (Handelsregisterauszug)',
    tax_exemption_declaration: 'signed tax-registration exemption declaration', tax_certificate: 'tax registration certificate',
  };
  const BANK_PROOF = ['cancelled_cheque', 'bank_letter', 'bank_statement', 'voided_check'];
  const DOC_ID_FIELD = { gst_certificate: 'tax.gstin', pan_card: 'tax.pan', certificate_of_incorporation: 'vendor.registration_number', w9: 'tax.tin', vat_certificate: 'tax.vat_number' };
  const isCorp = (v) => ['company', 'llp'].includes(v.entity_type);
  const isUpdate = (sub) => has(sub.existing_vendor_id);

  function requiredFields(sub) {
    const v = sub.vendor || {}, d = sub.declarations || {};
    const c = v.country, corp = isCorp(v), exempt = !!d.tax_registration_exempt, list = [];
    const F = (group, path, label, hint, anyOf) => list.push({ group, path, label, hint, anyOf });
    F('vendor', 'vendor.legal_name', 'Legal name', 'exactly as on your registration certificate');
    F('vendor', 'vendor.country', 'Country of registration', 'two-letter code, e.g. IN');
    F('vendor', 'vendor.entity_type', 'Entity type', 'company, llp, partnership or sole_proprietor');
    F('vendor', 'vendor.contact.name', 'Contact person');
    F('vendor', 'vendor.contact.email', 'Contact email');
    F('bank', 'bank.account_holder_name', 'Bank account holder name');
    F('bank', 'bank.bank_name', 'Bank name');
    F('bank', 'bank.currency', 'Payment currency', 'e.g. INR');
    if (!isUpdate(sub)) {
      F('vendor', 'vendor.address.line1', 'Registered address (street)');
      F('vendor', 'vendor.address.city', 'Registered address (city)');
      F('vendor', 'vendor.address.postal_code', 'Registered address (postal code)');
    }
    const up = isUpdate(sub);
    if (c === 'IN') {
      if (!up) F('vendor', 'vendor.address.state', 'Registered address (state)');
      if (!up) F('tax', 'tax.pan', 'PAN');
      if (!up && !exempt) F('tax', 'tax.gstin', 'GSTIN', 'or declare that you are exempt from GST registration');
      if (!up && corp) F('vendor', 'vendor.registration_number', v.entity_type === 'llp' ? 'LLPIN' : 'CIN');
      F('bank', 'bank.account_number', 'Bank account number');
      F('bank', 'bank.ifsc', 'IFSC code');
    } else if (c === 'US') {
      if (!up) { F('tax', 'tax.tin_type', 'Tax ID type', 'EIN or SSN'); F('tax', 'tax.tin', 'Taxpayer ID (EIN or SSN)'); }
      F('bank', 'bank.account_number', 'Bank account number');
      F('bank', 'bank.routing_number', 'ABA routing number');
    } else if (c === 'GB') {
      if (!up && corp) F('vendor', 'vendor.registration_number', 'Companies House number');
      if (!up && !exempt) F('tax', 'tax.vat_number', 'VAT number', 'or declare that you are not VAT-registered');
      F('bank', null, 'IBAN, or sort code and account number', null, ['bank.iban', 'bank.account_number']);
      if (!has(getp(sub, 'bank.iban'))) F('bank', 'bank.sort_code', 'Sort code');
    } else if (c === 'DE') {
      if (!up && corp) F('vendor', 'vendor.registration_number', 'Handelsregister number', 'e.g. HRB 12345');
      if (!up && !exempt) F('tax', null, 'USt-IdNr (VAT ID) or tax number', null, ['tax.vat_number', 'tax.tax_number']);
      F('bank', 'bank.iban', 'IBAN');
    } else if (has(c)) {
      if (!up) F('tax', 'tax.tax_id', 'Tax registration number');
      F('bank', null, 'IBAN, or SWIFT code and account number', null, ['bank.iban', 'bank.swift']);
    }
    return list;
  }

  function requiredDocs(sub) {
    const v = sub.vendor || {}, d = sub.declarations || {};
    const c = v.country, corp = isCorp(v), exempt = !!d.tax_registration_exempt, out = [];
    const req = (key, label, accepts, hint) => out.push({ key, label, accepts, hint });
    if (isUpdate(sub)) {
      req('bank', 'bank proof (cancelled cheque, bank letter or statement)', BANK_PROOF, 'on bank letterhead, showing the account holder and number');
      return out;
    }
    if (c === 'IN') {
      req('pan', 'PAN card', ['pan_card']);
      if (corp) req('inc', 'certificate of incorporation', ['certificate_of_incorporation']);
      if (exempt) req('exm', 'signed GST non-registration declaration', ['tax_exemption_declaration'], 'signed by the proprietor or an authorised signatory');
      else req('tax', 'GST registration certificate', ['gst_certificate'], 'Form GST REG-06');
      req('bank', 'bank proof (cancelled cheque, bank letter or statement)', BANK_PROOF, 'on bank letterhead, showing the account holder and number');
    } else if (c === 'US') {
      req('tax', 'Form W-9', ['w9'], 'signed and dated');
      req('bank', 'bank proof (voided check or bank letter)', ['voided_check', 'bank_letter', 'bank_statement']);
    } else if (c === 'GB') {
      if (corp) req('inc', 'certificate of incorporation', ['certificate_of_incorporation']);
      if (exempt) req('exm', 'signed VAT exemption declaration', ['tax_exemption_declaration']);
      else req('tax', 'VAT registration certificate', ['vat_certificate']);
      req('bank', 'bank proof (letter or statement)', BANK_PROOF);
    } else if (c === 'DE') {
      if (corp) req('inc', 'commercial-register extract', ['commercial_register_extract']);
      if (exempt) req('exm', 'signed Kleinunternehmer declaration', ['tax_exemption_declaration']);
      else req('tax', 'VAT ID confirmation', ['vat_certificate']);
      req('bank', 'bank proof (letter or statement)', BANK_PROOF);
    } else if (has(c)) {
      if (corp) req('inc', 'certificate of incorporation', ['certificate_of_incorporation']);
      req('tax', 'tax registration certificate', ['tax_certificate']);
      req('bank', 'bank proof (letter or statement)', BANK_PROOF);
    }
    return out;
  }

  /** Names an official document may legitimately carry for this vendor. */
  function acceptedNames(sub) {
    const v = sub.vendor || {};
    const list = [v.legal_name];
    if (v.entity_type === 'sole_proprietor') list.push(v.proprietor_name, v.trade_name);
    return list.filter(has);
  }
  function bestNameMatch(name, candidates) {
    let best = { level: 'none', score: -1 };
    const order = ['none', 'mismatch', 'partial', 'close', 'equivalent', 'exact'];
    candidates.forEach((c) => { const m = nameMatch(name, c); if (order.indexOf(m.level) > order.indexOf(best.level) || best.score < 0) best = Object.assign({ against: c }, m); });
    return best;
  }
  function bankCountry(b) {
    if (has(b.country)) return str(b.country).toUpperCase();
    if (has(b.iban)) return clean(b.iban).slice(0, 2);
    if (has(b.ifsc)) return 'IN';
    if (has(b.routing_number)) return 'US';
    if (has(b.sort_code)) return 'GB';
    return null;
  }

  /* =====================================================================
   * 5. THE CHECK RECORDER
   * ===================================================================== */
  const BANK_FIX_FIELDS = ['bank.account_holder_name', 'bank.account_number', 'bank.ifsc', 'bank.iban', 'bank.routing_number', 'bank.sort_code', 'bank.bank_name', 'bank.country', 'bank.country_mismatch_reason', 'documents.cancelled_cheque', 'documents.bank_letter', 'documents.bank_statement', 'documents.voided_check', 'documents.tax_exemption_declaration'];
  function mkAdd(ctx) {
    return function add(rule, outcome, o) {
      o = o || {};
      const def = RULES[rule];
      if (!def) throw new Error('Unknown rule ' + rule);
      const c = {
        rule_id: rule, title: def.title, category: def.category, outcome,
        label: o.label, detail: o.detail || '', fields: o.fields || [], vendor: o.vendor, fix: o.fix,
        notice: o.notice, internal: o.internal, condition: o.condition, evidence: o.evidence,
        confidential: !!o.confidential, route: o.route, hold: !!o.hold, priority: o.priority,
        // fields the vendor may legitimately change in order to fix THIS finding (used by resubmission change-control)
        allow: o.allow || ((rule === 'XREF-01' || rule === 'XREF-02') && outcome === 'required' ? BANK_FIX_FIELDS : []),
        key: o.key || (rule + ':' + (o.fields || []).join(',')),
      };
      const ov = ctx.overrides.find((x) => x.key === c.key);
      if (outcome === 'review' && ov) {
        if (ov.decision === 'clear') {
          c.outcome = 'pass';
          c.detail += ` — Cleared by ${ov.by} on ${isoDay(ov.at)}: ${ov.note}`;
          c.cleared = ov; c.hold = false; c.notice = undefined; c.internal = undefined; c.route = undefined;
          c.condition = o.conditionOnClear; c.vendor = undefined;
        } else if (ov.decision === 'reject') {
          c.outcome = 'block';
          c.detail += ` — Rejected by ${ov.by} on ${isoDay(ov.at)}: ${ov.note}`;
          c.confidential = true; c.vendor = undefined; c.notice = undefined; c.hold = false;
        }
      }
      ctx.checks.push(c);
      if (c.outcome === 'required' || c.outcome === 'block') c.fields.forEach((f) => ctx.bad.add(f));
      return c;
    };
  }

  /* =====================================================================
   * 6. CHECK GROUPS
   * ===================================================================== */

  /* ---- COMP ----------------------------------------------------------- */
  function checkCompleteness(ctx, add) {
    const { sub } = ctx;
    const v = sub.vendor || {}, d = sub.declarations || {};
    const reqs = requiredFields(sub);
    const miss = { vendor: [], tax: [], bank: [] }, total = { vendor: 0, tax: 0, bank: 0 };
    reqs.forEach((r) => {
      total[r.group]++;
      const paths = r.anyOf || [r.path];
      if (!paths.some((p) => has(getp(sub, p)))) miss[r.group].push(r);
    });
    const ruleFor = { vendor: 'COMP-01', tax: 'COMP-02', bank: 'COMP-03' };
    ['vendor', 'tax', 'bank'].forEach((g) => {
      if (!miss[g].length) add(ruleFor[g], 'pass', { detail: `All ${total[g]} required ${g} fields are present.` });
      miss[g].forEach((r) => add(ruleFor[g], 'required', {
        label: r.label, fields: r.anyOf || [r.path], detail: `${r.label} is missing.`,
        vendor: `${r.label} was not provided.`, fix: `Please provide ${r.label}${r.hint ? ' (' + r.hint + ')' : ''}.`,
      }));
    });
    if (has(v.country) && !/^[A-Za-z]{2}$/.test(v.country)) {
      add('COMP-01', 'required', { label: 'Country code', fields: ['vendor.country'], detail: `"${v.country}" is not a two-letter country code.`, vendor: `The country "${v.country}" isn't a two-letter code.`, fix: 'Please use the ISO two-letter code (IN, US, GB, DE ...).' });
    }
    // docs
    const docs = Array.isArray(sub.documents) ? sub.documents : [];
    const reqd = requiredDocs(sub);
    const eff = (x) => (x.extracted && x.extracted.detected_type) || x.declared_type;
    const missing = [];
    reqd.forEach((rq) => {
      const good = docs.find((x) => rq.accepts.includes(eff(x)));
      const wrong = !good && docs.find((x) => rq.accepts.includes(x.declared_type));
      if (!good && !wrong) missing.push(rq);
    });
    if (reqd.length && !missing.length) add('COMP-04', 'pass', { detail: `All ${reqd.length} required documents are attached (${reqd.map((r) => r.label).join('; ')}).` });
    missing.forEach((rq) => add('COMP-04', 'required', {
      label: 'Missing document', fields: rq.accepts.map((t) => 'documents.' + t),
      detail: `No ${rq.label} was attached.`, vendor: `The ${rq.label} was not attached.`,
      fix: `Please upload the ${rq.label}${rq.hint ? ' (' + rq.hint + ')' : ''}.`,
    }));
    // declarations
    if (isUpdate(sub)) { add('COMP-05', 'pass', { detail: 'Bank-detail change on an existing vendor: declarations are not re-collected.' }); return; }
    const probs = [];
    if (typeof d.sanctions_clean !== 'boolean') probs.push(['declarations.sanctions_clean', 'the sanctions & compliance declaration']);
    if (typeof d.pep !== 'boolean') probs.push(['declarations.pep', 'the politically-exposed-person (PEP) declaration']);
    const owners = d.beneficial_owners;
    if (['company', 'llp', 'partnership'].includes(v.entity_type)) {
      if (!Array.isArray(owners) || !owners.length) {
        if (d.no_owner_over_25 !== true) probs.push(['declarations.beneficial_owners', 'beneficial owners (anyone holding 25% or more), or a statement that nobody does']);
      } else {
        const sum = owners.reduce((a, o) => a + Number(o.ownership_pct || 0), 0);
        if (sum > 100.5) probs.push(['declarations.beneficial_owners', `a corrected ownership split (the percentages add up to ${sum}%)`]);
        if (owners.some((o) => !has(o.name))) probs.push(['declarations.beneficial_owners', 'a name for every beneficial owner']);
      }
    }
    if (!probs.length) add('COMP-05', 'pass', { detail: 'Sanctions and PEP declarations answered; beneficial ownership declared where required.' });
    probs.forEach(([f, label]) => add('COMP-05', 'required', {
      label: 'Declaration', fields: [f], detail: `Missing or invalid: ${label}.`,
      vendor: `We need ${label}.`, fix: `Please complete ${label} on the form.`,
    }));
  }

  /* ---- FMT ------------------------------------------------------------ */
  function checkFormats(ctx, add) {
    const { sub } = ctx;
    const v = sub.vendor || {}, t = sub.tax || {}, b = sub.bank || {}, d = sub.declarations || {};
    const c = v.country, exempt = !!d.tax_registration_exempt;
    // tax ids
    const specs = [];
    if (c === 'IN') { specs.push(['tax.pan', 'PAN', V.pan]); if (!exempt) specs.push(['tax.gstin', 'GSTIN', V.gstin]); }
    if (c === 'US') specs.push(['tax.tin', t.tin_type === 'SSN' ? 'SSN/ITIN' : 'EIN', t.tin_type === 'SSN' ? V.ssn : V.ein]);
    if (c === 'GB') specs.push(['tax.vat_number', 'VAT number', V.ukVat]);
    if (c === 'DE') specs.push(['tax.vat_number', 'USt-IdNr', V.deVat]);
    let taxChecked = 0;
    specs.forEach(([path, label, fn]) => {
      const val = getp(sub, path);
      if (!has(val)) return;
      taxChecked++;
      const r = fn(val);
      if (r.ok) add('FMT-01', 'pass', { label, fields: [path], detail: `${label} ${clean(val)} has a valid format and checksum.` });
      else add('FMT-01', 'required', {
        label: `${label} not valid`, fields: [path],
        detail: `${label} "${val}" is invalid for ${c}: ${r.reason}.${wrongCountryHint(val, c)}`,
        vendor: `The ${label} "${val}" isn't valid: ${r.reason}.${wrongCountryHint(val, c)}`,
        fix: `Please check it against your registration certificate and send the correct ${label}.`,
      });
    });
    if (c === 'IN' && has(t.gstin) && exempt) {
      add('FMT-01', 'required', {
        label: 'GSTIN and exemption both given', fields: ['tax.gstin', 'declarations.tax_registration_exempt'],
        detail: 'A GSTIN was provided and the vendor also claims to be exempt from GST registration. Both cannot be true.',
        vendor: 'You gave a GSTIN and also said you are exempt from GST registration.', fix: 'Please tell us which applies: send the GSTIN, or remove it and keep the exemption declaration.',
      });
    }
    // registration number
    if (has(v.registration_number) && isCorp(v)) {
      let fn = null, label = 'Registration number';
      if (c === 'IN') { fn = v.entity_type === 'llp' ? V.llpin : V.cin; label = v.entity_type === 'llp' ? 'LLPIN' : 'CIN'; }
      if (c === 'GB') { fn = V.ukCompany; label = 'Companies House number'; }
      if (c === 'DE') { fn = V.deRegister; label = 'Handelsregister number'; }
      if (fn) {
        const r = fn(v.registration_number);
        if (r.ok) add('FMT-03', 'pass', { label, fields: ['vendor.registration_number'], detail: `${label} ${clean(v.registration_number)} is well-formed.` });
        else add('FMT-03', 'required', { label: `${label} not valid`, fields: ['vendor.registration_number'], detail: `${label} "${v.registration_number}" is invalid: ${r.reason}.`, vendor: `The ${label} "${v.registration_number}" isn't valid: ${r.reason}.`, fix: `Please send the ${label} exactly as on your certificate of incorporation.` });
      }
    }
    // bank
    const bankSpecs = [];
    if (c === 'IN') { bankSpecs.push(['bank.ifsc', 'IFSC', V.ifsc], ['bank.account_number', 'account number', V.inAccount]); }
    if (c === 'US') { bankSpecs.push(['bank.routing_number', 'routing number', V.aba], ['bank.account_number', 'account number', V.usAccount]); }
    if (c === 'GB') { if (has(b.sort_code)) bankSpecs.push(['bank.sort_code', 'sort code', V.sortCode]); if (!has(b.iban) && has(b.account_number)) bankSpecs.push(['bank.account_number', 'account number', V.ukAccount]); }
    if (has(b.iban)) bankSpecs.push(['bank.iban', 'IBAN', V.iban]);
    if (c === 'DE' && !has(b.iban)) { /* completeness already asks for it */ }
    bankSpecs.forEach(([path, label, fn]) => {
      const val = getp(sub, path);
      if (!has(val)) return;
      const r = fn(val);
      if (r.ok) add('FMT-02', 'pass', { label, fields: [path], detail: `Bank ${label} is well-formed.` });
      else add('FMT-02', 'required', { label: `Bank ${label} not valid`, fields: [path], detail: `Bank ${label} "${val}" is invalid: ${r.reason}.`, vendor: `The bank ${label} "${val}" isn't valid: ${r.reason}.`, fix: `Please re-check it against your bank statement or cancelled cheque and send the correct ${label}.` });
    });
    if (has(b.iban) && c && V.iban(b.iban).ok === true && ['DE', 'GB'].includes(c) && clean(b.iban).slice(0, 2) !== c) {
      /* different-country IBAN is XREF-02's business */
    }
    // email
    const email = getp(sub, 'vendor.contact.email');
    if (has(email)) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) add('FMT-04', 'pass', { fields: ['vendor.contact.email'], detail: 'Contact email is well-formed.' });
      else add('FMT-04', 'required', { label: 'Email address', fields: ['vendor.contact.email'], detail: `"${email}" is not a valid email address.`, vendor: `The contact email "${email}" isn't valid.`, fix: 'Please send a working contact email address.' });
    }
  }

  /* ---- XREF ----------------------------------------------------------- */
  function checkConsistency(ctx, add) {
    const { sub, now, cfg } = ctx;
    const v = sub.vendor || {}, t = sub.tax || {}, b = sub.bank || {}, r = sub.request || {}, d = sub.declarations || {};
    const usable = (...p) => p.every((x) => has(getp(sub, x)) && !ctx.bad.has(x));
    const c = v.country;

    // XREF-01 holder vs legal name
    if (usable('bank.account_holder_name', 'vendor.legal_name')) {
      const names = acceptedNames(sub);
      const m = bestNameMatch(b.account_holder_name, names);
      const ev = { holder: b.account_holder_name, compared_with: m.against, level: m.level, score: Number(m.score.toFixed(2)) };
      const fields = ['bank.account_holder_name', 'vendor.legal_name'];
      const ownerNames = (d.beneficial_owners || []).map((o) => o.name).concat(v.contact && v.contact.name ? [v.contact.name] : []);
      const ownerHit = ownerNames.find((n) => nameMatch(b.account_holder_name, n).level !== 'mismatch' && nameMatch(b.account_holder_name, n).level !== 'none');
      const tradeHit = has(v.trade_name) && v.entity_type !== 'sole_proprietor' && ['exact', 'equivalent', 'close', 'partial'].includes(nameMatch(b.account_holder_name, v.trade_name).level) && !nameOK(m);
      if (nameOK(m)) add('XREF-01', 'pass', { fields, evidence: ev, detail: `Account holder "${b.account_holder_name}" matches legal name "${m.against}" (${m.note}).` });
      else if (m.level === 'close') add('XREF-01', 'warn', { fields, evidence: ev, detail: `Account holder "${b.account_holder_name}" is almost identical to "${m.against}" (${m.note}). Accepted, but the bank proof must show the same spelling.`, condition: { code: 'HOLDER_SPELLING', text: 'Pay only to the account spelled exactly as on the bank proof.' } });
      else if (tradeHit) add('XREF-01', 'required', {
        label: 'Account is in a trade name', fields, evidence: ev,
        detail: `Account holder "${b.account_holder_name}" matches the trade name "${v.trade_name}", not the legal entity "${v.legal_name}". A trade name is not a legal person, so we cannot confirm the account belongs to the vendor.`,
        vendor: `The bank account is held as "${b.account_holder_name}", which looks like your trade name rather than your registered legal name "${v.legal_name}".`,
        fix: 'Please send a bank letter confirming the account belongs to the registered legal entity, or use an account held in the legal name.',
      });
      else if (ownerHit && !['sole_proprietor'].includes(v.entity_type)) add('XREF-01', 'required', {
        label: 'Account held by an individual', fields, evidence: ev,
        detail: `Account holder "${b.account_holder_name}" resembles an owner/contact ("${ownerHit}"), not the company "${v.legal_name}". Paying a company invoice into a personal account is a classic diversion pattern.`,
        vendor: `The bank account is in the personal name "${b.account_holder_name}", not in the company's name "${v.legal_name}".`,
        fix: 'Please provide a company bank account, or a letter of authorisation signed by an authorised signatory explaining why payments should go to this account.',
        internal: 'Payee is an individual on a company vendor — if the explanation arrives, confirm it by phone before accepting.',
      });
      else add('XREF-01', 'required', {
        label: 'Account holder name differs', fields, evidence: ev,
        detail: `Account holder "${b.account_holder_name}" does not match legal name "${v.legal_name}" (${m.note}).`,
        vendor: `The bank account holder "${b.account_holder_name}" doesn't match your registered name "${v.legal_name}".`,
        fix: 'Please use an account held in the registered legal name, or send a letter of authorisation (on company letterhead, signed by an authorised signatory) explaining the arrangement, together with a bank letter.',
      });
    }

    // XREF-02 bank country
    const bc = bankCountry(b);
    if (bc && has(c) && !ctx.bad.has('vendor.country')) {
      if (bc === c.toUpperCase()) add('XREF-02', 'pass', { fields: ['bank.country', 'vendor.country'], detail: `Bank country (${bc}) equals the vendor's country (${c.toUpperCase()}).` });
      else if (has(b.country_mismatch_reason)) add('XREF-02', 'review', {
        label: 'Bank in another country', fields: ['bank.country', 'vendor.country'], key: 'XREF-02:' + bc + c + hash(b.country_mismatch_reason),
        detail: `Bank is in ${bc} but the vendor is registered in ${c.toUpperCase()}. Vendor's explanation: "${b.country_mismatch_reason}".`,
        internal: 'Judge whether the stated reason for the foreign account is credible (e.g. USD export proceeds) and whether a bank letter supports it.',
        notice: 'Thanks for explaining the bank arrangement. Our team is reviewing it.',
      });
      else add('XREF-02', 'required', {
        label: 'Bank in another country', fields: ['bank.country', 'vendor.country'],
        detail: `Bank is in ${bc} but the vendor is registered in ${c.toUpperCase()}, with no explanation. Often legitimate, also a common mule-account pattern.`,
        vendor: `The bank account is in ${bc}, but the company is registered in ${c.toUpperCase()}.`,
        fix: 'Please add a short explanation of why payments should go to an account in another country, and attach a bank letter from that bank.',
      });
    }

    // XREF-03 IFSC prefix vs bank name
    if (c === 'IN' && usable('bank.ifsc', 'bank.bank_name')) {
      const prefix = clean(b.ifsc).slice(0, 4), kws = IFSC_BANKS[prefix];
      if (kws) {
        const bn = str(b.bank_name).toLowerCase();
        if (kws.some((k) => bn.includes(k))) add('XREF-03', 'pass', { fields: ['bank.ifsc', 'bank.bank_name'], detail: `IFSC prefix ${prefix} belongs to the bank named ("${b.bank_name}").` });
        else add('XREF-03', 'required', {
          label: 'IFSC does not match bank', fields: ['bank.ifsc', 'bank.bank_name'],
          detail: `IFSC prefix ${prefix} belongs to ${kws[0].toUpperCase()}, but the vendor named "${b.bank_name}".`,
          vendor: `The IFSC ${clean(b.ifsc)} belongs to a different bank (${kws[0].toUpperCase()}) than the one you named ("${b.bank_name}").`,
          fix: 'Please check the IFSC and bank name against your cancelled cheque and correct whichever is wrong.',
        });
      } else add('XREF-03', 'skipped', { fields: ['bank.ifsc'], detail: `IFSC prefix ${prefix} is not in the local bank table; not checked.` });
    }

    // XREF-04 Indian tax IDs
    if (c === 'IN') {
      const exempt = !!d.tax_registration_exempt;
      if (usable('tax.gstin', 'tax.pan') && !exempt) {
        const embedded = clean(t.gstin).slice(2, 12);
        if (embedded === clean(t.pan)) add('XREF-04', 'pass', { fields: ['tax.gstin', 'tax.pan'], detail: 'The PAN inside the GSTIN equals the PAN provided.' });
        else add('XREF-04', 'required', {
          label: 'GSTIN and PAN disagree', fields: ['tax.gstin', 'tax.pan'], evidence: { pan_in_gstin: embedded, pan_given: clean(t.pan) },
          detail: `GSTIN ${clean(t.gstin)} embeds PAN ${embedded}, but the PAN provided is ${clean(t.pan)}. Characters 3-12 of every GSTIN are the holder's PAN, so one of the two is wrong or belongs to someone else.`,
          vendor: `Your GSTIN contains the PAN ${embedded}, but the PAN you gave is ${clean(t.pan)}. These must be the same.`,
          fix: 'Please check both numbers against your registration certificates and send the correct pair.',
        });
      }
      if (usable('tax.pan', 'vendor.entity_type')) {
        const want = { company: 'C', llp: 'F', partnership: 'F', sole_proprietor: 'P' }[v.entity_type];
        const got = clean(t.pan)[3];
        if (want && got === want) add('XREF-04', 'pass', { fields: ['tax.pan', 'vendor.entity_type'], detail: `PAN holder-type "${got}" fits entity type "${v.entity_type}".` });
        else if (want) add('XREF-04', 'required', {
          label: 'PAN type does not fit entity', fields: ['tax.pan', 'vendor.entity_type'],
          detail: `The 4th character of the PAN is "${got}", but a ${v.entity_type} should have "${want}".`,
          vendor: `The PAN ${clean(t.pan)} is a ${PAN_TYPES[got] || 'different'} PAN, but you registered as a ${v.entity_type.replace('_', ' ')}.`,
          fix: 'Please confirm the entity type, or send the PAN issued to the registered entity.',
        });
        if (want === 'C' && usable('vendor.legal_name')) {
          const first = prepName(v.legal_name).core[0];
          if (first && clean(t.pan)[4] !== first[0].toUpperCase()) add('XREF-04', 'warn', { fields: ['tax.pan', 'vendor.legal_name'], detail: `A company PAN's 5th character is the first letter of the company name ("${first[0].toUpperCase()}"), but it is "${clean(t.pan)[4]}". Possible if the company was renamed.`, internal: 'Ask whether the company was renamed; look for a name-change certificate.' });
        }
      }
      if (usable('tax.gstin', 'vendor.address.state') && !exempt) {
        const code = clean(t.gstin).slice(0, 2), stName = GST_STATES[code];
        const addrSt = str(v.address.state).toLowerCase().replace(/&/g, 'and');
        if (stName && !(stName.toLowerCase().includes(addrSt) || addrSt.includes(stName.toLowerCase()))) {
          add('XREF-04', 'warn', { fields: ['tax.gstin', 'vendor.address.state'], detail: `GSTIN state code ${code} is ${stName}, but the registered address is in ${v.address.state}. Normal for multi-state vendors; noted.` });
        } else if (stName) add('XREF-04', 'pass', { fields: ['tax.gstin', 'vendor.address.state'], detail: `GSTIN state (${stName}) matches the registered address.` });
      }
    }

    // XREF-05 registration number vs incorporation date
    if (has(v.incorporation_date)) {
      const inc = new Date(v.incorporation_date);
      if (isNaN(inc)) add('XREF-05', 'required', { label: 'Incorporation date', fields: ['vendor.incorporation_date'], detail: `"${v.incorporation_date}" is not a date.`, vendor: 'The incorporation date could not be read.', fix: 'Please give the date as YYYY-MM-DD.' });
      else if (inc > now) add('XREF-05', 'required', { label: 'Incorporation date', fields: ['vendor.incorporation_date'], detail: `Incorporation date ${v.incorporation_date} is in the future.`, vendor: `The incorporation date ${v.incorporation_date} is in the future.`, fix: 'Please send the correct incorporation date.' });
      else if (c === 'IN' && v.entity_type === 'company' && usable('vendor.registration_number') && V.cin(v.registration_number).ok) {
        const y = V.cin(v.registration_number).year;
        if (y === inc.getUTCFullYear()) add('XREF-05', 'pass', { fields: ['vendor.registration_number', 'vendor.incorporation_date'], detail: `CIN year ${y} equals the incorporation year.` });
        else add('XREF-05', 'required', { label: 'CIN and incorporation date disagree', fields: ['vendor.registration_number', 'vendor.incorporation_date'], detail: `The CIN says the company was incorporated in ${y}, the form says ${inc.getUTCFullYear()}.`, vendor: `Your CIN indicates incorporation in ${y}, but the form says ${inc.getUTCFullYear()}.`, fix: 'Please check the CIN and the incorporation date against your certificate of incorporation.' });
      } else add('XREF-05', 'pass', { fields: ['vendor.incorporation_date'], detail: 'Incorporation date is a valid past date.' });
    }

    // XREF-06 coherence
    const issues = [];
    const addrC = getp(sub, 'vendor.address.country');
    if (has(addrC) && has(c) && addrC.toUpperCase() !== c.toUpperCase()) issues.push(`address country (${addrC}) differs from the country of registration (${c})`);
    const phone = getp(sub, 'vendor.contact.phone');
    const pc = { IN: '91', US: '1', GB: '44', DE: '49' }[(c || '').toUpperCase()];
    if (has(phone) && /^\s*\+/.test(phone) && pc && !digitsOf(phone).startsWith(pc)) issues.push(`phone prefix ${phone.trim().split(/\s+/)[0]} does not fit ${c}`);
    const email = getp(sub, 'vendor.contact.email'), ed = domainOf(email);
    if (ed && cfg.free_email_domains.includes(ed) && ['company', 'llp'].includes(v.entity_type)) issues.push(`a registered ${v.entity_type} uses a free email domain (${ed})`);
    if (ed && has(v.website)) {
      const wd = str(v.website).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      if (wd && !cfg.free_email_domains.includes(ed) && wd !== ed && !ed.endsWith('.' + wd) && !wd.endsWith('.' + ed)) issues.push(`email domain (${ed}) differs from the website (${wd})`);
    }
    if (issues.length) add('XREF-06', 'warn', { fields: ['vendor.contact.email'], detail: 'Noted: ' + issues.join('; ') + '. None of these blocks onboarding on its own.', internal: 'Consider a quick call to the registered number to confirm the contact.' });
    else add('XREF-06', 'pass', { detail: 'Address country, phone prefix and email domain are coherent.' });

    // XREF-07 new entity + big spend
    if (has(v.incorporation_date) && r.estimated_annual_spend && !isNaN(new Date(v.incorporation_date))) {
      const age = ddiff(new Date(v.incorporation_date), now), s = r.estimated_annual_spend;
      const lim = cfg.new_entity_spend[s.currency];
      if (lim && age < cfg.new_entity_days && Number(s.amount) >= lim) add('XREF-07', 'review', {
        label: 'Very new entity, large spend', fields: ['vendor.incorporation_date', 'request.estimated_annual_spend'], key: 'XREF-07:' + age + ':' + s.amount,
        detail: `The entity is ${age} days old and the expected annual spend is ${money(s.amount, s.currency)} (limit for entities under ${cfg.new_entity_days} days: ${money(lim, s.currency)}). Newly formed companies with large contracts are a common shell-company profile.`,
        internal: 'Ask the business owner how the vendor was sourced, whether there is a track record under a predecessor, and consider a smaller initial limit.',
        notice: 'Thank you. Because your company is newly established, a member of our team will review the application before approval.',
      });
      else add('XREF-07', 'pass', { fields: ['vendor.incorporation_date', 'request.estimated_annual_spend'], detail: `Entity is ${age} days old; expected spend ${money(s.amount, s.currency)} is within what we accept for its age.` });
    }
  }
  const PAN_TYPES = { P: 'personal', C: 'company', F: 'firm/LLP', H: 'HUF', A: 'AOP', T: 'trust', B: 'BOI', L: 'local authority', J: 'artificial juridical person', G: 'government' };

  /* ---- EXM ------------------------------------------------------------ */
  function checkExemption(ctx, add) {
    const { sub, cfg } = ctx;
    const v = sub.vendor || {}, d = sub.declarations || {}, r = sub.request || {};
    if (!d.tax_registration_exempt) return;
    const x = cfg.exemption[v.country];
    if (!x) { add('EXM-01', 'review', { fields: ['declarations.tax_registration_exempt'], key: 'EXM-01:nocfg:' + v.country, detail: `Exemption claimed, but no exemption rules are configured for country ${v.country}.`, internal: 'Have the tax team confirm the exemption manually.', notice: 'Your exemption declaration is being reviewed by our team.' }); return; }
    const turn = d.exemption_turnover || d.annual_turnover, spend = r.estimated_annual_spend;
    const miss = [];
    if (!has(d.exemption_basis)) miss.push(['declarations.exemption_basis', 'the basis for the exemption']);
    if (!turn || !has(turn.amount)) miss.push(['declarations.annual_turnover', 'your total turnover for the last financial year']);
    if (miss.length) { miss.forEach(([f, l]) => add('EXM-01', 'required', { label: 'Exemption details', fields: [f], detail: `Exemption claimed but ${l} is missing.`, vendor: `You declared you don't need to register for ${x.label}, but we are missing ${l}.`, fix: `Please provide ${l}.` })); return; }
    if (d.exemption_basis !== 'below_threshold') {
      add('EXM-01', 'review', { fields: ['declarations.exemption_basis'], key: 'EXM-01:basis:' + d.exemption_basis, detail: `Exemption basis is "${d.exemption_basis}", which is not the simple below-threshold case.`, internal: 'Tax team to confirm the exemption applies to the vendor\'s supplies.', notice: 'Your exemption declaration is being reviewed by our team.' });
      return;
    }
    if (turn.currency !== x.currency || !spend || spend.currency !== x.currency) {
      add('EXM-01', 'review', { fields: ['declarations.annual_turnover', 'request.estimated_annual_spend'], key: 'EXM-01:cur', detail: `Cannot compare turnover/spend currencies to the ${x.currency} threshold.`, internal: 'Convert manually and compare with the threshold.', notice: 'Your exemption declaration is being reviewed by our team.' });
      return;
    }
    const supply = v.supply_type === 'goods' ? 'goods' : 'services';
    const limit = x[supply];
    const T = Number(turn.amount), S = Number(spend.amount);
    const lim = money(limit, x.currency);
    if (T >= limit) { add('EXM-01', 'required', { label: `${x.label} registration is required`, fields: ['declarations.annual_turnover'], detail: `Declared turnover ${money(T, x.currency)} is at or above the ${supply} registration threshold ${lim}. The exemption does not apply.`, vendor: `Your declared turnover (${money(T, x.currency)}) is above the ${x.label} registration threshold (${lim}), so the exemption doesn't apply.`, fix: `Please register for ${x.label} and send the registration number and certificate.` }); return; }
    if (S >= limit) { add('EXM-01', 'required', { label: `Expected billing exceeds ${x.label} threshold`, fields: ['request.estimated_annual_spend', 'declarations.tax_registration_exempt'], evidence: { turnover: T, our_expected_spend: S, threshold: limit }, detail: `The exemption is credible on last year's turnover (${money(T, x.currency)}), but our own expected spend with this vendor (${money(S, x.currency)}) alone exceeds the threshold (${lim}). Within a year the vendor would be required to register, so an exempt profile cannot be accepted for this contract size.`, vendor: `The work we'd like to give you (about ${money(S, x.currency)} a year) is above the ${lim} limit under which ${x.label} registration is optional, so you would need to be registered.`, fix: `Please register for ${x.label} and send the registration number and certificate, or let us know if the expected volume is lower.` }); return; }
    add('EXM-01', 'pass', { fields: ['declarations.tax_registration_exempt'], detail: `Exemption supported: turnover ${money(T, x.currency)} and expected spend ${money(S, x.currency)} are both below the ${supply} threshold ${lim}.` });
    const peak = Math.max(T, S);
    if (peak >= limit * x.watch_pct) {
      const cap = Math.round(limit * x.cap_pct);
      add('EXM-01', 'warn', { fields: ['request.estimated_annual_spend'], detail: `Turnover/spend is at or above ${Math.round(x.watch_pct * 100)}% of the threshold (${lim}); a spend cap is applied so the vendor cannot silently cross it.`, condition: { code: 'SPEND_CAP', amount: cap, currency: x.currency, text: `Cap payments at ${money(cap, x.currency)} per financial year. Above that, a ${x.label} registration number is required before further payments.`, vendor_text: `Because you are not registered for ${x.label}, payments to you are capped at ${money(cap, x.currency)} per financial year. If you cross it, we'll need your registration number.` } });
    }
    add('EXM-01', 'warn', { fields: ['declarations.tax_registration_exempt'], detail: 'Unregistered vendors must not charge tax on invoices.', condition: { code: 'NO_TAX_ON_INVOICE', text: `Reject any invoice from this vendor that charges ${x.label}.`, vendor_text: `Please don't charge ${x.label} on your invoices, since you are not registered.` } });
    add('EXM-01', 'warn', { fields: ['declarations.tax_registration_exempt'], detail: 'Exemptions lapse silently; re-verify yearly.', condition: { code: 'REVERIFY', text: 'Re-verify the exemption and turnover declaration in 12 months.' } });
  }

  /* ---- DOC ------------------------------------------------------------ */
  function checkDocuments(ctx, add) {
    const { sub, now, cfg } = ctx;
    const v = sub.vendor || {}, b = sub.bank || {};
    const docs = Array.isArray(sub.documents) ? sub.documents : [];
    const reqs = requiredDocs(sub);
    const eff = (x) => (x.extracted && x.extracted.detected_type) || x.declared_type;
    const used = new Map();
    reqs.forEach((rq) => { const g = docs.find((x) => rq.accepts.includes(eff(x))); if (g) used.set(g, rq); });
    const dfield = (x) => 'documents.' + x.declared_type;
    const lab = (t) => DOC_LABEL[t] || t;

    // DOC-01 type / legibility / parsed
    docs.forEach((x) => {
      const ex = x.extracted;
      const f = [dfield(x)];
      if (!ex) { add('DOC-01', 'review', { label: 'Unread document', fields: f, key: 'DOC-01:unread:' + x.declared_type + hash(str(x.filename)), detail: `${x.filename || x.declared_type} has no extracted data, so it could not be checked automatically.`, internal: `Read ${x.filename || x.declared_type} manually and compare it with the form.`, notice: 'We are reviewing your documents.' }); return; }
      if (ex.legible === false) { add('DOC-01', 'required', { label: 'Document unreadable', fields: f, detail: `${x.filename} could not be read (illegible or corrupt).`, vendor: `We couldn't read the file "${x.filename}".`, fix: `Please upload a clear, complete scan or photo of the ${lab(x.declared_type)}.` }); return; }
      const det = ex.detected_type;
      if (det && det !== x.declared_type) {
        const rq = reqs.find((r) => r.accepts.includes(x.declared_type));
        if (rq && rq.accepts.includes(det)) add('DOC-01', 'pass', { fields: f, detail: `${x.filename} was labelled "${lab(x.declared_type)}" and is a ${lab(det)}; both are accepted for this requirement.` });
        else add('DOC-01', 'required', { label: 'Wrong document attached', fields: f, evidence: { declared: x.declared_type, detected: det }, detail: `${x.filename} was uploaded as "${lab(x.declared_type)}" but document analysis says it is a ${lab(det)}.`, vendor: `The file "${x.filename}" was uploaded as the ${lab(x.declared_type)}, but it looks like a ${lab(det)}.`, fix: `Please upload the ${lab(x.declared_type)}${rq && rq.hint ? ' (' + rq.hint + ')' : ''}.` });
      } else add('DOC-01', 'pass', { fields: f, detail: `${x.filename || x.declared_type} is a ${lab(x.declared_type)} as declared.` });
    });

    used.forEach((rq, x) => {
      const ex = x.extracted;
      if (!ex || ex.legible === false) return;
      const f = dfield(x);
      if (ctx.bad.has(f)) return;
      // DOC-02 expiry
      if (has(ex.expires_on)) {
        const exp = new Date(ex.expires_on), days = ddiff(now, exp);
        if (exp < now) add('DOC-02', 'required', { label: 'Document expired', fields: [f], detail: `${lab(x.declared_type)} expired on ${ex.expires_on} (${-days} days ago).`, vendor: `The ${lab(x.declared_type)} expired on ${ex.expires_on}.`, fix: 'Please upload a current, valid copy.' });
        else if (days <= cfg.doc_expiry_warn_days) add('DOC-02', 'warn', { fields: [f], detail: `${lab(x.declared_type)} expires on ${ex.expires_on} (in ${days} days).`, condition: { code: 'REVERIFY', text: `Request a renewed ${lab(x.declared_type)} before ${ex.expires_on}.`, vendor_text: `Your ${lab(x.declared_type)} expires on ${ex.expires_on}; please send the renewed copy when you have it.` } });
        else add('DOC-02', 'pass', { fields: [f], detail: `${lab(x.declared_type)} is valid until ${ex.expires_on}.` });
      }
      if (ex.signed === false) add('DOC-01', 'required', { label: 'Document not signed', fields: [f], detail: `${lab(x.declared_type)} is unsigned.`, vendor: `The ${lab(x.declared_type)} is not signed.`, fix: 'Please sign it and upload it again.' });
      const isBank = rq.key === 'bank';
      // DOC-03 name
      if (!isBank && has(ex.name) && has(v.legal_name)) {
        const m = bestNameMatch(ex.name, acceptedNames(sub));
        const ev = { on_document: ex.name, compared_with: m.against, level: m.level };
        if (nameOK(m)) add('DOC-03', 'pass', { fields: [f, 'vendor.legal_name'], evidence: ev, detail: `Name on ${lab(x.declared_type)} ("${ex.name}") matches the legal name (${m.note}).` });
        else if (m.level === 'close') add('DOC-03', 'warn', { fields: [f, 'vendor.legal_name'], evidence: ev, detail: `Name on ${lab(x.declared_type)} ("${ex.name}") is almost identical to "${m.against}" (${m.note}).` });
        else add('DOC-03', 'required', { label: 'Name on document differs', fields: [f, 'vendor.legal_name'], evidence: ev, detail: `Name on ${lab(x.declared_type)} is "${ex.name}", the form says "${v.legal_name}" (${m.note}).`, vendor: `The ${lab(x.declared_type)} is issued to "${ex.name}", but you registered as "${v.legal_name}".`, fix: 'If the company changed its name, please send the name-change certificate. Otherwise upload the document issued to the registered legal entity.' });
      }
      // DOC-04 number
      const idPath = DOC_ID_FIELD[x.declared_type] || DOC_ID_FIELD[eff(x)];
      if (!isBank && idPath && has(ex.id_number) && has(getp(sub, idPath)) && !ctx.bad.has(idPath)) {
        if (clean(ex.id_number) === clean(getp(sub, idPath))) add('DOC-04', 'pass', { fields: [f, idPath], detail: `Number on ${lab(x.declared_type)} (${clean(ex.id_number)}) equals the number on the form.` });
        else add('DOC-04', 'required', { label: 'Number on document differs', fields: [f, idPath], evidence: { on_document: clean(ex.id_number), on_form: clean(getp(sub, idPath)) }, detail: `${lab(x.declared_type)} shows ${clean(ex.id_number)}, the form says ${clean(getp(sub, idPath))}.`, vendor: `The ${lab(x.declared_type)} shows ${clean(ex.id_number)}, but the form says ${clean(getp(sub, idPath))}.`, fix: 'Please correct whichever is wrong, or attach the right document.' });
      }
      // DOC-05 bank proof
      if (isBank) {
        const probs = [];
        if (has(ex.issued_on)) {
          const age = ddiff(new Date(ex.issued_on), now);
          if (age > cfg.bank_proof_max_age_days) probs.push({ k: 'age', detail: `Bank proof is dated ${ex.issued_on}, ${age} days old (limit ${cfg.bank_proof_max_age_days}).`, vendor: `The bank proof is dated ${ex.issued_on}, which is more than ${cfg.bank_proof_max_age_days} days ago.`, fix: 'Please send a bank letter or statement issued in the last 90 days.' });
        }
        const acct = has(b.account_number) ? b.account_number : b.iban;
        if (has(ex.account_last4) && has(acct) && !ctx.bad.has('bank.account_number') && !ctx.bad.has('bank.iban') && ex.account_last4 !== last4(acct)) probs.push({ k: 'acct', detail: `Bank proof shows an account ending ${ex.account_last4}; the form says …${last4(acct)}.`, vendor: `The bank proof shows an account ending in ${ex.account_last4}, but the form says …${last4(acct)}.`, fix: 'Please correct the account number on the form or send proof for the right account.', fields: [f, has(b.account_number) ? 'bank.account_number' : 'bank.iban'] });
        if (has(ex.holder_name) && has(b.account_holder_name) && !ctx.bad.has('bank.account_holder_name')) {
          const m = nameMatch(ex.holder_name, b.account_holder_name);
          if (m.level === 'close') add('DOC-05', 'warn', { fields: [f, 'bank.account_holder_name'], detail: `Holder on bank proof ("${ex.holder_name}") is almost identical to the form ("${b.account_holder_name}").` });
          else if (!nameOK(m)) probs.push({ k: 'holder', detail: `Holder on bank proof is "${ex.holder_name}", the form says "${b.account_holder_name}" (${m.note}).`, vendor: `The bank proof names "${ex.holder_name}" as account holder, but the form says "${b.account_holder_name}".`, fix: 'Please correct the form or send proof for an account held in the right name.', fields: [f, 'bank.account_holder_name'] });
        }
        if (!probs.length) add('DOC-05', 'pass', { fields: [f], detail: 'Bank proof is recent, and its account tail and holder name match the form.' });
        probs.forEach((p) => add('DOC-05', 'required', { label: 'Bank proof problem', fields: p.fields || [f], detail: p.detail, vendor: p.vendor, fix: p.fix }));
      }
    });

    // DOC-06 integrity
    const flagged = docs.filter((x) => x.extracted && Array.isArray(x.extracted.integrity_flags) && x.extracted.integrity_flags.length);
    if (!flagged.length && docs.length) add('DOC-06', 'pass', { detail: 'No integrity signals on any document.' });
    flagged.forEach((x) => add('DOC-06', 'review', { label: 'Document integrity', fields: [dfield(x)], key: 'DOC-06:' + x.declared_type + ':' + x.extracted.integrity_flags.join(','), detail: `${lab(x.declared_type)} carries integrity signals: ${x.extracted.integrity_flags.join(', ')}. Automated detection cannot prove forgery, so a person decides.`, internal: `Inspect the original of the ${lab(x.declared_type)} and confirm with the issuing authority.`, notice: 'We are reviewing your documents.' }));
  }

  /* ---- VER ------------------------------------------------------------ */
  function checkVerification(ctx, add) {
    const { sub, context } = ctx;
    const v = sub.vendor || {}, t = sub.tax || {}, d = sub.declarations || {};
    if (isUpdate(sub)) return;
    let ident = null;
    if (v.country === 'IN') ident = has(t.gstin) && !d.tax_registration_exempt ? { path: 'tax.gstin', kind: 'GSTIN', auth: 'GST portal' } : { path: 'tax.pan', kind: 'PAN', auth: 'income-tax database' };
    if (v.country === 'US') ident = { path: 'tax.tin', kind: t.tin_type || 'TIN', auth: 'IRS TIN-matching service' };
    if (v.country === 'GB') ident = { path: 'tax.vat_number', kind: 'VAT number', auth: 'HMRC VAT service' };
    if (v.country === 'DE') ident = { path: 'tax.vat_number', kind: 'USt-IdNr', auth: 'VIES VAT validation' };
    if (!ident || !has(getp(sub, ident.path))) return;
    if (ctx.bad.has(ident.path)) { add('VER-01', 'skipped', { fields: [ident.path], detail: `Skipped: the ${ident.kind} failed validation, so there is nothing to look up.` }); return; }
    if (context.registry === undefined) { add('VER-01', 'skipped', { fields: [ident.path], detail: 'No registry connected; lookup skipped.' }); return; }
    if (context.registry === null) { add('VER-01', 'warn', { fields: [ident.path], detail: `The ${ident.auth} could not be reached. The vendor is not penalised; verification is queued.`, internal: `Verify ${clean(getp(sub, ident.path))} on the ${ident.auth} by hand before the first payment.`, condition: { code: 'MANUAL_TAX_VERIFY', text: `Verify the tax ID on the ${ident.auth} before the first payment.` } }); return; }
    const id = clean(getp(sub, ident.path));
    const rec = context.registry[id];
    if (!rec) { add('VER-01', 'required', { label: `${ident.kind} not found`, fields: [ident.path], detail: `${id} was not found in the ${ident.auth}.`, vendor: `We couldn't find the ${ident.kind} ${id} in the ${ident.auth}.`, fix: 'Please check the number, or send proof of registration (certificate or recent filing receipt).' }); return; }
    if (rec.status !== 'active') {
      add('VER-01', 'block', { label: `${ident.kind} is ${rec.status}`, fields: [ident.path], detail: `${id} is ${rec.status} in the ${ident.auth} (since ${rec.status_since || 'unknown date'}). A vendor cannot be paid under a cancelled or suspended registration.`, vendor: `The ${ident.kind} ${id} shows as ${rec.status} on the ${ident.auth}${rec.status_since ? ' since ' + rec.status_since : ''}. We can't onboard a vendor with an inactive registration. If it is reinstated, you're welcome to submit again.` });
      return;
    }
    add('VER-01', 'pass', { fields: [ident.path], detail: `${id} is active in the ${ident.auth}.` });
    const m = bestNameMatch(rec.legal_name, acceptedNames(sub));
    const ev = { registry_name: rec.legal_name, compared_with: m.against, level: m.level };
    if (nameOK(m)) add('VER-02', 'pass', { fields: ['vendor.legal_name'], evidence: ev, detail: `Registered name "${rec.legal_name}" matches the submitted legal name (${m.note}).` });
    else if (m.level === 'close') add('VER-02', 'warn', { fields: ['vendor.legal_name'], evidence: ev, detail: `Registered name "${rec.legal_name}" is almost identical to "${m.against}" (${m.note}).` });
    else {
      const us = v.country === 'US';
      add('VER-02', 'required', { label: 'Name does not match tax registry', fields: ['vendor.legal_name', ident.path], evidence: us ? { level: m.level } : ev, detail: `The ${ident.auth} has "${rec.legal_name}" for ${id}; the form says "${v.legal_name}" (${m.note}).`, vendor: us ? `The name and taxpayer ID don't match IRS records.` : `The ${ident.auth} lists "${rec.legal_name}" for ${id}, but you registered as "${v.legal_name}".`, fix: us ? 'Please send the name exactly as on your tax return, and a corrected W-9.' : 'Please use the name exactly as on the registration, or send the name-change documents.' });
    }
  }

  /* ---- RISK ----------------------------------------------------------- */
  function checkRisk(ctx, add) {
    const { sub, cfg, context } = ctx;
    const v = sub.vendor || {}, t = sub.tax || {}, b = sub.bank || {}, d = sub.declarations || {};
    const GENERIC = 'Thank you for your submission. It is now with our review team; nothing is needed from you right now and we will contact you if we need anything.';

    // RISK-02 embargo
    const cs = uniq([v.country, getp(sub, 'vendor.address.country'), bankCountry(b)].filter(has).map((x) => str(x).toUpperCase()));
    const hit = cs.filter((x) => cfg.embargoed_countries.includes(x));
    if (hit.length) add('RISK-02', 'block', { label: 'Embargoed jurisdiction', fields: ['vendor.country', 'bank.country'], confidential: true, detail: `Country ${hit.join(', ')} is on the embargoed list (policy list; configure with compliance).` });
    else if (cs.length) add('RISK-02', 'pass', { detail: `Countries involved (${cs.join(', ')}) are not on the embargoed list.` });

    // RISK-04 declarations
    if (d.sanctions_clean === false) add('RISK-04', 'block', { label: 'Vendor declared a sanctions issue', fields: ['declarations.sanctions_clean'], confidential: true, detail: 'The vendor answered "no" to the sanctions declaration.' });
    if (d.pep === true) add('RISK-04', 'review', { label: 'Politically exposed person', fields: ['declarations.pep'], key: 'RISK-04:pep:' + hash(JSON.stringify(d.beneficial_owners || [])), detail: 'The vendor declared a politically exposed person among owners or officers. Enhanced due diligence applies; it is not a reason to refuse.', internal: 'Run enhanced due diligence: source of funds, adverse-media search, senior approval.', notice: GENERIC });
    if (d.sanctions_clean === true && d.pep !== true) add('RISK-04', 'pass', { detail: 'Sanctions declaration clean; no PEP declared.' });

    // RISK-01 screening
    const subjects = [['legal name', v.legal_name, v.country], ['trade name', v.trade_name, v.country], ['bank account holder', b.account_holder_name, bankCountry(b)]]
      .concat((d.beneficial_owners || []).map((o) => ['beneficial owner', o.name, o.country])).filter((s) => has(s[1]));
    let screened = 0, anyHit = false;
    const seenHits = new Set();
    subjects.forEach(([role, name, country]) => {
      screened++;
      cfg.sanctions_list.forEach((e) => {
        const best = [e.name].concat(e.aliases || []).map((n) => Object.assign({ listed: n }, nameMatch(name, n))).sort((a, b2) => b2.score - a.score)[0];
        const strong = nameOK(best), possible = best.level === 'close' || (best.level === 'partial' && (best.shared || 0) >= 2 && best.score >= 0.66);
        if (!strong && !possible) return;
        anyHit = true;
        const sameCountry = has(country) && has(e.country) && str(country).toUpperCase() === e.country;
        const key = `RISK-01:${e.id}:${hash(prepName(name).core.join(' '))}`;
        if (seenHits.has(key)) return; // same name appearing as legal name and bank holder: one finding
        seenHits.add(key);
        const ev = { screened: name, role, listed_as: best.listed, list: e.list, list_id: e.id, listed_country: e.country, subject_country: country || null, match: best.level, score: Number(best.score.toFixed(2)) };
        if (strong && (sameCountry || !has(country))) add('RISK-01', 'block', { label: 'Watchlist match', fields: ['vendor.legal_name'], key, evidence: ev, confidential: true, detail: `${role} "${name}" is an ${best.level} match for ${e.list} entry ${e.id} ("${best.listed}"), and the country agrees (${e.country}).` });
        else add('RISK-01', 'review', {
          label: 'Possible watchlist match', fields: ['vendor.legal_name'], key, evidence: ev, confidential: true,
          detail: `${role} "${name}" is ${strong ? 'an' : 'a'} ${best.level} match (${best.note}) for ${e.list} entry ${e.id} ("${best.listed}", ${e.country}); ${sameCountry ? 'the country agrees' : 'the countries differ (' + (country || 'unknown') + ' vs ' + e.country + ')'}. Could be a false positive on a common name — a person must decide. The vendor is NOT told why.`,
          internal: `Compliance to compare ${e.id} with the vendor's address, owners and dates of birth. Do not discuss the screening result with the vendor.`,
          notice: GENERIC, hold: true, priority: 'high',
        });
      });
    });
    if (!anyHit) add('RISK-01', 'pass', { detail: `${screened} names screened against ${cfg.sanctions_list.length} watchlist entries: no match.` });

    // RISK-03 duplicates
    const regs = (context.vendors || []).filter((x) => x.id !== sub.existing_vendor_id);
    const mine = uniq([t.pan, t.gstin, t.tin, t.vat_number, t.tax_number, t.tax_id, v.registration_number, has(t.gstin) && V.gstin(t.gstin).ok ? V.gstin(t.gstin).pan : '']
      .filter(has).map(clean));
    const myBank = bankFp(b);
    let dup = false;
    regs.forEach((o) => {
      const shared = (o.tax_ids || []).map(clean).filter((x) => mine.includes(x));
      const sameBank = myBank && bankFp(o.bank || {}) === myBank;
      const nm = has(v.legal_name) ? nameMatch(v.legal_name, o.legal_name) : { level: 'none' };
      const similar = nm.level === 'equivalent' || nm.level === 'exact' || nm.level === 'close';
      const blocked = ['blocked', 'terminated'].includes(o.status);
      if (shared.length || sameBank) {
        dup = true;
        const why = [shared.length ? `same tax ID (${shared.join(', ')})` : null, sameBank ? 'identical bank account' : null].filter(Boolean).join(' and ');
        const key = `RISK-03:${o.id}:${shared.join('')}:${sameBank ? 'bank' : ''}`;
        if (blocked) add('RISK-03', 'block', { label: 'Linked to a blocked vendor', fields: shared.length ? ['tax'] : ['bank.account_number'], key, confidential: true, evidence: { existing_vendor: o.id, status: o.status, reason: o.block_reason }, detail: `Submission shares ${why} with ${o.id} "${o.legal_name}", which is ${o.status}${o.block_reason ? ' (' + o.block_reason + ')' : ''}.` });
        else add('RISK-03', 'review', { label: 'Duplicate / shared identifiers', fields: shared.length ? ['tax'] : ['bank.account_number'], key, confidential: true, evidence: { existing_vendor: o.id }, detail: `Submission shares ${why} with active vendor ${o.id} "${o.legal_name}". Either this is a duplicate registration, or two vendors are sharing a bank account (a diversion red flag).`, internal: `Compare with ${o.id}; if it is the same vendor, update that record instead of creating a new one.`, notice: GENERIC });
      } else if (similar && !isUpdate(sub)) {
        dup = true;
        add('RISK-03', 'review', { label: 'Similar vendor name', fields: ['vendor.legal_name'], key: `RISK-03:name:${o.id}`, confidential: true, evidence: { existing_vendor: o.id, level: nm.level }, detail: `Name is a ${nm.level} match for existing vendor ${o.id} "${o.legal_name}", but no tax ID is shared.`, internal: `Confirm this is a different entity from ${o.id} (look-alike company names are a common fraud technique).`, notice: GENERIC });
      }
    });
    if (!dup) add('RISK-03', 'pass', { detail: `Compared with ${regs.length} existing vendors: no shared tax ID, no shared bank account, no look-alike name.` });

    // RISK-05 bank change
    if (isUpdate(sub)) {
      const on = (context.vendors || []).find((x) => x.id === sub.existing_vendor_id);
      if (!on) { add('RISK-05', 'review', { label: 'Unknown vendor ID', fields: ['existing_vendor_id'], key: 'RISK-05:unknown:' + sub.existing_vendor_id, confidential: true, detail: `existing_vendor_id "${sub.existing_vendor_id}" is not in the vendor master.`, internal: 'Find out where this vendor ID came from before anything else.', notice: GENERIC, hold: true }); return; }
      const sameBankDetails = bankFp(b) === bankFp(on.bank || {}) && nameMatch(b.account_holder_name || '', (on.bank || {}).account_holder_name || on.legal_name).level !== 'mismatch';
      if (sameBankDetails) { add('RISK-05', 'pass', { detail: `Bank details are unchanged from the record for ${on.id}.` }); return; }
      const sig = [];
      const nd = domainOf(getp(sub, 'vendor.contact.email')), od = domainOf((on.contact || {}).email);
      if (nd && od && nd !== od) sig.push(lev(nd, od) <= 2 ? `request comes from a look-alike domain (${nd} vs ${od} on file)` : `request comes from a different email domain (${nd} vs ${od} on file)`);
      const np = digitsOf(getp(sub, 'vendor.contact.phone')), op = digitsOf((on.contact || {}).phone);
      if (np && op && np !== op) sig.push('the phone number in the request differs from the one on file');
      if (nameMatch(v.legal_name || '', on.legal_name).level === 'mismatch') sig.push('the company name differs from the vendor master');
      const nbc = bankCountry(b), obc = bankCountry(on.bank || {});
      if (nbc && obc && nbc !== obc) sig.push(`the new account is in ${nbc}, the old one in ${obc}`);
      if (b.account_holder_name && (on.bank || {}).account_holder_name && nameMatch(b.account_holder_name, on.bank.account_holder_name).level === 'mismatch') sig.push('the account holder name changed');
      const note = [sub.notes, getp(sub, 'request.notes')].filter(has).join(' ');
      if (cfg.urgency_terms.test(note)) sig.push('the request uses urgency or pressure language and discourages contact');
      if (has(sub.channel) && sub.channel !== 'portal') sig.push(`it arrived by ${sub.channel}, not through the authenticated vendor portal`);
      const high = sig.length >= 3;
      const phone = (on.contact || {}).phone;
      add('RISK-05', 'review', {
        label: 'Bank details changed', fields: ['bank.account_number', 'bank.iban', 'bank.ifsc'], key: 'RISK-05:' + on.id + ':' + bankFp(b), hold: true, priority: high ? 'high' : 'normal',
        route: { type: 'on_file', email: (on.contact || {}).email },
        evidence: { existing_vendor: on.id, signals: sig, previous_account_tail: last4((on.bank || {}).account_number || (on.bank || {}).iban), new_account_tail: last4(b.account_number || b.iban) },
        detail: `Bank details for ${on.id} "${on.legal_name}" changed. Policy: every bank change is verified out of band. ${sig.length ? 'Warning signs (' + sig.length + '): ' + sig.join('; ') + '.' : 'No warning signs found, but the callback is still required.'}${high ? ' This matches the business-email-compromise pattern.' : ''}`,
        internal: [`Hold payments to ${on.id} on the NEW account until verified (old account stays active).`, `Call ${(on.contact || {}).name || 'the contact'} on the number ON FILE (${phone || 'see vendor master'}), not on any number in this request.`].concat(high ? ['Notify the security/fraud desk: pattern consistent with business-email-compromise.'] : []).join(' '),
        notice: `We received a request to change the payment details for ${on.legal_name}. As a security precaution we confirm every change by phone with the contact we already have on file, and we are not paying to the new account until then. If you did not make this request, please contact us immediately using the details you already have for us.`,
        conditionOnClear: { code: 'FIRST_PAYMENT_CHECK', text: 'First payment to the new account needs a second approver.' },
      });
    }
  }
  const bankFp = (b) => (has(b.account_number) || has(b.iban) ? [clean(b.account_number), clean(b.ifsc || b.routing_number || b.sort_code), clean(b.iban)].join('|') : '');

  /* ---- CASE ----------------------------------------------------------- */
  const SENSITIVE = ['vendor.legal_name', 'vendor.country', 'vendor.registration_number', 'tax.', 'bank.account_number', 'bank.ifsc', 'bank.iban', 'bank.routing_number', 'bank.sort_code', 'bank.account_holder_name', 'bank.bank_name', 'declarations.beneficial_owners'];
  function checkCase(ctx, add) {
    const ci = ctx.caseInfo;
    if (!ci || ci.round <= 1) { add('CASE-01', 'pass', { detail: 'First submission: nothing to compare against.' }); }
    else if (!ci.silent.length) add('CASE-01', 'pass', { detail: `Round ${ci.round}: ${ci.changed.length} field(s) changed and every one of them was something we asked for.` });
    else {
      const sens = ci.silent.filter((p) => SENSITIVE.some((s) => p === s || p.startsWith(s)));
      if (!sens.length) add('CASE-01', 'warn', { fields: ci.silent, detail: `Also changed although not requested: ${ci.silent.join(', ')}. None is an identity or bank field.` });
      else add('CASE-01', 'review', {
        label: 'Unrequested change to identity/bank fields', fields: sens, key: 'CASE-01:' + hash(sens.map((p) => p + '=' + (ci.silent_values[p] || '')).join('|')), hold: true, priority: 'high',
        route: ci.original_email ? { type: 'original', email: ci.original_email } : undefined,
        evidence: { changed_without_request: sens, previous: ci.previous_values && sens.reduce((o, p) => { o[p] = ci.previous_values[p]; return o; }, {}), now: sens.reduce((o, p) => { o[p] = ci.silent_values[p]; return o; }, {}) },
        detail: `Round ${ci.round}: besides the items we asked about, the vendor also changed ${sens.join(', ')}. These were not wrong and not requested. "Fixing" a mismatch by switching to a different account, or quietly changing the name, is how fraudulent details slip in, so this is handled like a bank-change request.`,
        internal: `Confirm the change by phone with the contact from the FIRST submission (${ci.original_email || 'see round 1'}). Ask why it changed. Do not accept it on email alone.`,
        notice: `Along with the corrections we asked for, your resubmission also changed other details (${uniq(sens.map(humanField)).join(', ')}) that we hadn't asked about. Changes to company, tax or bank details are confirmed with the original contact before we accept them. Please reply to confirm they were intentional.`,
        conditionOnClear: { code: 'FIRST_PAYMENT_CHECK', text: 'First payment after the unrequested change needs a second approver.' },
      });
    }
    // CASE-02 round limit
    if (ci && ci.round >= CONFIG.max_rounds) {
      const vendorOpen = ctx.checks.some((c) => c.outcome === 'required');
      if (vendorOpen) add('CASE-02', 'review', { label: 'Round limit reached', key: 'CASE-02:' + ci.round, detail: `This is round ${ci.round} and the vendor-facing items are still not resolved. More emails will not help.`, internal: 'Stop the email loop. Phone the vendor contact and walk through the open items, or ask the business owner to intervene.', priority: 'high' });
      else add('CASE-02', 'pass', { detail: `Round ${ci.round}: no vendor-facing items left.` });
    } else if (ci) add('CASE-02', 'pass', { detail: `Round ${ci.round} of ${CONFIG.max_rounds}.` });
  }

  /* =====================================================================
   * 7. DECISION + VENDOR MESSAGE
   * ===================================================================== */
  const SEV = { pass: 0, skipped: 0, warn: 1, required: 2, review: 3, block: 4 };
  const CAT_RANK = Object.fromEntries(CATEGORIES.map((c, i) => [c, i]));

  function evaluate(sub, opts) {
    opts = opts || {};
    sub = sub || {};
    const now = new Date(opts.now || Date.now());
    const cfg = Object.assign({}, CONFIG, opts.config || {});
    const ctx = { sub, now, cfg, context: opts.context || {}, checks: [], bad: new Set(), overrides: opts.overrides || [], caseInfo: opts.caseInfo || null };
    const add = mkAdd(ctx);

    checkCompleteness(ctx, add);
    checkFormats(ctx, add);
    checkExemption(ctx, add);
    checkConsistency(ctx, add);
    checkDocuments(ctx, add);
    checkVerification(ctx, add);
    checkRisk(ctx, add);
    checkCase(ctx, add);

    const checks = ctx.checks;
    const counts = { pass: 0, warn: 0, required: 0, review: 0, block: 0, skipped: 0 };
    checks.forEach((c) => counts[c.outcome]++);
    const status = counts.block ? 'rejected' : counts.required || counts.review ? 'pending' : 'approved';
    const waiting_on = status !== 'pending' ? null : counts.required && counts.review ? 'both' : counts.required ? 'vendor' : 'internal';
    const priority = checks.some((c) => c.priority === 'high' && (c.outcome === 'review' || c.outcome === 'block')) || counts.block ? 'high' : 'normal';
    const conditions = status === 'approved' ? checks.filter((c) => c.condition && (c.outcome === 'warn' || c.outcome === 'pass')).map((c) => Object.assign({ rule_id: c.rule_id }, c.condition)) : [];
    const dedup = []; conditions.forEach((c) => { if (!dedup.some((x) => x.code === c.code && x.text === c.text)) dedup.push(c); });
    const reasons = checks.filter((c) => SEV[c.outcome] >= 2).sort((a, b) => SEV[b.outcome] - SEV[a.outcome]).map((c) => ({ rule_id: c.rule_id, outcome: c.outcome, label: c.label || c.title, text: c.detail }));

    const holds = checks.some((c) => c.hold && c.outcome === 'review');
    const actions = uniq(checks.filter((c) => c.internal && (c.outcome === 'review' || c.outcome === 'warn' || c.outcome === 'block')).map((c) => c.internal));
    const internal = { hold_payments: holds, actions };

    const summary = summarize(status, waiting_on, counts, dedup, checks);
    const res = {
      engine_version: '1.0.0', submission_id: sub.submission_id || null, case_ref: opts.caseRef || null,
      evaluated_at: now.toISOString(), status, waiting_on, priority, summary, reasons, counts,
      checks, conditions: dedup, internal, vendor_message: null, audit: [],
    };
    res.vendor_message = buildVendorMessage(res, ctx);
    res.audit.push({ ts: now.toISOString(), actor: 'system', event: 'evaluated', detail: `${checks.length} checks run: ${counts.pass} pass, ${counts.warn} warn, ${counts.required} need vendor, ${counts.review} need review, ${counts.block} block, ${counts.skipped} skipped → ${status}${waiting_on ? ' (waiting on ' + waiting_on + ')' : ''}` });
    return res;
  }

  function summarize(status, waiting_on, counts, conds, checks) {
    if (status === 'approved') return `Approved. ${counts.pass} checks passed${counts.warn ? `, ${counts.warn} noted` : ''}${conds.length ? `; ${conds.length} condition${conds.length > 1 ? 's' : ''} apply` : ''}.`;
    if (status === 'rejected') {
      const b = checks.filter((c) => c.outcome === 'block');
      return `Rejected. ${b.map((c) => c.label || c.title).join('; ')}.${b.some((c) => c.confidential) ? ' (Reason is internal only; the vendor gets a neutral decline.)' : ''}`;
    }
    const parts = [];
    if (counts.required) parts.push(`${counts.required} item${counts.required > 1 ? 's' : ''} for the vendor to fix`);
    if (counts.review) parts.push(`${counts.review} for internal review`);
    return `Pending: ${parts.join(' and ')}.`;
  }

  function buildVendorMessage(res, ctx) {
    const { sub, now, cfg } = ctx;
    const v = sub.vendor || {};
    const cname = (v.contact && v.contact.name) || 'there';
    const ref = res.case_ref ? ` (ref ${res.case_ref})` : sub.submission_id ? ` (ref ${sub.submission_id})` : '';
    const byRank = (a, b) => CAT_RANK[a.category] - CAT_RANK[b.category];
    const checks = res.checks;
    const sign = `\nRegards,\nVendor Onboarding, ${cfg.buyer}`;
    const respondBy = isoDay(new Date(now.getTime() + cfg.sla.expire_days * DAY));
    const routeChk = checks.find((c) => c.route && c.outcome === 'review');
    const to = routeChk && routeChk.route.email ? routeChk.route.email : getp(sub, 'vendor.contact.email') || null;
    const to_note = routeChk ? (routeChk.route.type === 'on_file' ? 'Sent to the contact on file, not to the address on the submission.' : 'Sent to the contact from the first submission.') : null;
    const name = v.legal_name || 'your company';
    const base = { to, to_note, status: res.status, items: [], notices: [] };

    // Bank-detail change: the message goes to the contact ON FILE and says nothing about our checks.
    if (res.status === 'pending' && routeChk && routeChk.route.type === 'on_file') {
      const on = ((ctx.context && ctx.context.vendors) || []).find((x) => x.id === sub.existing_vendor_id) || {};
      const onName = (on.contact && on.contact.name) || 'there';
      return Object.assign(base, { notices: [routeChk.notice], subject: `Please confirm: change of payment details for ${on.legal_name || name}${ref}`, body: `Hello ${onName},\n\n${routeChk.notice}\n${sign}` });
    }

    if (res.status === 'rejected') {
      const blocks = checks.filter((c) => c.outcome === 'block');
      if (blocks.some((c) => c.confidential || !c.vendor)) {
        return Object.assign(base, { subject: `Your vendor application${ref}`, body: `Hello ${cname},\n\nThank you for applying to become a supplier. After review we are unable to proceed with onboarding ${name} at this time.\n${sign}` });
      }
      return Object.assign(base, { subject: `Vendor application not approved${ref}`, body: `Hello ${cname},\n\nThank you for applying to become a supplier. We are unable to approve ${name} at this time:\n\n${blocks.map((c) => '• ' + c.vendor).join('\n')}\n${sign}` });
    }
    if (res.status === 'approved') {
      const vt = res.conditions.filter((c) => c.vendor_text).map((c) => '• ' + c.vendor_text);
      return Object.assign(base, { subject: `You're approved: ${name}${ref}`, body: `Hello ${cname},\n\nGood news: ${name} has been approved as a supplier. You will receive your vendor ID separately.${vt.length ? '\n\nA few things to know:\n' + vt.join('\n') : ''}\n${sign}` });
    }
    // One item per distinct ask: several findings with the same rule and the same fix (e.g. the same name wrong on three documents) are merged.
    const grouped = [];
    checks.filter((c) => c.outcome === 'required' && c.vendor).sort(byRank).forEach((c) => {
      const g = grouped.find((x) => x.rule_id === c.rule_id && x.needed === c.fix && c.rule_id === 'DOC-03');
      if (g) { g.found += ' ' + c.vendor; g.fields = uniq(g.fields.concat(c.fields)); g.label = 'Name on documents differs'; }
      else grouped.push({ rule_id: c.rule_id, label: c.label || c.title, found: c.vendor, needed: c.fix, fields: c.fields.slice() });
    });
    const items = grouped.map((g, i) => Object.assign({ n: i + 1 }, g));
    const notices = uniq(checks.filter((c) => c.outcome === 'review' && c.notice).map((c) => c.notice));
    base.items = items; base.notices = notices;
    if (!items.length && routeChk && routeChk.route.type === 'original') {
      return Object.assign(base, { subject: `Please confirm: changes to your submission for ${name}${ref}`, body: `Hello ${cname},\n\n${notices.join('\n\n')}\n${sign}` });
    }
    if (!items.length) {
      return Object.assign(base, { subject: `We've received your application${ref}`, body: `Hello ${cname},\n\n${notices.length ? notices.join('\n\n') : 'Thank you for your submission. It is with our review team and nothing more is needed from you right now.'}\n\nWe'll be in touch if we need anything else.\n${sign}` });
    }
    const list = items.map((i) => `${i.n}. ${i.label}\n   What we found: ${i.found}\n   What we need: ${i.needed}`).join('\n\n');
    return Object.assign(base, {
      subject: `Action needed to finish onboarding ${name}: ${items.length} item${items.length > 1 ? 's' : ''}${ref}`,
      body: `Hello ${cname},\n\nThanks for submitting ${name}. We checked it and need ${items.length === 1 ? 'one thing' : 'the following'} before we can approve it:\n\n${list}\n\n${notices.length ? notices.join('\n\n') + '\n\n' : ''}Please reply by ${respondBy}. We'll send a reminder if we haven't heard from you. Only change what's listed above; if anything else on your form has changed, tell us, because changes to company, tax or bank details are verified separately.\n${sign}`,
    });
  }

  /* =====================================================================
   * 8. CASE STORE  (lifecycle, change control, SLA)
   * ===================================================================== */
  function flatten(obj, prefix, out) {
    out = out || {}; prefix = prefix || '';
    if (Array.isArray(obj)) {
      if (prefix === 'documents') { obj.forEach((x) => { out['documents.' + (x.declared_type || 'unknown')] = JSON.stringify(x); }); return out; }
      out[prefix] = JSON.stringify(obj); return out;
    }
    if (obj && typeof obj === 'object') { Object.keys(obj).forEach((k) => flatten(obj[k], prefix ? prefix + '.' + k : k, out)); return out; }
    out[prefix] = obj === undefined ? '' : String(obj);
    return out;
  }
  const VOLATILE = ['submission_id', 'submitted_at', 'case_id', 'channel'];
  const flaggedMatch = (flagged, p) => flagged.some((f) => p === f || p.startsWith(f + '.') || f.startsWith(p + '.'));

  class CaseStore {
    constructor(o) { o = o || {}; this.context = o.context || {}; this.config = o.config || {}; this.cases = new Map(); this.seq = 0; }
    _cfg() { return Object.assign({}, CONFIG, this.config); }
    get(id) { return this.cases.get(id); }
    list() {
      return Array.from(this.cases.values()).map((c) => ({ id: c.id, vendor: (c.latest.submission_vendor) || '', status: c.status, waiting_on: c.waiting_on, round: c.rounds.length, opened_at: c.opened_at, closed_reason: c.closed_reason || null, last_request_sent_at: c.last_request_sent_at }));
    }
    _log(c, now, actor, event, detail) { c.audit.push({ ts: new Date(now).toISOString(), actor, event, detail, round: c.rounds.length }); }

    submit(sub, now) {
      now = new Date(now || Date.now());
      const cfg = this._cfg();
      let c = sub.case_id && this.cases.get(sub.case_id);
      let reopened = false;
      if (c && c.status === 'rejected') {
        if (c.closed_reason === 'expired' && ddiff(new Date(c.closed_at), now) <= cfg.sla.reopen_window_days) { reopened = true; c.status = 'open'; c.closed_reason = null; c.reminders = []; }
        else { this._log(c, now, 'vendor', 'submission_refused', c.closed_reason === 'expired' ? 'reopen window passed' : 'case is closed'); return { case: this._summary(c), result: Object.assign({}, c.latest, { note: 'This case is closed; the resubmission was not evaluated.' }), refused: true }; }
      }
      if (!c) {
        c = { id: `VO-${now.getUTCFullYear()}-${String(++this.seq).padStart(4, '0')}`, status: 'open', waiting_on: null, rounds: [], overrides: [], audit: [], reminders: [], opened_at: now.toISOString(), latest: null, last_request_sent_at: null };
        this.cases.set(c.id, c);
        this._log(c, now, 'vendor', 'case_opened', `New onboarding case for ${(sub.vendor || {}).legal_name || 'unnamed vendor'}`);
      }
      const round = c.rounds.length + 1;
      let caseInfo = { round, changed: [], silent: [], silent_values: {}, previous_values: {}, original_email: getp((c.rounds[0] || { submission: sub }).submission, 'vendor.contact.email') };
      if (round > 1) {
        const prev = c.rounds[c.rounds.length - 1];
        const a = flatten(prev.submission), b = flatten(sub);
        VOLATILE.forEach((k) => { delete a[k]; delete b[k]; });
        const keys = uniq(Object.keys(a).concat(Object.keys(b)));
        const changed = keys.filter((k) => (a[k] || '') !== (b[k] || ''));
        const flagged = uniq([].concat(...prev.result.checks.filter((x) => SEV[x.outcome] >= 2).map((x) => x.fields.concat(x.allow || []))));
        const silent = changed.filter((p) => !flaggedMatch(flagged, p));
        caseInfo = Object.assign(caseInfo, { changed, silent, silent_values: Object.fromEntries(silent.map((p) => [p, b[p]])), previous_values: Object.fromEntries(silent.map((p) => [p, a[p]])), flagged_previous: flagged });
        this._log(c, now, 'vendor', 'resubmitted', `Round ${round}: ${changed.length} field(s) changed; ${silent.length} not requested${silent.length ? ' (' + silent.join(', ') + ')' : ''}`);
      } else this._log(c, now, 'vendor', 'submitted', 'Round 1 received');
      if (reopened) this._log(c, now, 'system', 'reopened', 'Resubmission within the reopen window; case reopened');
      const result = evaluate(sub, { now, context: this.context, config: this.config, overrides: c.overrides, caseInfo, caseRef: c.id });
      result.submission_vendor = (sub.vendor || {}).legal_name || '';
      c.rounds.push({ n: round, at: now.toISOString(), submission: JSON.parse(JSON.stringify(sub)), result, caseInfo });
      this._apply(c, result, now);
      result.audit.forEach((e) => c.audit.push(Object.assign({ round }, e)));
      return { case: this._summary(c), result };
    }

    _apply(c, result, now) {
      c.latest = result; c.status = result.status; c.waiting_on = result.waiting_on;
      if (result.status === 'pending') {
        const vm = result.vendor_message;
        if (vm && (vm.items.length || vm.notices.length)) { c.last_request_sent_at = new Date(now).toISOString(); c.reminders = []; this._log(c, now, 'system', 'vendor_message_queued', `"${vm.subject}" → ${vm.to}`); }
        if (!c.pending_since || c.pending_internal_since === undefined) c.pending_internal_since = new Date(now).toISOString();
      }
      if (result.status === 'rejected') { c.closed_at = new Date(now).toISOString(); c.closed_reason = 'declined'; this._log(c, now, 'system', 'case_closed', 'Rejected: ' + result.summary); }
      if (result.status === 'approved') { c.closed_at = new Date(now).toISOString(); c.closed_reason = 'approved'; this._log(c, now, 'system', 'case_approved', result.conditions.length ? result.conditions.length + ' condition(s) attached' : 'No conditions'); }
      c.pending_since = result.status === 'pending' ? (c.pending_since || new Date(now).toISOString()) : null;
    }

    /** A person decides a 'review' finding. decision: 'clear' | 'reject'. */
    resolve(caseId, o, now) {
      now = new Date(now || Date.now());
      const c = this.cases.get(caseId);
      if (!c) throw new Error('No such case ' + caseId);
      if (!o.note || !String(o.note).trim()) throw new Error('A note is required: the reason becomes part of the audit trail.');
      let chk = o.key ? c.latest.checks.find((x) => x.key === o.key) : c.latest.checks.find((x) => x.rule_id === o.rule && x.outcome === 'review');
      if (!chk || chk.outcome !== 'review') throw new Error('No open review finding matches.');
      c.overrides.push({ key: chk.key, decision: o.decision, by: o.by || 'reviewer', note: o.note, at: now.toISOString() });
      this._log(c, now, o.by || 'reviewer', o.decision === 'clear' ? 'review_cleared' : 'review_rejected', `${chk.rule_id} ${chk.label || chk.title}: ${o.note}`);
      const last = c.rounds[c.rounds.length - 1];
      const result = evaluate(last.submission, { now, context: this.context, config: this.config, overrides: c.overrides, caseInfo: last.caseInfo, caseRef: c.id });
      result.submission_vendor = last.result.submission_vendor;
      last.result = result;
      this._apply(c, result, now);
      return { case: this._summary(c), result };
    }

    /** Advance the clock: reminders, expiry, internal SLA. Safe to call repeatedly. */
    tick(now) {
      now = new Date(now || Date.now());
      const cfg = this._cfg(), events = [];
      this.cases.forEach((c) => {
        if (c.status !== 'pending') return;
        if ((c.waiting_on === 'vendor' || c.waiting_on === 'both') && c.last_request_sent_at) {
          const days = ddiff(new Date(c.last_request_sent_at), now);
          const name = (c.latest.submission_vendor) || 'your company';
          const to = c.latest.vendor_message ? c.latest.vendor_message.to : null;
          if (days >= cfg.sla.expire_days) {
            c.status = 'rejected'; c.closed_reason = 'expired'; c.closed_at = now.toISOString(); c.waiting_on = null;
            const msg = { to, subject: `We've closed your onboarding request (${c.id})`, body: `Hello,\n\nWe haven't received the information we asked for in ${days} days, so we have closed the onboarding request for ${name}. Nothing is lost: if you send the items within ${cfg.sla.reopen_window_days} days, we'll reopen it and pick up where we left off. After that you'd need to start a new application.\n\nRegards,\nVendor Onboarding, ${cfg.buyer}` };
            this._log(c, now, 'system', 'case_expired', `No vendor response for ${days} days (rule CASE-03)`);
            events.push({ case_id: c.id, type: 'expired', rule_id: 'CASE-03', message: msg });
          } else if (days >= cfg.sla.reminder2_days && !c.reminders.includes(2)) {
            c.reminders.push(2); c.reminders.push(1);
            const left = cfg.sla.expire_days - days;
            const msg = { to, subject: `Final reminder: onboarding for ${name} (${c.id})`, body: `Hello,\n\nWe're still waiting on the items listed in our earlier message for ${name}. If we don't hear back within ${left} days we'll close the request (it can be reopened for ${cfg.sla.reopen_window_days} days after that).\n\nRegards,\nVendor Onboarding, ${cfg.buyer}` };
            this._log(c, now, 'system', 'reminder_2_sent', `Day ${days} of ${cfg.sla.expire_days}`);
            events.push({ case_id: c.id, type: 'reminder_2', rule_id: 'CASE-03', message: msg });
          } else if (days >= cfg.sla.reminder1_days && !c.reminders.includes(1)) {
            c.reminders.push(1);
            const msg = { to, subject: `Reminder: onboarding for ${name} (${c.id})`, body: `Hello,\n\nA quick reminder that we're waiting on the items in our earlier message before we can approve ${name}. Just reply to that email with the corrections.\n\nRegards,\nVendor Onboarding, ${cfg.buyer}` };
            this._log(c, now, 'system', 'reminder_1_sent', `Day ${days} of ${cfg.sla.expire_days}`);
            events.push({ case_id: c.id, type: 'reminder_1', rule_id: 'CASE-03', message: msg });
          }
        }
        if ((c.waiting_on === 'internal' || c.waiting_on === 'both') && c.pending_since) {
          const days = ddiff(new Date(c.pending_since), now);
          if (days >= cfg.sla.internal_days && !c.internal_escalated) {
            c.internal_escalated = true;
            this._log(c, now, 'system', 'internal_sla_breached', `Waiting on internal review for ${days} days`);
            events.push({ case_id: c.id, type: 'internal_overdue', rule_id: 'CASE-03', note: `Review for ${c.id} has been open ${days} days (limit ${cfg.sla.internal_days}). Escalate to the procurement lead.` });
          }
        }
      });
      return events;
    }

    _summary(c) { return { id: c.id, status: c.status, waiting_on: c.waiting_on, rounds: c.rounds.length, closed_reason: c.closed_reason || null, audit: c.audit.slice() }; }
  }

  return { evaluate, CaseStore, RULES, CATEGORIES, CONFIG, V, gen, nameMatch, classifyTaxId, prepName, DOC_LABEL, flatten, money, SEV };
});

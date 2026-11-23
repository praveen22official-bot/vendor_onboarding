/**
 * Vendor Compliance & Onboarding Desk
 * Minimalist Enterprise Office UI for Risk Analysts & Vendor Management
 */
(function () {
  'use strict';
  const E = window.VendorEngine;
  const SC = window.VendorScenarios;
  const DAY = 864e5;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDay = (d) => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const fmtShort = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtTime = (d) => new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const SEV = { block: 4, review: 3, required: 2, warn: 1, pass: 0, skipped: 0 };
  const GLYPH = { pass: '✓', warn: '!', required: '↩', review: '?', block: '✕', skipped: '–' };
  const OWORD = { pass: 'Passed', warn: 'Noted', required: 'Action Required', review: 'Analyst Review', block: 'Blocked', skipped: 'Skipped' };
  const WAIT = { vendor: 'Waiting on Vendor', internal: 'In Internal Review', both: 'Vendor & Internal Review' };

  /* -------------------------------------------------------------------------
   * Toast System
   * ------------------------------------------------------------------------- */
  function showToast(msg) {
    const hub = document.getElementById('toast-hub');
    if (!hub) return;
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.innerHTML = `<span>${esc(msg)}</span>`;
    hub.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.2s';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
    }, 2600);
  }

  /* -------------------------------------------------------------------------
   * State Management
   * ------------------------------------------------------------------------- */
  const state = {
    now: new Date(),
    world: null,
    store: null,
    view: 'workbench', // workbench | intake | policy | analytics
    sel: 'S0',
    tab: 'overview', // overview | documents | fraud | trace | audit | editor
    filter: 'issues', // issues | all
    queueFilter: 'all', // all | urgent | pending | approved | rejected
    industryFilter: 'all',
    search: '',
    cases: {},
    next: {},
    outbox: {},
    notes: {},
    errs: {},
    drafts: {},
    jsonErr: '',
    modal: null, // null | 'spotlight' | 'cert' | 'callback'
    spotlightQuery: '',
    verifiedCallbacks: {},
    intakeTemplate: 'biogenix',
  };

  const scen = (id) => state.world.scenarios.find((s) => s.id === id);
  const caseOf = (id) => (state.cases[id] ? state.store.get(state.cases[id]) : null);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function submit(sc, sub) {
    const s = clone(sub);
    if (state.cases[sc.id]) s.case_id = state.cases[sc.id]; else delete s.case_id;
    const out = state.store.submit(s, state.now);
    state.cases[sc.id] = out.case.id;
    delete state.drafts[sc.id];
    return out;
  }

  function init() {
    state.now = new Date();
    state.world = SC.build(state.now);
    state.store = new E.CaseStore({ context: state.world.context });
    state.cases = {}; state.next = {}; state.outbox = {}; state.notes = {}; state.errs = {}; state.drafts = {}; state.jsonErr = '';
    state.verifiedCallbacks = {};
    state.world.scenarios.forEach((sc) => {
      submit(sc, sc.steps[0]);
      state.next[sc.id] = 1;
    });
  }

  function latestSubmission(sc) {
    const c = caseOf(sc.id);
    const s = clone(c.rounds[c.rounds.length - 1].submission);
    delete s.case_id;
    return s;
  }

  function advance(days) {
    state.now = new Date(state.now.getTime() + days * DAY);
    const events = state.store.tick(state.now);
    events.forEach((ev) => {
      const list = (state.outbox[ev.case_id] = state.outbox[ev.case_id] || []);
      if (ev.message) {
        list.push({ at: state.now.toISOString(), type: ev.type, to: ev.message.to, subject: ev.message.subject, body: ev.message.body });
        showToast(`SLA Notification sent for ${ev.case_id}`);
      } else {
        list.push({ at: state.now.toISOString(), type: ev.type, internal: true, subject: 'Escalation to procurement lead', body: ev.note });
        showToast(`Internal escalation on ${ev.case_id}`);
      }
    });
    return events;
  }

  /* -------------------------------------------------------------------------
   * Top Bar
   * ------------------------------------------------------------------------- */
  function renderHeader() {
    return `
    <header class="top-nav">
      <div class="nav-left">
        <div class="nav-brand">
          <span class="nav-brand-title">Vendor Compliance Desk</span>
          <span class="nav-brand-sub">Enterprise Onboarding OS</span>
        </div>

        <nav class="view-tabs" role="tablist" aria-label="Workspaces">
          <button class="view-tab-btn" data-act="view" data-v="workbench" aria-pressed="${state.view === 'workbench'}">Review Queue</button>
          <button class="view-tab-btn" data-act="view" data-v="intake" aria-pressed="${state.view === 'intake'}">Intake Simulator</button>
          <button class="view-tab-btn" data-act="view" data-v="policy" aria-pressed="${state.view === 'policy'}">Rule Catalog (33)</button>
          <button class="view-tab-btn" data-act="view" data-v="analytics" aria-pressed="${state.view === 'analytics'}">Analytics</button>
        </nav>
      </div>

      <div class="nav-right">
        <!-- Quick Find -->
        <button class="btn small" data-act="open-spotlight">
          <span>Find (Ctrl+K)</span>
        </button>

        <!-- Simulated Clock Stepper -->
        <div class="sim-clock-bar">
          <span class="sim-clock-date">${esc(fmtDay(state.now))}</span>
          <button class="sim-btn" data-act="tick" data-d="1">+1d</button>
          <button class="sim-btn" data-act="tick" data-d="7">+7d</button>
          <button class="sim-btn" data-act="tick" data-d="30">+30d</button>
          <button class="sim-btn" data-act="reset">Reset</button>
        </div>

        <!-- Theme Toggle -->
        <button class="btn small" data-act="toggle-theme" title="Toggle Light/Dark Theme">
          <span>Theme</span>
        </button>

        <!-- Analyst Profile -->
        <div class="user-badge">
          <div class="user-avatar">JD</div>
          <span>J. Drake (Analyst)</span>
        </div>
      </div>
    </header>`;
  }

  /* -------------------------------------------------------------------------
   * KPI Metrics Strip
   * ------------------------------------------------------------------------- */
  function renderPulseBar() {
    const list = state.world.scenarios.map((s) => caseOf(s.id)).filter(Boolean);
    const total = list.length;
    const approved = list.filter((c) => c.status === 'approved').length;
    const pending = list.filter((c) => c.status === 'pending').length;
    const rejected = list.filter((c) => c.status === 'rejected').length;
    const holds = list.filter((c) => c.latest && c.latest.internal && c.latest.internal.hold_payments).length;
    const reviews = list.reduce((acc, c) => acc + (c.latest ? c.latest.checks.filter((x) => x.outcome === 'review').length : 0), 0);

    return `
    <div class="kpi-strip" role="region" aria-label="Portfolio Metrics">
      <div class="kpi-tile">
        <span class="kpi-tile-header">In-Flight Queue</span>
        <span class="kpi-tile-val">${total}</span>
        <span class="kpi-tile-meta">Active Cases</span>
      </div>
      <div class="kpi-tile">
        <span class="kpi-tile-header">Pending Reviews</span>
        <span class="kpi-tile-val" style="color:#4F46E5">${reviews}</span>
        <span class="kpi-tile-meta">Analyst Sign-Offs</span>
      </div>
      <div class="kpi-tile">
        <span class="kpi-tile-header">Payment Holds</span>
        <span class="kpi-tile-val" style="color:#B91C1C">${holds}</span>
        <span class="kpi-tile-meta">Anti-BEC Interceptions</span>
      </div>
      <div class="kpi-tile">
        <span class="kpi-tile-header">Approved Rate</span>
        <span class="kpi-tile-val" style="color:#15803D">${approved}</span>
        <span class="kpi-tile-meta">Clean Auto-Pass</span>
      </div>
      <div class="kpi-tile">
        <span class="kpi-tile-header">Hold Volume</span>
        <span class="kpi-tile-val mono" style="font-size:16px">₹60.2M</span>
        <span class="kpi-tile-meta">Treasury Protected</span>
      </div>
      <div class="kpi-tile">
        <span class="kpi-tile-header">Mean Cycle Time</span>
        <span class="kpi-tile-val mono" style="font-size:16px">1.4 <span style="font-size:12px;font-weight:500">days</span></span>
        <span class="kpi-tile-meta">Statutory SLA</span>
      </div>
    </div>`;
  }

  /* -------------------------------------------------------------------------
   * Queue Rail (Left)
   * ------------------------------------------------------------------------- */
  function renderQueue() {
    let scenarios = state.world.scenarios;

    if (state.industryFilter !== 'all') {
      scenarios = scenarios.filter((s) => s.industry === state.industryFilter);
    }

    if (state.queueFilter !== 'all') {
      scenarios = scenarios.filter((s) => {
        const c = caseOf(s.id);
        if (state.queueFilter === 'urgent') return c.latest && (c.latest.priority === 'high' || c.latest.internal.hold_payments);
        return c.status === state.queueFilter;
      });
    }

    if (state.search.trim()) {
      const q = state.search.toLowerCase();
      scenarios = scenarios.filter((s) => s.title.toLowerCase().includes(q) || s.tag.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || (s.industry_name && s.industry_name.toLowerCase().includes(q)));
    }

    const industries = [
      ['all', 'All Verticals'],
      ['tech', 'Technology & Cloud'],
      ['manufacturing', 'Manufacturing & Print'],
      ['trade', 'Global Trade & Commodities'],
      ['retail', 'Retail & Consumer Goods'],
      ['services', 'Agency & Design Services'],
      ['infrastructure', 'Maritime & Infrastructure'],
      ['logistics', 'Freight & Supply Chain'],
    ];

    return `
    <aside class="queue-panel">
      <div class="queue-top">
        <input type="text" class="queue-search-input" placeholder="Search vendor name, tax ID..." value="${esc(state.search)}" data-act="search-queue">

        <div class="queue-filter-row">
          <select class="queue-select" data-act="change-industry">
            ${industries.map(([id, label]) => `<option value="${id}" ${state.industryFilter === id ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>

        <div class="queue-pills" role="tablist">
          <button class="queue-pill" data-act="queue-tab" data-q="all" aria-pressed="${state.queueFilter === 'all'}">All</button>
          <button class="queue-pill" data-act="queue-tab" data-q="urgent" aria-pressed="${state.queueFilter === 'urgent'}">Urgent</button>
          <button class="queue-pill" data-act="queue-tab" data-q="pending" aria-pressed="${state.queueFilter === 'pending'}">Pending</button>
          <button class="queue-pill" data-act="queue-tab" data-q="approved" aria-pressed="${state.queueFilter === 'approved'}">Approved</button>
          <button class="queue-pill" data-act="queue-tab" data-q="rejected" aria-pressed="${state.queueFilter === 'rejected'}">Declined</button>
        </div>
      </div>

      <div class="queue-items">
        ${scenarios.map((s) => {
          const c = caseOf(s.id);
          const isSelected = state.sel === s.id;
          const statusBadge = c.status === 'approved' ? '<span class="badge ok">Approved</span>' : c.status === 'pending' ? '<span class="badge warn">Pending</span>' : '<span class="badge bad">Declined</span>';
          const indTag = (s.industry || 'GEN').toUpperCase().slice(0, 5);

          return `
          <button class="queue-item" data-act="select-case" data-id="${s.id}" aria-current="${isSelected}">
            <div class="queue-item-r1">
              <span class="queue-item-title">${esc(s.title)}</span>
              ${statusBadge}
            </div>
            <div class="queue-item-r2">
              <span class="mono">${esc(s.id)} · ${s.flag || ''} ${indTag}</span>
              <span>Score: <b>${s.risk_score || 50}/100</b></span>
            </div>
          </button>`;
        }).join('')}
      </div>
    </aside>`;
  }

  /* -------------------------------------------------------------------------
   * Right Dossier (Case 360 Workspace)
   * ------------------------------------------------------------------------- */
  function renderDossier() {
    const sc = scen(state.sel);
    const c = caseOf(sc.id);
    const r = c.latest;
    const moreSteps = state.next[sc.id] < sc.steps.length;

    const STEP_LABELS = {
      E2: 'Simulate Round 2 (Fix name + Bank Swap)',
      S3: 'Simulate Vendor Late Reply (Missing Cert)',
    };

    return `
    <main class="dossier-panel">
      <!-- Header Area -->
      <section class="dossier-header">
        <div class="dossier-header-top">
          <div class="dossier-meta-chips">
            <span class="badge neutral mono">${esc(c.id)}</span>
            <span class="badge neutral">${(sc.industry || 'General').toUpperCase()}</span>
            <span class="badge neutral">${esc(sc.tier || 'Tier 2')}</span>
            <span class="badge neutral">Round ${c.rounds.length}</span>
            ${r.priority === 'high' ? '<span class="badge bad">High Priority</span>' : ''}
            ${r.internal.hold_payments ? '<span class="badge bad">Payments on Hold</span>' : ''}
          </div>

          <!-- Action buttons -->
          <div class="action-cluster">
            <button class="btn small" data-act="open-cert">Certificate</button>
            <button class="btn small" data-act="restart-case">Restart</button>
            ${moreSteps ? `<button class="btn primary small" data-act="advance-step">${esc(STEP_LABELS[sc.id] || 'Advance Step')}</button>` : ''}
          </div>
        </div>

        <div class="dossier-title-area">
          <h2>${esc(sc.title)} <span style="font-size:14px;color:var(--text-subtle);font-weight:400">(${sc.flag || 'Global'})</span></h2>
          <p>${esc(sc.blurb)}</p>
        </div>

        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${(sc.standards || []).map((std) => `<span class="badge ok" style="font-size:10.5px">${esc(std)}</span>`).join('')}
        </div>
      </section>

      <!-- High-Clarity Verdict Summary -->
      ${renderVerdict(c)}

      <!-- Internal Navigation Tabs -->
      <nav class="dossier-nav-tabs" role="tablist">
        <button class="dossier-tab-btn" data-act="dossier-tab" data-t="overview" aria-pressed="${state.tab === 'overview'}">Overview & Tasks</button>
        <button class="dossier-tab-btn" data-act="dossier-tab" data-t="documents" aria-pressed="${state.tab === 'documents'}">Documents & OCR (${(c.rounds[c.rounds.length - 1].submission.documents || []).length})</button>
        <button class="dossier-tab-btn" data-act="dossier-tab" data-t="fraud" aria-pressed="${state.tab === 'fraud'}">Payment & Bank Security</button>
        <button class="dossier-tab-btn" data-act="dossier-tab" data-t="trace" aria-pressed="${state.tab === 'trace'}">33 Controls Trace (${r.checks.length})</button>
        <button class="dossier-tab-btn" data-act="dossier-tab" data-t="audit" aria-pressed="${state.tab === 'audit'}">Audit Log (${c.audit.length})</button>
        <button class="dossier-tab-btn" data-act="dossier-tab" data-t="editor" aria-pressed="${state.tab === 'editor'}">Submission JSON</button>
      </nav>

      <!-- Active Content View -->
      <section>
        ${renderActiveTab(sc, c)}
      </section>
    </main>`;
  }

  /* -------------------------------------------------------------------------
   * Verdict Summary Card
   * ------------------------------------------------------------------------- */
  function renderVerdict(c) {
    const r = c.latest;
    const k = r.counts;
    const summary = c.status === 'rejected' && c.closed_reason === 'expired'
      ? 'The vendor did not reply within 30 days. Case closed; eligible for reopening within 60 days.'
      : r.summary;

    const statusBadge = c.status === 'approved' ? '<span class="badge ok">APPROVED</span>' : c.status === 'pending' ? '<span class="badge warn">PENDING ACTION</span>' : '<span class="badge bad">REJECTED / BLOCKED</span>';

    return `
    <section class="verdict-banner" data-status="${c.status}" aria-label="Decision Verdict">
      <div class="verdict-left">
        <div class="verdict-title-row">
          ${statusBadge}
          <span style="font-size:12px;color:var(--text-subtle)">${c.waiting_on ? WAIT[c.waiting_on] : 'Evaluation Complete'}</span>
        </div>
        <div class="verdict-desc">${esc(summary)}</div>
      </div>

      <div class="verdict-stats">
        <span class="verdict-stat"><b style="color:#166534">${k.pass}</b> Pass</span>
        <span class="verdict-stat"><b style="color:#92400E">${k.warn}</b> Note</span>
        <span class="verdict-stat"><b style="color:#92400E">${k.required}</b> Fix</span>
        <span class="verdict-stat"><b style="color:#3730A3">${k.review}</b> Review</span>
        <span class="verdict-stat"><b style="color:#991B1B">${k.block}</b> Block</span>
      </div>
    </section>`;
  }

  /* -------------------------------------------------------------------------
   * Dossier Sub-Tabs
   * ------------------------------------------------------------------------- */
  function renderActiveTab(sc, c) {
    switch (state.tab) {
      case 'overview': return renderTabOverview(sc, c);
      case 'documents': return renderTabDocuments(sc, c);
      case 'fraud': return renderTabFraud(sc, c);
      case 'trace': return renderTabTrace(sc, c);
      case 'audit': return renderTabAudit(sc, c);
      case 'editor': return renderTabEditor(sc, c);
      default: return renderTabOverview(sc, c);
    }
  }

  /* 1. Overview & Action Plan */
  function renderTabOverview(sc, c) {
    const r = c.latest;
    const m = r.vendor_message;
    const reviews = r.checks.filter((x) => x.outcome === 'review');

    return `
    <div class="split-two">
      <!-- Left: Vendor Notification Message -->
      <div class="office-card">
        <h3>
          <span>Vendor Notification Notice</span>
          <button class="btn small" data-act="copy-mail">Copy Message</button>
        </h3>
        <p class="card-subtext">Direct notice generated for delivery to the vendor's primary contact.</p>

        <div class="email-container">
          <div class="email-meta">
            <span style="color:var(--text-subtle)">To:</span>
            <span class="mono">${esc(m.to || 'No address on file')}</span>
            <span style="color:var(--text-subtle)">Subject:</span>
            <span><b>${esc(m.subject)}</b></span>
          </div>
          ${m.to_note ? `<div style="font-size:11.5px;color:#92400E;background:#FFFBEB;padding:4px 8px;border:1px solid #FDE68A;border-radius:3px">${esc(m.to_note)}</div>` : ''}
          <div class="email-body" id="mail-text">${esc(m.body)}</div>
        </div>
      </div>

      <!-- Right: Team Tasks & Clearances -->
      <div class="office-card">
        <h3>Internal Actions & Governance</h3>
        <p class="card-subtext">Compliance review findings, payment hold directives, and approval covenants.</p>

        ${r.internal.hold_payments ? `
        <div style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:10px 12px;border-radius:4px;font-size:12.5px">
          <b>Payment Hold Directive:</b> Payments suspended to new details. Conduct voice verification before release.
        </div>` : ''}

        ${reviews.length ? `
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="font-size:12px;font-weight:600;color:#3730A3">Open Review Decisions (${reviews.length})</div>
          ${reviews.map((x) => `
            <div style="background:var(--bg-subtle);border:1px solid var(--border-subtle);border-radius:4px;padding:10px;display:flex;flex-direction:column;gap:6px">
              <div style="display:flex;justify-content:space-between;font-weight:600">
                <span>${esc(x.label || x.title)}</span>
                <span class="mono" style="font-size:11px;color:var(--text-subtle)">${esc(x.rule_id)}</span>
              </div>
              <div style="font-size:12px;color:var(--text-muted)">${esc(x.detail)}</div>
              <textarea style="width:100%;min-height:48px;padding:6px;border:1px solid var(--border-strong);border-radius:3px;background:var(--bg-surface);font-size:12px" placeholder="Write justification reason..." data-note-key="${esc(x.key)}">${esc(state.notes[x.key] || '')}</textarea>
              <div style="display:flex;gap:6px">
                <button class="btn success small" data-act="resolve-finding" data-key="${esc(x.key)}" data-dec="clear">Clear Finding</button>
                <button class="btn danger small" data-act="resolve-finding" data-key="${esc(x.key)}" data-dec="reject">Reject</button>
              </div>
              ${state.errs[x.key] ? `<div style="font-size:11px;color:#B91C1C">${esc(state.errs[x.key])}</div>` : ''}
            </div>
          `).join('')}
        </div>` : ''}

        ${r.conditions.length ? `
        <div>
          <div style="font-size:12px;font-weight:600;margin-bottom:6px">Approval Conditions & Spend Caps</div>
          <ul style="margin:0;padding-left:16px;display:flex;flex-direction:column;gap:4px;font-size:12.5px">
            ${r.conditions.map((c) => `<li>${esc(c.text)}</li>`).join('')}
          </ul>
        </div>` : ''}

        ${r.internal.actions && r.internal.actions.length ? `
        <div>
          <div style="font-size:12px;font-weight:600;margin-bottom:6px">Required Internal Steps</div>
          <ul style="margin:0;padding-left:16px;display:flex;flex-direction:column;gap:4px;font-size:12.5px">
            ${r.internal.actions.map((a) => `<li>${esc(a)}</li>`).join('')}
          </ul>
        </div>` : ''}

        ${!reviews.length && !r.conditions.length && (!r.internal.actions || !r.internal.actions.length) ? `
          <div style="text-align:center;padding:24px;color:var(--text-subtle)">No internal action required for this case.</div>
        ` : ''}
      </div>
    </div>`;
  }

  /* 2. Documents & OCR Verification */
  function renderTabDocuments(sc, c) {
    const sub = c.rounds[c.rounds.length - 1].submission;
    const docs = sub.documents || [];

    return `
    <div class="office-card">
      <h3>Documents & Optical Extraction Inspection</h3>
      <p class="card-subtext">Verification of uploaded certificates, tax forms, and cancelled checks against form inputs.</p>

      <table class="data-table">
        <thead>
          <tr>
            <th>Declared Type</th>
            <th>File Name</th>
            <th>OCR Extracted Name</th>
            <th>Extracted ID / Account</th>
            <th>Issued / Expiry</th>
            <th>Integrity / Legibility</th>
          </tr>
        </thead>
        <tbody>
          ${docs.map((d) => {
            const ex = d.extracted || {};
            const isLegible = ex.legible !== false;
            const matchName = ex.name || ex.holder_name || 'N/A';
            const docId = ex.id_number || ex.account_last4 ? (ex.id_number || '•••• ' + ex.account_last4) : 'Verified';

            return `
            <tr>
              <td style="font-weight:600">${esc(d.declared_type.toUpperCase().replace(/_/g, ' '))}</td>
              <td class="mono" style="color:var(--text-subtle)">${esc(d.filename)}</td>
              <td>${esc(matchName)}</td>
              <td class="mono">${esc(docId)}</td>
              <td class="mono" style="color:var(--text-subtle)">${esc(ex.issued_on || 'N/A')} / ${esc(ex.expires_on || 'Indefinite')}</td>
              <td>
                <span class="badge ${isLegible ? 'ok' : 'bad'}">${isLegible ? 'Legible / Clean' : 'Illegible'}</span>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }

  /* 3. Anti-BEC Bank Security */
  function renderTabFraud(sc, c) {
    const sub = c.rounds[c.rounds.length - 1].submission;
    const bank = sub.bank || {};
    const isRedirection = sc.id.startsWith('E4') || sc.id === 'E2';
    const isVerified = !!state.verifiedCallbacks[c.id];

    return `
    <div class="office-card">
      <h3>
        <span>Treasury Verification & Anti-BEC Shield</span>
        ${isRedirection ? '<span class="badge bad">High Risk: Account Swap</span>' : '<span class="badge ok">Clean Profile</span>'}
      </h3>
      <p class="card-subtext">Detection of unrequested banking changes, payment redirection, and domain spoofing.</p>

      ${isRedirection ? `
      <div class="split-two">
        <div style="background:var(--bg-subtle);border:1px solid var(--border-subtle);padding:12px;border-radius:4px">
          <div style="font-size:11px;font-weight:600;color:var(--text-subtle);text-transform:uppercase">Account on File (Verified)</div>
          <div style="font-weight:600;margin-top:4px">Brightline Logistics Private Limited</div>
          <div class="mono" style="font-size:11.5px;color:var(--text-muted)">Acct: 50100234567890 (HDFC Bank)</div>
          <div style="font-size:11.5px;margin-top:6px;color:var(--text-subtle)">Registered Contact on File: <b>Meera Rao</b> (+91 98450 11223)</div>
        </div>

        <div style="background:#FFFBEB;border:1px solid #FDE68A;padding:12px;border-radius:4px">
          <div style="font-size:11px;font-weight:600;color:#92400E;text-transform:uppercase">Incoming Request Coordinates</div>
          <div style="font-weight:600;margin-top:4px">${esc(bank.account_holder_name || 'New Holder')}</div>
          <div class="mono" style="font-size:11.5px;color:#92400E">Acct: ${esc(bank.account_number)} (${esc(bank.bank_name || 'ICICI')})</div>
          <div style="font-size:11.5px;margin-top:6px;color:#92400E">Sender Channel: ${esc(sub.channel || 'Email')}</div>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:var(--bg-subtle);border:1px solid var(--border-subtle);border-radius:4px;margin-top:8px">
        <div>
          <div style="font-weight:600">Telephone Callback Verification (RISK-05):</div>
          <div style="font-size:11.5px;color:var(--text-subtle)">${isVerified ? 'Verified by J. Drake with registered phone (+91 98450 11223)' : 'Pending phone call to registered contact on file'}</div>
        </div>
        <button class="btn ${isVerified ? '' : 'primary'} small" data-act="open-callback">${isVerified ? 'Edit Log' : 'Log Voice Call'}</button>
      </div>
      ` : `
      <div style="text-align:center;padding:24px;color:var(--text-subtle)">No bank account swaps or redirection anomalies detected.</div>
      `}
    </div>`;
  }

  /* 4. Controls Trace */
  function renderTabTrace(sc, c) {
    const r = c.latest;
    const all = r.checks;
    const attention = all.filter((x) => SEV[x.outcome] >= 1);
    const list = state.filter === 'all' ? all : attention;
    const cats = E.CATEGORIES.map((cat) => [cat, list.filter((x) => x.category === cat).sort((a, b) => SEV[b.outcome] - SEV[a.outcome])]).filter(([, a]) => a.length);

    return `
    <div class="office-card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3>33 Compliance Controls Evaluation</h3>
        <div style="display:flex;gap:4px">
          <button class="btn small ${state.filter === 'issues' ? 'primary' : ''}" data-act="trace-filter" data-f="issues">Issues Only (${attention.length})</button>
          <button class="btn small ${state.filter === 'all' ? 'primary' : ''}" data-act="trace-filter" data-f="all">All 33 Controls (${all.length})</button>
        </div>
      </div>

      <div>
        ${cats.map(([cat, items]) => `
          <div style="margin-bottom:14px">
            <div style="font-size:11px;font-weight:700;color:var(--text-subtle);text-transform:uppercase;margin-bottom:6px">${esc(cat)}</div>
            ${items.map(renderControlRow).join('')}
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  function renderControlRow(x) {
    const fields = (x.fields || []).slice(0, 4).map((f) => `<span class="badge neutral mono" style="font-size:10px">${esc(f)}</span>`).join(' ');
    const ev = x.evidence ? `<details style="margin-top:4px"><summary style="cursor:pointer;font-size:11px;color:var(--brand-primary)">Inspect Evidence</summary><pre class="mono" style="margin:4px 0 0;padding:6px;background:var(--bg-subtle);border-radius:3px;font-size:11px">${esc(JSON.stringify(x.evidence, null, 2))}</pre></details>` : '';
    const cleared = x.cleared ? `<span class="badge ok">Cleared by ${esc(x.cleared.by)}</span>` : '';

    return `
    <div class="control-row">
      <div class="control-glyph" data-o="${x.outcome}">${GLYPH[x.outcome]}</div>
      <div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-weight:600">${esc(x.label || x.title)}</span>
          <span class="mono" style="font-size:11px;color:var(--text-subtle)">${esc(x.rule_id)}</span>
          <span class="badge ${x.outcome === 'pass' ? 'ok' : x.outcome === 'block' ? 'bad' : 'warn'}">${OWORD[x.outcome]}</span>
          ${x.confidential ? '<span class="badge neutral">Internal Only</span>' : ''}
          ${cleared}
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${esc(x.detail)}</div>
        ${fields ? `<div style="margin-top:4px">${fields}</div>` : ''}
        ${ev}
      </div>
    </div>`;
  }

  /* 5. Audit Log */
  function renderTabAudit(sc, c) {
    const items = c.audit.slice().reverse();

    return `
    <div class="office-card">
      <h3>Governance Audit Ledger</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:120px">Timestamp</th>
            <th style="width:80px">Actor</th>
            <th style="width:160px">Event Type</th>
            <th>Detail & Reasoning</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((a) => `
            <tr>
              <td class="mono" style="color:var(--text-subtle)">${esc(fmtShort(a.ts))} ${esc(fmtTime(a.ts))}</td>
              <td><b>${esc(a.actor)}</b></td>
              <td style="font-weight:600">${esc(String(a.event).replace(/_/g, ' '))}</td>
              <td style="color:var(--text-muted)">${esc(a.detail || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
  }

  /* 6. Submission JSON Editor */
  function renderTabEditor(sc, c) {
    const text = state.drafts[sc.id] != null ? state.drafts[sc.id] : JSON.stringify(latestSubmission(sc), null, 2);

    return `
    <div class="office-card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3>Submission Payload (JSON)</h3>
        <button class="btn small" data-act="restore-json">Restore Baseline</button>
      </div>

      <textarea class="mono" style="width:100%;min-height:440px;padding:10px;background:var(--bg-subtle);border:1px solid var(--border-subtle);border-radius:4px;font-size:12px;line-height:1.5" data-act="edit-json">${esc(text)}</textarea>

      ${state.jsonErr ? `<div style="color:#B91C1C;font-size:12px">${esc(state.jsonErr)}</div>` : ''}

      <div style="display:flex;gap:8px">
        <button class="btn primary" data-act="submit-json">Evaluate Payload as Round ${caseOf(sc.id).rounds.length + 1}</button>
      </div>
    </div>`;
  }

  /* -------------------------------------------------------------------------
   * Intake Simulator View
   * ------------------------------------------------------------------------- */
  const INTAKE_TEMPLATES = {
    biogenix: {
      name: 'BioGenix Clinical Research Pvt Ltd',
      entity: 'company',
      country: 'IN',
      tax: 'AABCB9988D',
      gstin: '27AABCB9988D1Z5',
      holder: 'BioGenix Clinical Research Private Limited',
      bank: 'HDFC Bank',
      acct: '50200099887766',
      routing: 'HDFC0001234',
      routingType: 'ifsc',
      industry: 'healthcare',
      tier: 'Tier 1 Critical',
      flag: 'IN',
      standards: ['FDA 21 CFR Part 11', 'GxP Qualified', 'ISO 13485'],
      spend: 4500000,
      currency: 'INR',
    },
    apex: {
      name: 'Apex Mechatronics Corp',
      entity: 'company',
      country: 'US',
      tax: '12-9876543',
      gstin: '',
      holder: 'Apex Mechatronics Corp',
      bank: 'JPMorgan Chase',
      acct: '9876543210',
      routing: '021000021',
      routingType: 'routing_number',
      industry: 'manufacturing',
      tier: 'Tier 1 Strategic',
      flag: 'US',
      standards: ['ISO 9001:2015', 'IATF 16949', 'OSHA 18001'],
      spend: 85000,
      currency: 'USD',
    },
    solaria: {
      name: 'Solaria Clean Power Systems Ltd',
      entity: 'company',
      country: 'GB',
      tax: 'GB980780684',
      gstin: '',
      holder: 'Solaria Clean Power Systems Ltd',
      bank: 'Barclays Bank UK',
      acct: '12345678',
      routing: '20-00-00',
      routingType: 'sort_code',
      industry: 'infrastructure',
      tier: 'Tier 1 Critical',
      flag: 'GB',
      standards: ['ISO 14001 ESG', 'Critical Infrastructure Clearance'],
      spend: 120000,
      currency: 'GBP',
    },
  };

  function renderIntakeView() {
    const tmpl = INTAKE_TEMPLATES[state.intakeTemplate] || INTAKE_TEMPLATES.biogenix;

    return `
    <main style="display:flex;flex-direction:column;gap:14px;max-width:900px;margin:0 auto;width:100%">
      <section class="dossier-header">
        <h2>Vendor Intake & Simulation Form</h2>
        <p>Test supplier onboarding by selecting an enterprise template or entering custom registration credentials.</p>

        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
          <button class="btn small ${state.intakeTemplate === 'biogenix' ? 'primary' : ''}" data-act="set-template" data-t="biogenix">BioGenix Labs (Healthcare / IN)</button>
          <button class="btn small ${state.intakeTemplate === 'apex' ? 'primary' : ''}" data-act="set-template" data-t="apex">Apex Mechatronics (Manufacturing / US)</button>
          <button class="btn small ${state.intakeTemplate === 'solaria' ? 'primary' : ''}" data-act="set-template" data-t="solaria">Solaria Power (Energy / UK)</button>
        </div>
      </section>

      <div class="office-card">
        <h3>1. Corporate & Tax Coordinates</h3>
        <div class="split-two">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-subtle)">Legal Entity Name</label>
            <input type="text" id="in-name" style="width:100%;padding:6px;border:1px solid var(--border-subtle);border-radius:3px;background:var(--bg-subtle)" value="${esc(tmpl.name)}">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-subtle)">Entity Legal Form</label>
            <select id="in-entity" style="width:100%;padding:6px;border:1px solid var(--border-subtle);border-radius:3px;background:var(--bg-subtle)">
              <option value="company" ${tmpl.entity === 'company' ? 'selected' : ''}>Private Limited Company / Corporation</option>
              <option value="llp" ${tmpl.entity === 'llp' ? 'selected' : ''}>Limited Liability Partnership (LLP)</option>
              <option value="sole_proprietor" ${tmpl.entity === 'sole_proprietor' ? 'selected' : ''}>Sole Proprietorship</option>
            </select>
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-subtle)">Tax Identifier (PAN / EIN / VAT)</label>
            <input type="text" id="in-tax" class="mono" style="width:100%;padding:6px;border:1px solid var(--border-subtle);border-radius:3px;background:var(--bg-subtle)" value="${esc(tmpl.tax)}">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-subtle)">Secondary Registration (GSTIN / State Tax)</label>
            <input type="text" id="in-gstin" class="mono" style="width:100%;padding:6px;border:1px solid var(--border-subtle);border-radius:3px;background:var(--bg-subtle)" value="${esc(tmpl.gstin)}">
          </div>
        </div>

        <h3 style="margin-top:12px">2. Settlement Banking Coordinates</h3>
        <div class="split-two">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-subtle)">Account Holder Name</label>
            <input type="text" id="in-holder" style="width:100%;padding:6px;border:1px solid var(--border-subtle);border-radius:3px;background:var(--bg-subtle)" value="${esc(tmpl.holder)}">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-subtle)">Bank Name</label>
            <input type="text" id="in-bank" style="width:100%;padding:6px;border:1px solid var(--border-subtle);border-radius:3px;background:var(--bg-subtle)" value="${esc(tmpl.bank)}">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-subtle)">Account Number / IBAN</label>
            <input type="text" id="in-acct" class="mono" style="width:100%;padding:6px;border:1px solid var(--border-subtle);border-radius:3px;background:var(--bg-subtle)" value="${esc(tmpl.acct)}">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-subtle)">Routing Code (${tmpl.routingType.toUpperCase()})</label>
            <input type="text" id="in-ifsc" class="mono" style="width:100%;padding:6px;border:1px solid var(--border-subtle);border-radius:3px;background:var(--bg-subtle)" value="${esc(tmpl.routing)}">
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-top:16px">
          <button class="btn primary" data-act="submit-intake">Submit & Run 33 Controls</button>
        </div>
      </div>
    </main>`;
  }

  /* -------------------------------------------------------------------------
   * Policy Studio View (33 Rules Catalog)
   * ------------------------------------------------------------------------- */
  function renderPolicyView() {
    const rules = Object.entries(E.RULES);

    return `
    <main style="display:flex;flex-direction:column;gap:14px;max-width:1000px;margin:0 auto;width:100%">
      <section class="dossier-header">
        <h2>Enterprise Rule Catalog (33 Controls)</h2>
        <p>Automated control specifications across completeness, format validations, OCR checks, sanctions, and change control.</p>
      </section>

      <div class="office-card">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:90px">Rule ID</th>
              <th style="width:110px">Category</th>
              <th style="width:220px">Title</th>
              <th>Enforcement Description</th>
            </tr>
          </thead>
          <tbody>
            ${rules.map(([id, r]) => `
              <tr>
                <td class="mono" style="font-weight:600">${esc(id)}</td>
                <td><span class="badge neutral">${esc(r.category)}</span></td>
                <td style="font-weight:600">${esc(r.title)}</td>
                <td style="color:var(--text-muted)">${esc(r.desc)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </main>`;
  }

  /* -------------------------------------------------------------------------
   * Analytics View
   * ------------------------------------------------------------------------- */
  function renderAnalyticsView() {
    return `
    <main style="display:flex;flex-direction:column;gap:14px;max-width:1000px;margin:0 auto;width:100%">
      <section class="dossier-header">
        <h2>Portfolio Governance & Risk Distribution</h2>
        <p>Operational summary of vendor failure reasons, cycle times, and compliance breakdown.</p>
      </section>

      <div class="split-two">
        <div class="office-card">
          <h3>Top Initial Deficiencies</h3>
          <table class="data-table">
            <thead><tr><th>Control</th><th>Description</th><th>Rate</th></tr></thead>
            <tbody>
              <tr><td class="mono">DOC-03</td><td>Name Mismatch on Certificate</td><td>38%</td></tr>
              <tr><td class="mono">FMT-01</td><td>Wrong Country / Invalid Format</td><td>24%</td></tr>
              <tr><td class="mono">DOC-05</td><td>Stale Bank Proof (>90 Days)</td><td>19%</td></tr>
              <tr><td class="mono">RISK-05</td><td>Urgent Bank Change Without Verification</td><td>11%</td></tr>
            </tbody>
          </table>
        </div>

        <div class="office-card">
          <h3>Geographic Exposure</h3>
          <table class="data-table">
            <thead><tr><th>Region</th><th>Primary Control Focus</th><th>Share</th></tr></thead>
            <tbody>
              <tr><td>India</td><td>GST / PAN / CIN Cross-checks</td><td>64%</td></tr>
              <tr><td>United States</td><td>EIN / W-9 / ABA Routing</td><td>18%</td></tr>
              <tr><td>United Kingdom</td><td>Companies House / UK VAT</td><td>9%</td></tr>
              <tr><td>European Union</td><td>Handelsregister / IBAN Mod-97</td><td>6%</td></tr>
              <tr><td>Rest of World</td><td>OFAC & International Trade</td><td>3%</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>`;
  }

  /* -------------------------------------------------------------------------
   * Modals & Dialogs
   * ------------------------------------------------------------------------- */
  function renderModals() {
    if (!state.modal) return '';

    if (state.modal === 'spotlight') {
      const q = state.spotlightQuery.toLowerCase().trim();
      let results = state.world.scenarios;
      if (q) results = results.filter((s) => s.title.toLowerCase().includes(q) || s.tag.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));

      return `
      <div class="modal-overlay" data-act="close-modal">
        <div class="modal-box" onclick="event.stopPropagation()">
          <input type="text" class="queue-search-input" style="font-size:14px;padding:8px" placeholder="Quick find vendor or rule..." value="${esc(state.spotlightQuery)}" autofocus data-act="spotlight-search">
          <div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
            ${results.map((s) => `
              <div style="padding:8px;border-radius:4px;cursor:pointer;display:flex;justify-content:space-between;align-items:center" class="queue-item" data-act="spotlight-pick" data-id="${s.id}">
                <div>
                  <div style="font-weight:600">${esc(s.title)}</div>
                  <div style="font-size:11.5px;color:var(--text-subtle)">${esc(s.tag)}</div>
                </div>
                <span class="badge neutral mono">${esc(s.id)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>`;
    }

    if (state.modal === 'cert') {
      const sc = scen(state.sel);
      const c = caseOf(sc.id);

      return `
      <div class="modal-overlay" data-act="close-modal">
        <div class="modal-box" onclick="event.stopPropagation()">
          <h3>Certificate of Vendor Qualification</h3>
          <div style="background:var(--bg-subtle);border:1px solid var(--border-subtle);padding:12px;border-radius:4px;font-size:12px;display:flex;flex-direction:column;gap:6px">
            <div>Vendor: <b>${esc(sc.title)}</b></div>
            <div>Case ID: <span class="mono"><b>${esc(c.id)}</b></span></div>
            <div>Status: <span class="badge ok">${c.status.toUpperCase()}</span></div>
            <div>Audit Verification: <b>33 Compliance Controls Validated</b></div>
            <div>Date: <span class="mono">${esc(fmtDay(state.now))}</span></div>
            <div>Auditor: <b>Jessica Drake (Procurement Risk)</b></div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:6px">
            <button class="btn" data-act="close-modal">Close</button>
            <button class="btn primary" onclick="window.print()">Print Report</button>
          </div>
        </div>
      </div>`;
    }

    if (state.modal === 'callback') {
      return `
      <div class="modal-overlay" data-act="close-modal">
        <div class="modal-box" onclick="event.stopPropagation()">
          <h3>Telephone Callback Verification (RISK-05)</h3>
          <p style="font-size:12px;color:var(--text-subtle);margin:0">Log mandatory out-of-band telephone verification before payment hold release.</p>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-subtle)">Phone on File Called</label>
              <input type="text" class="mono" style="width:100%;padding:6px;border:1px solid var(--border-subtle);background:var(--bg-subtle)" value="+91 98450 11223" readonly>
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-subtle)">Contact Person Confirmed</label>
              <input type="text" id="cb-person" style="width:100%;padding:6px;border:1px solid var(--border-subtle);background:var(--bg-surface)" value="Meera Rao (Finance Director)">
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-subtle)">Verification Note</label>
              <textarea id="cb-notes" style="width:100%;min-height:50px;padding:6px;border:1px solid var(--border-subtle);background:var(--bg-surface)">Called contact on file. Verified genuine treasury move.</textarea>
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:6px">
            <button class="btn" data-act="close-modal">Cancel</button>
            <button class="btn primary" data-act="save-callback">Save Verification</button>
          </div>
        </div>
      </div>`;
    }

    return '';
  }

  /* -------------------------------------------------------------------------
   * Master Render Loop
   * ------------------------------------------------------------------------- */
  function render() {
    const app = document.getElementById('app');
    if (!app) return;

    let bodyContent = '';
    if (state.view === 'workbench') {
      bodyContent = `
        ${renderPulseBar()}
        <div class="workbench-grid">
          ${renderQueue()}
          ${renderDossier()}
        </div>`;
    } else if (state.view === 'intake') {
      bodyContent = renderIntakeView();
    } else if (state.view === 'policy') {
      bodyContent = renderPolicyView();
    } else if (state.view === 'analytics') {
      bodyContent = renderAnalyticsView();
    }

    app.innerHTML = renderHeader() + bodyContent + renderModals();
  }

  /* -------------------------------------------------------------------------
   * Event Handlers
   * ------------------------------------------------------------------------- */
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.noteKey) {
      state.notes[t.dataset.noteKey] = t.value;
      state.errs[t.dataset.noteKey] = '';
    }
    if (t.dataset && t.dataset.act === 'search-queue') {
      state.search = t.value;
      render();
    }
    if (t.dataset && t.dataset.act === 'spotlight-search') {
      state.spotlightQuery = t.value;
      render();
    }
    if (t.dataset && t.dataset.act === 'edit-json') {
      state.drafts[state.sel] = t.value;
      state.jsonErr = '';
    }
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    const sc = scen(state.sel);

    if (a === 'view') {
      state.view = b.dataset.v;
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (a === 'select-case') {
      state.sel = b.dataset.id;
      state.view = 'workbench';
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (a === 'dossier-tab') {
      state.tab = b.dataset.t;
      render();
      return;
    }
    if (a === 'queue-tab') {
      state.queueFilter = b.dataset.q;
      render();
      return;
    }
    if (a === 'trace-filter') {
      state.filter = b.dataset.f;
      render();
      return;
    }
    if (a === 'tick') {
      advance(Number(b.dataset.d));
      render();
      return;
    }
    if (a === 'reset') {
      init();
      showToast('Environment reset to baseline');
      render();
      return;
    }
    if (a === 'advance-step') {
      submit(sc, sc.steps[state.next[sc.id]]);
      state.next[sc.id]++;
      showToast(`Advanced to Round ${caseOf(sc.id).rounds.length}`);
      render();
      return;
    }
    if (a === 'restart-case') {
      const cid = state.cases[sc.id];
      if (cid) state.store.cases.delete(cid);
      delete state.cases[sc.id];
      submit(sc, sc.steps[0]);
      state.next[sc.id] = 1;
      showToast('Case restarted');
      render();
      return;
    }
    if (a === 'copy-mail') {
      const text = document.getElementById('mail-text').textContent;
      try {
        navigator.clipboard.writeText(text);
        showToast('Message copied to clipboard');
      } catch (err) {
        showToast('Selected. Press Ctrl+C');
      }
      return;
    }
    if (a === 'resolve-finding') {
      const key = b.dataset.key;
      const dec = b.dataset.dec;
      const note = (state.notes[key] || '').trim();
      if (!note) {
        state.errs[key] = 'Please provide an audit note.';
        render();
        return;
      }
      const c = caseOf(sc.id);
      try {
        state.store.resolve(c.id, { key, decision: dec, by: 'J. Drake (Analyst)', note }, state.now);
        delete state.notes[key];
        delete state.errs[key];
        showToast(`Finding ${dec === 'clear' ? 'cleared' : 'rejected'}`);
      } catch (err) {
        state.errs[key] = err.message;
      }
      render();
      return;
    }
    if (a === 'open-spotlight') {
      state.modal = 'spotlight';
      state.spotlightQuery = '';
      render();
      return;
    }
    if (a === 'open-cert') {
      state.modal = 'cert';
      render();
      return;
    }
    if (a === 'open-callback') {
      state.modal = 'callback';
      render();
      return;
    }
    if (a === 'close-modal') {
      state.modal = null;
      render();
      return;
    }
    if (a === 'spotlight-pick') {
      state.sel = b.dataset.id;
      state.modal = null;
      state.view = 'workbench';
      render();
      return;
    }
    if (a === 'save-callback') {
      const c = caseOf(sc.id);
      state.verifiedCallbacks[c.id] = {
        at: state.now.toISOString(),
        by: 'J. Drake',
        person: document.getElementById('cb-person').value,
        notes: document.getElementById('cb-notes').value,
      };
      state.modal = null;
      showToast('Callback verified and logged');
      render();
      return;
    }
    if (a === 'toggle-theme') {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
      render();
      return;
    }
    if (a === 'restore-json') {
      delete state.drafts[sc.id];
      state.jsonErr = '';
      showToast('Payload restored');
      render();
      return;
    }
    if (a === 'submit-json') {
      const txt = state.drafts[sc.id] != null ? state.drafts[sc.id] : JSON.stringify(latestSubmission(sc));
      try {
        const sub = JSON.parse(txt);
        submit(sc, sub);
        state.jsonErr = '';
        state.tab = 'overview';
        showToast('New round evaluated');
      } catch (err) {
        state.jsonErr = 'Invalid JSON: ' + err.message;
      }
      render();
      return;
    }
    if (a === 'set-template') {
      state.intakeTemplate = b.dataset.t;
      render();
      return;
    }
    if (a === 'submit-intake') {
      const tmpl = INTAKE_TEMPLATES[state.intakeTemplate] || INTAKE_TEMPLATES.biogenix;
      const name = document.getElementById('in-name').value;
      const tax = document.getElementById('in-tax').value;
      const gstin = document.getElementById('in-gstin').value;
      const holder = document.getElementById('in-holder').value;
      const acct = document.getElementById('in-acct').value;
      const ifsc = document.getElementById('in-ifsc').value;

      const bankObj = { account_holder_name: holder, bank_name: tmpl.bank, currency: tmpl.currency, account_number: acct };
      if (tmpl.routingType === 'ifsc') bankObj.ifsc = ifsc;
      else if (tmpl.routingType === 'routing_number') bankObj.routing_number = ifsc;
      else if (tmpl.routingType === 'sort_code') bankObj.sort_code = ifsc;
      else bankObj.iban = ifsc;

      const taxObj = {};
      if (tmpl.country === 'IN') { taxObj.pan = tax; if (gstin) taxObj.gstin = gstin; }
      else if (tmpl.country === 'US') { taxObj.tin_type = 'EIN'; taxObj.tin = tax; }
      else if (tmpl.country === 'GB') { taxObj.vat_number = tax; }
      else { taxObj.tax_id = tax; }

      const newSub = {
        submission_id: 'SUB-INTAKE-' + Math.floor(Math.random() * 9000 + 1000),
        vendor: {
          legal_name: name,
          country: tmpl.country,
          entity_type: tmpl.entity,
          supply_type: 'services',
          contact: { name: 'Operations Lead', email: 'ops@' + name.toLowerCase().replace(/[^a-z]/g, '') + '.com', phone: '+1 555 0199' },
          address: { line1: '100 Enterprise Way', city: 'Metropolis', country: tmpl.country },
        },
        tax: taxObj,
        bank: bankObj,
        declarations: { sanctions_clean: true, pep: false, beneficial_owners: [{ name: 'Operations Lead', ownership_pct: 100, country: tmpl.country }] },
        request: { estimated_annual_spend: { amount: tmpl.spend, currency: tmpl.currency } },
        documents: [
          { declared_type: 'pan_card', filename: 'tax_proof.pdf', extracted: { detected_type: 'pan_card', legible: true, name: name.toUpperCase(), id_number: tax } },
        ],
      };

      const customScen = {
        id: 'CUSTOM-' + Date.now().toString().slice(-4),
        kind: 'baseline',
        title: name,
        tag: 'Intake Submission',
        blurb: 'Simulated enterprise vendor onboarded through the self-service intake portal.',
        steps: [newSub],
        industry: tmpl.industry,
        industry_name: tmpl.industry_name || 'Enterprise',
        tier: tmpl.tier,
        flag: tmpl.flag,
        standards: tmpl.standards,
        risk_score: 18,
      };

      state.world.scenarios.unshift(customScen);
      submit(customScen, newSub);
      state.sel = customScen.id;
      state.view = 'workbench';
      showToast('Vendor evaluated and opened in review queue');
      render();
      return;
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('queue-select')) {
      state.industryFilter = e.target.value;
      render();
    }
  });

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      state.modal = state.modal === 'spotlight' ? null : 'spotlight';
      state.spotlightQuery = '';
      render();
    }
    if (e.key === 'Escape' && state.modal) {
      state.modal = null;
      render();
    }
  });

  init();
  render();
})();

/* ============================================================
   PocketDevs Proposal Generator
   Build-free static app. Calls a Vercel API route that holds the
   Gemini key server-side; renders structured JSON into a branded proposal.
   ============================================================ */
'use strict';

import { getSession, signIn, signUp, saveProposal, fetchUserProposals, deleteProposal, fetchProposalById, fetchUserQuestionnaires, deleteQuestionnaire, SUPABASE_URL, SUPABASE_ANON_KEY, updateUserProfile, updateUserEmail, updateUserPassword, enableShare, disableShare, getSharedDoc, saveSharedDoc, createDocChannel } from './supabase.js?v=27';
import { initLayout } from './nav.js?v=27';
import { createQuickSearch } from './quick-search.js';

/* ---------- Constants ---------- */
const MODEL = 'gemini-2.5-flash';
// Generation goes through a Vercel Function, which holds the Gemini key
// as a server-side secret. The browser never sees the key.
const PRODUCTION_ORIGIN = 'https://pocketdevs-proposal-generator.vercel.app';
const IS_LOCAL_PREVIEW = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_URL = `${IS_LOCAL_PREVIEW ? PRODUCTION_ORIGIN : window.location.origin}/api/generate-proposal`;
const LS_LOGO = 'pdv_logo';
const DEFAULT_LOGO = 'assets/logo.svg';

const STYLE_EXEMPLAR = `
PocketDevs proposals read like this reference (AI-Assisted Development Training & Consultation for Elgada BPO):
- Tone: confident, precise, commercially clear; no fluff, no hype. Short declarative sentences.
- Structure: a doc number + prepared date in the header, a clear "Prepared for" party, an objective-led
  opening, concrete scope steps with outcomes, a transparent cost basis, explicit commercial terms, then
  an acceptance/signature by the CEO.
- Money is stated plainly (e.g. "Php 20,000 per facilitated hour"; totals exclusive of VAT and reimbursables).
- Terms cover: confirmation & payment (e.g. 50% reservation), taxes & expenses (exclusive of VAT),
  rescheduling, scope control, IP / internal-use license, and validity.
- Footer is always: PocketDevs | Confidential | www.pocketdevs.ph. Signatory defaults to the CEO.
`;

const SYSTEM_PROMPT = `You are the proposal writer for PocketDevs (a Philippine software development studio).
Given a client's source document (brief, notes, RFP, or scope) plus confirmed deal details, produce a
complete, client-ready proposal as STRUCTURED JSON matching the provided schema. Cover all ten sections:
Executive Summary, Solutions Outline, Objectives, Full Scope of Work, Project Timeline, Project Cost,
Milestones and Payment Terms, Payment Options, Post Launch Support, and Terms and Services.

Rules:
- Ground every claim in the source document. Be specific to THIS client and project — never generic.
- For hard facts (client name, project title, currency, timeline, dates, document number), use ONLY the
  confirmed details provided by the user. If a needed value is missing, output the literal string "[TBD]"
  — never invent precise figures, dates, or names.
- TOTAL COST / BUDGET is the one exception: if no total cost or budget figure was provided, do NOT output
  "[TBD]". Instead, estimate a reasonable ballpark budget range based on the scope, complexity, deliverables,
  and timeline you've worked out for this project (use your judgement of typical Philippine software/dev
  market rates). Express it as a range (e.g. "Php 180,000 – 250,000 (estimate)") and clearly mark it as an
  estimate so the client knows it's not a fixed quote.
- Currency defaults to Philippine Peso (write amounts like "Php 250,000"). Keep totals exclusive of VAT
  unless told otherwise, and say so.
- Scope of Work should be organized into phases, each with concrete deliverables.
- Timeline, Project Cost, and Milestones should be tabular and internally consistent (milestone amounts
  should reconcile to the total cost — whether confirmed or estimated).
- MILESTONES AND PAYMENT TERMS: unless the user's payment details specify a different schedule, use a
  3-milestone split of 50% (upon confirmation/signing), 30% (mid-project milestone), and 20% (final
  delivery/acceptance). For each milestone, compute the exact peso (or stated currency) amount that
  percentage represents of the total cost (confirmed or estimated) and show it next to the percentage —
  the client should never have to calculate it themselves. The three amounts must sum to the total.
- Terms and Services must include, at minimum: confirmation & payment, taxes & expenses, scope control /
  change requests, IP & internal-use license, warranty/support boundary, and validity of the quotation.
- Write in PocketDevs' house voice.

${STYLE_EXEMPLAR}

Return only the structured proposal. Do not include commentary outside the JSON.`;

/* ---------- Structured-output schema (strict json_schema) ---------- */
const obj = (props) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const str = (description) => ({ type: 'string', description });
const arr = (items, description) => ({ type: 'array', items, description });

const PROPOSAL_SCHEMA = obj({
  meta: obj({
    documentNumber: str('Quotation/proposal reference, e.g. PD-2026-0614'),
    preparedDate: str('Human date, e.g. June 14, 2026'),
    validUntil: str('Date the quotation is valid until, or [TBD]'),
    title: str('Proposal title / project name'),
    currency: str('Currency code or symbol, e.g. PHP'),
    budget: str('Optional manual budget display text'),
    paymentDetails: str('Optional manual payment details text'),
  }),
  client: obj({
    company: str('Client company name'),
    contactName: str('Primary contact, or [TBD]'),
    contactTitle: str('Contact role, or [TBD]'),
  }),
  preparedBy: obj({
    name: str('Signatory name'),
    title: str('Signatory title'),
    company: str('Always "PocketDevs"'),
  }),
  executiveSummary: str('2-4 paragraph executive summary. Use \\n\\n between paragraphs.'),
  solutionsOutline: obj({
    summary: str('Short framing paragraph of the proposed solution.'),
    points: arr(str('A key element of the solution'), 'Bulleted solution components'),
  }),
  objectives: arr(str('A measurable objective'), 'Project objectives'),
  scopeOfWork: arr(obj({
    phase: str('Phase / workstream name'),
    deliverables: arr(str('A concrete deliverable'), 'Deliverables for this phase'),
  }), 'Full scope organized by phase'),
  timeline: arr(obj({
    phase: str('Phase / stage'),
    duration: str('Duration, e.g. "2 weeks"'),
    milestone: str('Key output at this stage'),
  }), 'Project timeline rows'),
  cost: obj({
    lineItems: arr(obj({
      item: str('Line item'),
      basis: str('Commercial basis / notes'),
      amount: str('Amount as text, e.g. "Php 120,000", or an estimated figure marked "(estimate)" if no budget was confirmed'),
    }), 'Cost line items'),
    notes: str('Notes, e.g. exclusive of VAT and reimbursables. If the total is an estimate, note that it is a ballpark figure subject to confirmation.'),
    total: str('Total amount as text. If no budget was confirmed, give a ballpark range marked "(estimate)" instead of "[TBD]"'),
  }),
  milestonesPayment: arr(obj({
    milestone: str('Milestone name'),
    percentage: str('Percent of total, e.g. "50%". Default to a 50% / 30% / 20% split across 3 milestones unless the payment details say otherwise.'),
    amount: str('The peso amount this percentage represents of the total (confirmed or estimated), computed for the client. Mark "(estimate)" if the total is an estimate.'),
    trigger: str('What triggers this payment'),
  }), 'Milestones and payment schedule'),
  paymentOptions: arr(str('A payment method / option'), 'Accepted payment options'),
  postLaunchSupport: obj({
    summary: str('Support framing paragraph'),
    inclusions: arr(str('A support inclusion'), 'What post-launch support covers'),
  }),
  termsAndServices: arr(obj({
    heading: str('Clause heading'),
    body: str('Clause text'),
  }), 'Terms and services clauses'),
});

/* ---------- Tiny DOM helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const paras = (s) => String(s || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

/* ---------- State ---------- */
let pdfBase64 = null;
let pdfName = null;

/* ---------- Status ---------- */
function setStatus(kind, html) {
  const el = $('status');
  if (!html) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.className = 'status' + (kind ? ` status--${kind}` : '');
  el.innerHTML = html;
}

function showToast(msg, kind = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast--${kind}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('toast--visible'), 10);
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/* ---------- Branding (logo) ---------- */
function currentLogo() { return localStorage.getItem(LS_LOGO) || DEFAULT_LOGO; }
function applyLogo() {
  const src = currentLogo();
  document.querySelectorAll('.js-logo').forEach((img) => { img.src = src; });
}

/* ---------- Locale / currency ---------- */
function getLocale(id = 'f_locale') { const el = $(id); return (el && el.value) || 'en-PH'; }
function currencySymbol(id = 'f_currency') {
  const sel = $(id);
  const opt = sel && sel.options[sel.selectedIndex];
  return (opt && opt.dataset.symbol) || '';
}

function normalizeBearerToken(raw) {
  const cleaned = String(raw || '').replace(/[^A-Za-z0-9._-]/g, '');
  return cleaned.split('.').length === 3 ? cleaned : '';
}

/* ---------- File handling ---------- */
function handleFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    setStatus('error', 'Please choose a PDF file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    pdfBase64 = String(reader.result).split(',')[1] || null;
    pdfName = file.name;
    const dz = $('dropzone');
    dz.classList.add('has-file');
    $('fileName').textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
    setStatus('', '');
  };
  reader.onerror = () => setStatus('error', 'Could not read that file.');
  reader.readAsDataURL(file);
}

function handleLogo(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) { setStatus('error', 'Please choose an image file (PNG, SVG, JPG, or WebP).'); return; }
  if (file.size > 1.5 * 1024 * 1024) { setStatus('error', 'That logo is over 1.5 MB — please use a smaller file.'); return; }
  const reader = new FileReader();
  reader.onload = () => { localStorage.setItem(LS_LOGO, String(reader.result)); applyLogo(); setStatus('ok', 'Logo updated — it now appears on every proposal.'); };
  reader.onerror = () => setStatus('error', 'Could not read that image.');
  reader.readAsDataURL(file);
}

/* ---------- Intake ---------- */
function collectIntake() {
  return {
    company: $('f_company').value.trim(),
    title: $('f_title').value.trim(),
    contactName: $('f_contact').value.trim(),
    contactTitle: $('f_contactTitle').value.trim(),
    currency: $('f_currency').value.trim() || 'PHP',
    currencySymbol: currencySymbol(),
    locale: getLocale(),
    totalCost: $('f_cost').value.trim(),
    timeline: $('f_timeline').value.trim(),
    validUntil: $('f_valid').value.trim(),
    documentNumber: $('f_docno').value.trim(),
    preparedDate: $('f_date').value.trim(),
    signatory: $('f_signatory').value.trim() || 'Eric Jeremie Rotaquio',
    signatoryTitle: $('f_signatoryTitle').value.trim() || 'Chief Executive Officer, PocketDevs',
    notes: $('f_notes').value.trim(),
    budget: $('f_budget').value.trim(),
    paymentDetails: $('f_paymentDetails').value.trim(),
    proposalName: $('f_proposalName').value.trim(),
  };
}

function collectInvoiceIntake() {
  return {
    client: $('f_inv_client').value.trim(),
    contact: $('f_inv_contact').value.trim(),
    clientTin: $('f_inv_clientTin').value.trim(),
    company: $('f_inv_company').value.trim() || 'PocketDevs',
    tin: $('f_inv_tin').value.trim(),
    invoiceNumber: $('f_inv_no').value.trim(),
    currency: $('f_inv_currency').value.trim() || 'PHP',
    currencySymbol: currencySymbol('f_inv_currency'),
    locale: getLocale('f_inv_locale'),
    invoiceDate: $('f_inv_date').value.trim(),
    dueDate: $('f_inv_due').value.trim(),
    paymentDetails: $('f_inv_paymentDetails').value.trim(),
    invoiceName: $('f_inv_name').value.trim(),
  };
}

/* ---------- Generate ---------- */
async function generate() {
  // Generation runs through a Vercel Function, which holds the Gemini key
  // server-side and requires a signed-in user. We need a valid Supabase
  // session token to authorize the call.
  const session = await getSession();
  const authToken = normalizeBearerToken(session && session.access_token ? session.access_token : '');
  if (!authToken) {
    showAuthModal();
    setStatus('error', 'Please sign in to generate a proposal.');
    return;
  }
  const intake = collectIntake();
  const hasDetails = intake.company || intake.title || intake.notes;
  if (!pdfBase64 && !hasDetails) {
    setStatus('error', 'Drop a PDF brief, or fill in at least the company/project details.');
    return;
  }

  const btn = $('generateBtn');
  btn.disabled = true;
  setStatus('working', '<span class="spinner"></span> Reading the document and drafting all 10 sections… this can take 30–60s.');

  const userText =
    'Draft a PocketDevs proposal' + (pdfBase64 ? ' based on the attached source document and these confirmed details.' : ' from these confirmed details.') +
    '\\nUse ONLY these confirmed values for hard facts; output "[TBD]" for anything missing, EXCEPT totalCost/budget — ' +
    'if those are not provided, estimate a ballpark budget range based on the scope and complexity instead.\\n\\n' +
    'CONFIRMED DETAILS (JSON):\\n' + JSON.stringify({
      clientCompany: intake.company || null,
      projectTitle: intake.title || null,
      clientContactName: intake.contactName || null,
      clientContactTitle: intake.contactTitle || null,
      currency: intake.currency,
      currencySymbol: intake.currencySymbol || null,
      locale: intake.locale,
      totalCost: intake.totalCost || null,
      timeline: intake.timeline || null,
      validUntil: intake.validUntil || null,
      documentNumber: intake.documentNumber || null,
      preparedDate: intake.preparedDate || null,
      signatory: intake.signatory,
      signatoryTitle: intake.signatoryTitle,
      budget: intake.budget || null,
      paymentDetails: intake.paymentDetails || null,
    }, null, 2) +
    (intake.notes ? '\\n\\nEXTRA INSTRUCTIONS:\\n' + intake.notes : '') +
    `\\n\\nFORMATTING: Write every monetary amount with the "${intake.currencySymbol || intake.currency}" symbol (currency ${intake.currency}), e.g. "${intake.currencySymbol || ''}120,000". Use ${intake.locale} conventions for dates and number grouping.` +
    '\\n\\nReturn the full structured proposal.';

  const content = [];
  if (pdfBase64) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } });
  }
  content.push({ type: 'text', text: userText });

  const body = {
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: PROPOSAL_SCHEMA }, effort: 'high' },
  };

  try {
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (/pattern|header|invalid/i.test(err && err.message ? err.message : '')) {
        showAuthModal();
        setStatus('error', 'Your sign-in session looks corrupted. Please sign out and sign back in.');
        return;
      }
      throw err;
    }
    const responseText = await res.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(`Proposal service returned an unexpected response (HTTP ${res.status}). Please use ${PRODUCTION_ORIGIN}.`);
    }

    if (!res.ok) {
      const msg = data && data.error ? data.error.message : `HTTP ${res.status}`;
      // Only prompt to sign in when our own edge function rejected the session —
      // not when Gemini's API itself returns a 401 (e.g. invalid server-side API key).
      if (res.status === 401 && /sign(ed)? in|session/i.test(msg)) { showAuthModal(); }
      setStatus('error', `Generation failed: ${esc(msg)}`);
      return;
    }

    const block = (data.content || []).find((b) => b.type === 'text');
    if (!block) { setStatus('error', 'No proposal text returned. Try again.'); return; }

    let proposal;
    try { proposal = JSON.parse(block.text); }
    catch (e) { setStatus('error', 'Response was not valid JSON.'); return; }

    // These are manual-override fields: only honor them if the user actually
    // typed something, regardless of what the model echoed back.
    if (proposal.meta) {
      proposal.meta.budget = intake.budget || '';
      proposal.meta.paymentDetails = intake.paymentDetails || '';
      if (intake.proposalName) proposal.meta.title = intake.proposalName;
    }

    render(proposal);
    setActiveDoc({ id: null, content: proposal, token: null });
    // Best-effort save to history (we're signed in; never blocks the result).
    try {
      const { data, error: saveErr } = await saveProposal(proposal);
      if (saveErr && saveErr !== 'not-authenticated' && saveErr !== 'offline') {
        console.warn('Could not save proposal to history:', saveErr);
      } else if (!saveErr) {
        setActiveDoc({ id: data && data[0] && data[0].id, content: proposal, token: null });
        refreshHistory();
      }
    } catch (e) { /* history is optional — ignore */ }
    setStatus('ok', `Proposal generated! Click any text to edit, then <b>Download PDF</b>.`);
  } catch (err) {
    setStatus('error', `Network error: ${esc(err.message)}.`);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Render ---------- */
function sectionHead(n, title) {
  return `<div class="p-section__head"><span class="p-section__num">${String(n).padStart(2, '0')}</span>` +
    `<h2 class="p-section__title">${esc(title)}</h2></div>`;
}
function list(items, mod) {
  if (!items || !items.length) return '';
  return `<ul class="p-list${mod ? ' ' + mod : ''}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

/* ---------- Amount helpers (for auto-computing milestone splits) ---------- */
function parseAmount(text) {
  if (!text) return null;
  const m = String(text).match(/[\d,]+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ''));
  return isNaN(n) ? null : n;
}
function currencyPrefix(text) {
  const m = String(text || '').match(/^[^\d]*/);
  return m ? m[0].trim() + ' ' : '';
}
function formatAmount(n, prefix) {
  return `${prefix}${Math.round(n).toLocaleString('en-US')}`;
}

/* PocketDevs' default bank/e-wallet accounts, shown in Payment Options unless
   the user provides their own payment details. */
const PAYMENT_ACCOUNTS = [
  { badge: 'BPI', badgeClass: 'p-paymethod__badge--bpi', bank: 'Bank of the Philippine Islands (BPI)', name: 'Bryl Kezter Lim', account: '9939078077' },
  { badge: 'GCash', badgeClass: 'p-paymethod__badge--gcash', bank: 'GCash', name: 'Bryl Kezter Lim', account: '09055210329' },
];
function paymentAccounts() {
  return `<div class="p-paymethods">${PAYMENT_ACCOUNTS.map((a) => `
    <div class="p-paymethod">
      <div class="p-paymethod__badge ${a.badgeClass}">${esc(a.badge)}</div>
      <div class="p-paymethod__info">
        <div class="p-paymethod__bank">${esc(a.bank)}</div>
        <div class="p-paymethod__name">${esc(a.name)}</div>
        <div class="p-paymethod__account">${esc(a.account)}</div>
      </div>
    </div>`).join('')}</div>`;
}

function render(d) {
  if (!d) return;
  const m = d.meta || {}, c = d.client || {}, pb = d.preparedBy || {};
  const cover = `
    <header class="p-cover">
      <div class="p-cover__top">
        <img src="${esc(currentLogo())}" alt="Logo" class="p-cover__logo js-logo" />
        <div class="p-eyebrow">
          <div class="js-doc-no"><b>${esc(m.documentNumber || '[TBD]')}</b></div>
          <div>Prepared ${esc(m.preparedDate || '[TBD]')}</div>
          ${m.validUntil ? `<div>Valid until ${esc(m.validUntil)}</div>` : ''}
        </div>
      </div>
      <span class="p-kicker">Proposal</span>
      <h1 class="p-title">${esc(m.title || 'Project Proposal')}</h1>
      <div class="p-parties">
        <div class="p-party">
          <div class="p-party__label">Prepared for</div>
          <div class="p-party__name">${esc(c.company || '[TBD]')}</div>
          ${c.contactName ? `<div class="p-party__meta">${esc(c.contactName)}${c.contactTitle ? ' · ' + esc(c.contactTitle) : ''}</div>` : ''}
        </div>
        <div class="p-party">
          <div class="p-party__label">Prepared by</div>
          <div class="p-party__name">${esc(pb.company || 'PocketDevs')}</div>
          <div class="p-party__meta">${esc(pb.name || '')}${pb.title ? ' · ' + esc(pb.title) : ''}</div>
        </div>
      </div>
    </header>`;

  const sec = [];
  sec.push(`<section class="p-section">${sectionHead(1, 'Executive Summary')}<div class="p-lede">${paras(d.executiveSummary)}</div></section>`);
  const so = d.solutionsOutline || {};
  sec.push(`<section class="p-section">${sectionHead(2, 'Solutions Outline')}${paras(so.summary)}${list(so.points)}</section>`);
  sec.push(`<section class="p-section">${sectionHead(3, 'Objectives')}${list(d.objectives)}</section>`);
  const scope = (d.scopeOfWork || []).map((g) => `
    <div class="p-scope__group">
      <div class="p-scope__phase">${esc(g.phase)}</div>
      ${list(g.deliverables, 'p-list--check')}
    </div>`).join('');
  sec.push(`<section class="p-section">${sectionHead(4, 'Full Scope of Work')}<div class="p-scope">${scope}</div></section>`);
  const tl = (d.timeline || []).map((r) => `<tr><td>${esc(r.phase)}</td><td>${esc(r.duration)}</td><td>${esc(r.milestone)}</td></tr>`).join('');
  sec.push(`<section class="p-section">${sectionHead(5, 'Project Timeline')}
    <table class="p-table"><thead><tr><th>Phase</th><th>Duration</th><th>Key milestone</th></tr></thead><tbody>${tl}</tbody></table></section>`);
  const cost = d.cost || {};
  const ci = (cost.lineItems || []).map((r) => `<tr><td>${esc(r.item)}</td><td>${esc(r.basis)}</td><td class="num">${esc(r.amount)}</td></tr>`).join('');
  const budgetLede = d.meta.budget ? `<div class="p-lede"><p><strong>Proposed Budget:</strong> ${esc(d.meta.budget)}</p></div>` : '';
  sec.push(`<section class="p-section">${sectionHead(6, 'Project Cost')}
  ${budgetLede}
  <table class="p-table"><thead><tr><th>Line item</th><th>Basis</th><th class="num">Amount</th></tr></thead>
  <tbody>${ci}${cost.total ? `<tr class="p-table__total"><td>Total</td><td></td><td class="num">${esc(cost.total)}</td></tr>` : ''}</tbody></table>
  ${cost.notes ? `<div class="p-note">${esc(cost.notes)}</div>` : ''}</section>`);
  let milestones = (d.milestonesPayment || []).filter((r) => r && r.amount && r.amount !== '[TBD]' && r.percentage && r.percentage !== '[TBD]');
  if (!milestones.length) {
    const totalSource = (cost.total && cost.total !== '[TBD]') ? cost.total : d.meta.budget;
    const totalAmount = parseAmount(totalSource);
    if (totalAmount != null) {
      const prefix = currencyPrefix(totalSource);
      const suffix = /estimate/i.test(totalSource) ? ' (estimate)' : '';
      milestones = [
        { milestone: 'Confirmation / Project Kickoff', percentage: '50%', amount: formatAmount(totalAmount * 0.5, prefix) + suffix, trigger: 'Upon signing and confirmation' },
        { milestone: 'Mid-Project Delivery', percentage: '30%', amount: formatAmount(totalAmount * 0.3, prefix) + suffix, trigger: 'Upon completion of the core development milestone' },
        { milestone: 'Final Delivery', percentage: '20%', amount: formatAmount(totalAmount * 0.2, prefix) + suffix, trigger: 'Upon final delivery and client acceptance' },
      ];
    }
  }
  const mp = milestones.map((r) => `<tr><td>${esc(r.milestone)}</td><td class="num">${esc(r.percentage)}</td><td class="num">${esc(r.amount)}</td><td>${esc(r.trigger)}</td></tr>`).join('');
  if (d.meta.paymentDetails) {
    sec.push(`<section class="p-section">${sectionHead(7, 'Milestones and Payment Terms')}<div class="p-lede"><p>${esc(d.meta.paymentDetails)}</p></div></section>`);
  } else {
    sec.push(`<section class="p-section">${sectionHead(7, 'Milestones and Payment Terms')}
    <table class="p-table"><thead><tr><th>Milestone</th><th class="num">%</th><th class="num">Amount</th><th>Trigger</th></tr></thead><tbody>${mp}</tbody></table></section>`);
  }
  if (d.meta.paymentDetails) {
    sec.push(`<section class="p-section">${sectionHead(8, 'Payment Options')}<div class="p-lede"><p>${esc(d.meta.paymentDetails)}</p></div></section>`);
  } else {
    sec.push(`<section class="p-section">${sectionHead(8, 'Payment Options')}${paymentAccounts()}${list(d.paymentOptions)}</section>`);
  }
  const pls = d.postLaunchSupport || {};
  sec.push(`<section class="p-section">${sectionHead(9, 'Post Launch Support')}${paras(pls.summary)}${list(pls.inclusions, 'p-list--check')}</section>`);
  const terms = (d.termsAndServices || []).map((t) => `<p class="p-term"><span class="p-term__h">${esc(t.heading)}:</span> <span class="p-term__b">${esc(t.body)}</span></p>`).join('');
  sec.push(`<section class="p-section">${sectionHead(10, 'Terms and Services')}<div class="p-terms">${terms}</div></section>`);
  const sign = `
    <section class="p-sign">
      <p class="p-sign__intro">To proceed, the client may confirm acceptance in writing. PocketDevs will then issue the reservation invoice and schedule a short scoping call to align on timeline, deliverables, and any final details.</p>
      <div class="p-sign__line"></div>
      <div class="p-sign__name">${esc(pb.name || 'Eric Jeremie Rotaquio')}</div>
      <div class="p-sign__title">${esc(pb.title || 'Chief Executive Officer, PocketDevs')}</div>
    </section>`;
  const footer = `<div class="p-docfooter"><span><b>PocketDevs</b></span><span>Confidential</span><span>www.pocketdevs.ph</span></div>`;

  const art = $('proposal');
  art.innerHTML = cover + sec.join('') + sign + footer;
  art.setAttribute('contenteditable', 'true');
  art.setAttribute('spellcheck', 'false');
  $('downloadBtn').disabled = false;
  $('editorToolbar').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Invoice line items ---------- */
function addLineItemRow(values) {
  const row = document.createElement('div');
  row.className = 'line-item';
  row.innerHTML = `
    <input class="input line-item__desc" placeholder="Description" />
    <div class="line-item__row2">
      <input class="input line-item__qty" type="number" min="0" step="1" value="1" placeholder="Qty" />
      <input class="input line-item__price" type="number" min="0" step="0.01" placeholder="Unit price" />
      <div class="line-item__amount">0.00</div>
      <button type="button" class="line-item__remove" aria-label="Remove item">&times;</button>
    </div>
  `;
  const desc = row.querySelector('.line-item__desc');
  const qty = row.querySelector('.line-item__qty');
  const price = row.querySelector('.line-item__price');
  if (values) {
    desc.value = values.description || '';
    qty.value = values.qty != null ? values.qty : 1;
    price.value = values.unitPrice != null ? values.unitPrice : '';
  }
  const recalc = () => {
    const amount = (Number(qty.value) || 0) * (Number(price.value) || 0);
    row.querySelector('.line-item__amount').textContent = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    updateInvoiceTotal();
  };
  qty.addEventListener('input', recalc);
  price.addEventListener('input', recalc);
  row.querySelector('.line-item__remove').addEventListener('click', () => {
    row.remove();
    updateInvoiceTotal();
  });
  $('invoiceItems').appendChild(row);
  recalc();
}

function updateInvoiceTotal() {
  let total = 0;
  $('invoiceItems').querySelectorAll('.line-item').forEach((row) => {
    const qty = Number(row.querySelector('.line-item__qty').value) || 0;
    const price = Number(row.querySelector('.line-item__price').value) || 0;
    total += qty * price;
  });
  $('invoiceItemsTotal').textContent = `${currencySymbol('f_inv_currency')}${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return total;
}

function collectLineItems() {
  const items = [];
  $('invoiceItems').querySelectorAll('.line-item').forEach((row) => {
    const description = row.querySelector('.line-item__desc').value.trim();
    const qty = Number(row.querySelector('.line-item__qty').value) || 0;
    const unitPrice = Number(row.querySelector('.line-item__price').value) || 0;
    if (!description && !qty && !unitPrice) return;
    items.push({ description, qty, unitPrice, amount: qty * unitPrice });
  });
  return items;
}

/* ---------- Invoice render ---------- */
function renderInvoice(d) {
  if (!d) return;
  const m = d.meta || {}, c = d.client || {}, pb = d.preparedBy || {};
  const prefix = m.currencySymbol || '';

  const cover = `
    <header class="p-cover">
      <div class="p-cover__top">
        <img src="${esc(currentLogo())}" alt="Logo" class="p-cover__logo js-logo" />
        <div class="p-eyebrow">
          <div class="js-doc-no"><b>${esc(m.documentNumber || '[TBD]')}</b></div>
          <div>Invoice date ${esc(m.invoiceDate || '[TBD]')}</div>
          ${m.dueDate ? `<div>Due ${esc(m.dueDate)}</div>` : ''}
        </div>
      </div>
      <span class="p-kicker">Invoice</span>
      <h1 class="p-title">${esc(m.title || 'Invoice')}</h1>
      <div class="p-parties">
        <div class="p-party">
          <div class="p-party__label">Bill to</div>
          <div class="p-party__name">${esc(c.company || '[TBD]')}</div>
          ${c.contactName ? `<div class="p-party__meta">${esc(c.contactName)}</div>` : ''}
          <div class="p-party__meta">TIN: ${esc(c.tin || '[TBD]')}</div>
        </div>
        <div class="p-party">
          <div class="p-party__label">From</div>
          <div class="p-party__name">${esc(pb.company || 'PocketDevs')}</div>
          <div class="p-party__meta">TIN: ${esc(pb.tin || '[TBD]')}</div>
        </div>
      </div>
    </header>`;

  const rows = (d.items || []).map((i) => `<tr>
    <td>${esc(i.description)}</td>
    <td class="num">${esc(i.qty)}</td>
    <td class="num">${formatAmount(i.unitPrice, prefix)}</td>
    <td class="num">${formatAmount(i.amount, prefix)}</td>
  </tr>`).join('');
  const total = (d.items || []).reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const itemsSection = `<section class="p-section">${sectionHead(1, 'Items')}
    <table class="p-table"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows}<tr class="p-table__total"><td colspan="3">Total</td><td class="num">${formatAmount(total, prefix)}</td></tr></tbody></table></section>`;

  const paymentSection = `
    <section class="p-section">
      ${sectionHead(2, 'Payment Details')}
      ${m.paymentDetails ? `<div class="p-lede"><p>${esc(m.paymentDetails)}</p></div>` : '<div class="p-lede"><p>Payment can be made through the following accounts.</p></div>'}
      ${paymentAccounts()}
      ${Array.isArray(d.paymentOptions) && d.paymentOptions.length ? list(d.paymentOptions) : ''}
    </section>`;

  const footer = `<div class="p-docfooter"><span><b>PocketDevs</b></span><span>Confidential</span><span>www.pocketdevs.ph</span></div>`;

  const art = $('proposal');
  art.innerHTML = cover + itemsSection + paymentSection + footer;
  art.setAttribute('contenteditable', 'true');
  art.setAttribute('spellcheck', 'false');
  $('downloadBtn').disabled = false;
  $('editorToolbar').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function generateInvoice() {
  const intake = collectInvoiceIntake();
  const items = collectLineItems();
  if (!intake.client && !items.length) {
    setStatus('error', 'Fill in the client details or add at least one line item.');
    return;
  }

  const total = items.reduce((sum, i) => sum + i.amount, 0);
  const data = {
    docType: 'invoice',
    meta: {
      documentNumber: intake.invoiceNumber || '[TBD]',
      title: intake.invoiceName || `Invoice — ${intake.client || 'Client'}`,
      invoiceDate: intake.invoiceDate,
      dueDate: intake.dueDate,
      currency: intake.currency,
      currencySymbol: intake.currencySymbol,
      locale: intake.locale,
      paymentDetails: intake.paymentDetails,
    },
    client: { company: intake.client, contactName: intake.contact, tin: intake.clientTin || '[TBD]' },
    preparedBy: { company: intake.company, tin: intake.tin || '[TBD]' },
    items,
    total,
  };

  renderInvoice(data);
  setActiveDoc({ id: null, content: data, token: null });

  try {
    const { data: saved, error: saveErr } = await saveProposal(data);
    if (saveErr && saveErr !== 'not-authenticated' && saveErr !== 'offline') {
      console.warn('Could not save invoice to history:', saveErr);
    } else if (!saveErr) {
      setActiveDoc({ id: saved && saved[0] && saved[0].id, content: data, token: null });
      refreshHistory();
    }
  } catch (e) { /* history is optional — ignore */ }

  setStatus('ok', `Invoice generated! Click any text to edit, then <b>Download PDF</b>.`);
}

/* ---------- Rich text editor toolbar ---------- */
(() => {
  const editor = $('proposal');
  const toolbar = $('editorToolbar');
  let savedRange = null;

  function saveSelection() {
    const sel = window.getSelection();
    if (sel.rangeCount && editor.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  }
  function restoreSelection() {
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  editor.addEventListener('mouseup', saveSelection);
  editor.addEventListener('keyup', saveSelection);

  try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* ignore */ }

  toolbar.querySelectorAll('button[data-cmd]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep the current text selection focused
      editor.focus();
      restoreSelection();
      document.execCommand(btn.dataset.cmd, false, null);
      saveSelection();
      updateToolbarState();
    });
  });

  toolbar.querySelectorAll('select[data-cmd]').forEach((sel) => {
    sel.addEventListener('mousedown', saveSelection);
    sel.addEventListener('change', () => {
      editor.focus();
      restoreSelection();
      document.execCommand(sel.dataset.cmd, false, sel.value);
      saveSelection();
      updateToolbarState();
    });
  });

  toolbar.querySelectorAll('input[type="color"][data-cmd]').forEach((inp) => {
    inp.addEventListener('mousedown', saveSelection);
    inp.addEventListener('input', () => {
      editor.focus();
      restoreSelection();
      document.execCommand(inp.dataset.cmd, false, inp.value);
      saveSelection();
      updateToolbarState();
    });
  });

  /* ---- Table editing ---- */
  function selectionNode() {
    let node = savedRange ? savedRange.startContainer : window.getSelection().anchorNode;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    return node && editor.contains(node) ? node : null;
  }
  function currentCell() {
    const node = selectionNode();
    return node ? node.closest('td, th') : null;
  }
  function currentTable() {
    const node = selectionNode();
    return node ? node.closest('table') : null;
  }
  function tableColCount(table) {
    let max = 0;
    for (const row of table.rows) max = Math.max(max, row.cells.length);
    return max || 1;
  }
  function placeCaret(node) {
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    savedRange = range.cloneRange();
  }
  function afterTableChange() {
    saveSelection();
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }

  function buildTable(rows, cols) {
    const table = document.createElement('table');
    table.className = 'p-table';
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    for (let c = 0; c < cols; c++) {
      const th = document.createElement('th');
      th.textContent = `Heading ${c + 1}`;
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    const tbody = document.createElement('tbody');
    for (let r = 0; r < rows; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < cols; c++) {
        const td = document.createElement('td');
        td.innerHTML = '<br>';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(thead);
    table.appendChild(tbody);
    return table;
  }

  function insertTable() {
    const table = buildTable(3, 3);
    const existing = currentTable();
    const node = selectionNode();
    const section = node ? node.closest('.p-section, .p-cover, .p-sign') : null;
    if (existing && existing.parentElement) existing.after(table);   // after the current table
    else if (section) section.appendChild(table);                    // at end of current section
    else editor.appendChild(table);                                  // fallback
    placeCaret(table.querySelector('th, td'));
    afterTableChange();
    showToast('Table inserted — click a cell to edit.');
  }
  function addRow(below) {
    const table = currentTable();
    if (!table) return;
    const tbody = table.tBodies[0] || table;
    const cell = currentCell();
    let refRow = cell ? cell.closest('tr') : null;
    if (refRow && refRow.parentElement.tagName === 'THEAD') refRow = tbody.rows[0] || null;
    const tr = document.createElement('tr');
    for (let c = 0; c < tableColCount(table); c++) {
      const td = document.createElement('td');
      td.innerHTML = '<br>';
      tr.appendChild(td);
    }
    if (refRow && refRow.parentElement === tbody) (below ? refRow.after(tr) : refRow.before(tr));
    else tbody.appendChild(tr);
    placeCaret(tr.cells[0]);
    afterTableChange();
  }
  function addColumn(right) {
    const table = currentTable();
    const cell = currentCell();
    if (!table) return;
    const idx = cell ? cell.cellIndex : (right ? tableColCount(table) - 1 : 0);
    const insertAt = right ? idx + 1 : idx;
    for (const row of table.rows) {
      const isHead = row.parentElement.tagName === 'THEAD';
      const el = document.createElement(isHead ? 'th' : 'td');
      if (isHead) el.textContent = 'Heading'; else el.innerHTML = '<br>';
      const ref = row.cells[insertAt] || null;
      if (ref) row.insertBefore(el, ref); else row.appendChild(el);
    }
    afterTableChange();
  }
  function deleteRow() {
    const cell = currentCell();
    const table = currentTable();
    if (!cell || !table) return;
    if (table.rows.length <= 1) { deleteTable(); return; }
    cell.closest('tr').remove();
    afterTableChange();
  }
  function deleteColumn() {
    const table = currentTable();
    const cell = currentCell();
    if (!table || !cell) return;
    if (tableColCount(table) <= 1) { deleteTable(); return; }
    const idx = cell.cellIndex;
    for (const row of Array.from(table.rows)) {
      if (row.cells[idx]) row.deleteCell(idx);
    }
    afterTableChange();
  }
  function deleteTable() {
    const table = currentTable();
    if (!table) return;
    table.remove();
    afterTableChange();
  }

  const tableMenuBtn = $('tableMenuBtn');
  const tableMenu = $('tableMenu');
  function closeTableMenu() {
    if (!tableMenu) return;
    tableMenu.hidden = true;
    tableMenuBtn.setAttribute('aria-expanded', 'false');
  }
  function refreshTableMenuState() {
    const inTable = !!currentTable();
    tableMenu.querySelectorAll('button[data-table]').forEach((b) => {
      b.disabled = b.dataset.table !== 'insert' && !inTable;
    });
  }
  if (tableMenuBtn && tableMenu) {
    tableMenuBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      saveSelection();
      if (tableMenu.hidden) { refreshTableMenuState(); tableMenu.hidden = false; tableMenuBtn.setAttribute('aria-expanded', 'true'); }
      else closeTableMenu();
    });
    const TABLE_ACTIONS = {
      'insert': insertTable,
      'row-above': () => addRow(false),
      'row-below': () => addRow(true),
      'col-left': () => addColumn(false),
      'col-right': () => addColumn(true),
      'del-row': deleteRow,
      'del-col': deleteColumn,
      'del-table': deleteTable,
    };
    tableMenu.querySelectorAll('button[data-table]').forEach((b) => {
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (b.disabled) return;
        editor.focus();
        restoreSelection();
        const fn = TABLE_ACTIONS[b.dataset.table];
        if (fn) fn();
        closeTableMenu();
      });
    });
    document.addEventListener('mousedown', (e) => {
      if (tableMenu.hidden) return;
      if (!tableMenu.contains(e.target) && !tableMenuBtn.contains(e.target)) closeTableMenu();
    });
  }

  /* ---- Reflect the formatting under the cursor/selection in the toolbar ---- */
  const VALID_BLOCKS = ['P', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE'];
  const TOGGLE_CMDS = ['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight', 'insertUnorderedList', 'insertOrderedList'];

  function rgbToHex(rgb) {
    const m = String(rgb || '').match(/\d+/g);
    if (!m || m.length < 3) return null;
    return '#' + m.slice(0, 3).map((n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0')).join('');
  }

  function updateToolbarState() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return;

    // Heading / block format
    const blockSelect = toolbar.querySelector('select[data-cmd="formatBlock"]');
    let blockTag = '';
    try { blockTag = document.queryCommandValue('formatBlock').toUpperCase(); } catch (e) { /* ignore */ }
    blockSelect.value = VALID_BLOCKS.includes(blockTag) ? blockTag : 'P';

    // Font family
    const fontSelect = toolbar.querySelector('select[data-cmd="fontName"]');
    let fontName = '';
    try { fontName = document.queryCommandValue('fontName').replace(/['"]/g, ''); } catch (e) { /* ignore */ }
    const match = Array.from(fontSelect.options).find((o) => o.value.replace(/['"]/g, '').toLowerCase() === fontName.toLowerCase());
    if (match) fontSelect.value = match.value;

    // Font size (legacy 1-7 scale)
    const sizeSelect = toolbar.querySelector('select[data-cmd="fontSize"]');
    let fontSize = '';
    try { fontSize = document.queryCommandValue('fontSize'); } catch (e) { /* ignore */ }
    if (['1', '2', '3', '4', '5', '6', '7'].includes(fontSize)) sizeSelect.value = fontSize;

    // Toggle buttons: bold, italic, underline, strikethrough, alignment, lists
    TOGGLE_CMDS.forEach((cmd) => {
      const btn = toolbar.querySelector(`button[data-cmd="${cmd}"]`);
      let active = false;
      try { active = document.queryCommandState(cmd); } catch (e) { /* ignore */ }
      if (btn) btn.classList.toggle('is-active', active);
    });

    // Text color
    let foreColor = '';
    try { foreColor = document.queryCommandValue('foreColor'); } catch (e) { /* ignore */ }
    const foreHex = rgbToHex(foreColor);
    if (foreHex) toolbar.querySelector('input[data-cmd="foreColor"]').value = foreHex;

    // Highlight color: walk up from the cursor to find a non-transparent background
    let node = sel.anchorNode;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    let bg = '';
    while (node && node !== editor.parentElement) {
      const bgColor = getComputedStyle(node).backgroundColor;
      if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') { bg = bgColor; break; }
      node = node.parentElement;
    }
    const hlHex = rgbToHex(bg);
    if (hlHex) toolbar.querySelector('input[data-cmd="hiliteColor"]').value = hlHex;
  }

  editor.addEventListener('mouseup', updateToolbarState);
  editor.addEventListener('keyup', updateToolbarState);
  editor.addEventListener('focus', updateToolbarState);
})();

/* ---------- Settings Modal ---------- */
const LS_AVATAR = 'pdv_avatar';

function showSettingsModal() {
  populateSettings();
  $('settingsModal').classList.add('modal--visible');
}
function hideSettingsModal() {
  $('settingsModal').classList.remove('modal--visible');
}

function openSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach((btn) => {
    btn.classList.toggle('settings-tab--active', btn.dataset.tab === tab);
  });
  ['Profile', 'Security', 'Branding'].forEach((name) => {
    const el = $(`settingsTab${name}`);
    if (el) el.hidden = name.toLowerCase() !== tab;
  });
}

async function populateSettings() {
  openSettingsTab('profile');
  const session = await getSession();

  // Profile tab
  const profileGate = $('settingsProfileGate');
  const profileForm = $('settingsProfileForm');
  if (!session) {
    profileGate.hidden = false;
    profileForm.hidden = true;
  } else {
    profileGate.hidden = true;
    profileForm.hidden = false;
    const meta = session.user.user_metadata || {};
    $('settingsName').value = meta.full_name || '';
    $('settingsEmail').value = session.user.email || '';
    applySettingsAvatar();
  }

  // Security tab
  const secGate = $('settingsSecurityGate');
  const secForm = $('settingsSecurityForm');
  if (!session) {
    secGate.hidden = false;
    secForm.hidden = true;
  } else {
    secGate.hidden = true;
    secForm.hidden = false;
  }

  // Clear status banners
  ['settingsProfileStatus', 'settingsEmailStatus', 'settingsSecurityStatus'].forEach((id) => {
    const el = $(id);
    el.hidden = true;
    el.textContent = '';
    el.className = 'status';
  });
  $('settingsNewPassword').value = '';
  $('settingsConfirmPassword').value = '';
}

function applySettingsAvatar() {
  const src = localStorage.getItem(LS_AVATAR);
  const img = $('settingsAvatarImg');
  const initials = $('settingsAvatarInitials');
  const removeBtn = $('settingsAvatarRemoveBtn');
  if (src) {
    img.src = src;
    img.hidden = false;
    initials.hidden = true;
    removeBtn.hidden = false;
  } else {
    img.hidden = true;
    initials.hidden = false;
    removeBtn.hidden = true;
    const session_cached = $('settingsName').value.trim() || '?';
    initials.textContent = session_cached.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  }
  applySidebarAvatar();
}

function applySidebarAvatar() {
  const src = localStorage.getItem(LS_AVATAR);
  const el = document.getElementById('sidebarAvatar');
  if (!el) return;
  if (src) {
    el.innerHTML = `<img src="${src}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
  } else {
    // Restore initials (already set by nav.js; only overwrite if we previously injected an img)
    if (el.querySelector('img')) {
      const name = $('settingsName')?.value.trim() || '';
      el.textContent = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'U';
    }
  }
}

function setSettingsStatus(id, type, msg) {
  const el = $(id);
  el.className = `status status--${type}`;
  el.textContent = msg;
  el.hidden = false;
}

async function handleAvatarUpload(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { setSettingsStatus('settingsProfileStatus', 'error', 'Photo must be under 2 MB.'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    localStorage.setItem(LS_AVATAR, String(reader.result));
    applySettingsAvatar();
  };
  reader.readAsDataURL(file);
}

async function handleSaveProfile() {
  const btn = $('saveProfileBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const fullName = $('settingsName').value.trim();
  const { error } = await updateUserProfile({ fullName });
  btn.disabled = false;
  btn.textContent = 'Save profile';
  if (error) {
    setSettingsStatus('settingsProfileStatus', 'error', error.message || 'Could not save profile.');
  } else {
    setSettingsStatus('settingsProfileStatus', 'ok', 'Profile saved.');
    // Refresh sidebar name/initials
    const sidebarName = document.getElementById('sidebarUserName');
    if (sidebarName) sidebarName.textContent = fullName;
    applySettingsAvatar();
  }
}

async function handleSaveEmail() {
  const btn = $('saveEmailBtn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  const newEmail = $('settingsEmail').value.trim();
  if (!newEmail) { setSettingsStatus('settingsEmailStatus', 'error', 'Enter a valid email address.'); btn.disabled = false; btn.textContent = 'Update email'; return; }
  const { error } = await updateUserEmail(newEmail);
  btn.disabled = false;
  btn.textContent = 'Update email';
  if (error) {
    setSettingsStatus('settingsEmailStatus', 'error', error.message || 'Could not update email.');
  } else {
    setSettingsStatus('settingsEmailStatus', 'ok', 'Confirmation email sent — check your inbox to verify the new address.');
  }
}

async function handleSavePassword() {
  const btn = $('savePasswordBtn');
  const newPw = $('settingsNewPassword').value;
  const confirmPw = $('settingsConfirmPassword').value;
  if (newPw.length < 6) { setSettingsStatus('settingsSecurityStatus', 'error', 'Password must be at least 6 characters.'); return; }
  if (newPw !== confirmPw) { setSettingsStatus('settingsSecurityStatus', 'error', 'Passwords do not match.'); return; }
  btn.disabled = true;
  btn.textContent = 'Updating…';
  const { error } = await updateUserPassword(newPw);
  btn.disabled = false;
  btn.textContent = 'Update password';
  if (error) {
    setSettingsStatus('settingsSecurityStatus', 'error', error.message || 'Could not update password.');
  } else {
    setSettingsStatus('settingsSecurityStatus', 'ok', 'Password updated successfully.');
    $('settingsNewPassword').value = '';
    $('settingsConfirmPassword').value = '';
  }
}

/* ============================================================
   Live Sharing / Collaboration
   A doc can be shared via an unguessable token link. The owner and any
   link-holder edit the same contenteditable; edits broadcast over a
   Supabase Realtime channel (live) and persist last-write-wins. The guest
   path needs no account — RPCs in supabase.js gate access by the token.
   ============================================================ */
const collab = {
  id: null,        // proposals.id of the doc currently on screen
  token: null,     // share_token (set when shared or opened via link)
  content: null,   // structured content object (carries .collabHtml)
  channel: null,   // realtime channel handle from createDocChannel
  isShared: false, // owner has sharing turned on
  isGuest: false,  // opened via ?share= link
  applyingRemote: false,
  lastEditAt: 0,
  pendingRemoteHtml: null,
  me: null,
  participants: [],
  remoteCursors: {},
};
const COLLAB_BROADCAST_MS = 250;
const COLLAB_PERSIST_MS = 1500;
const COLLAB_IDLE_MS = 1200; // don't overwrite the doc while the user is typing

// Friendly identities for the presence avatars (Google-Docs style).
const COLLAB_ANIMALS = ['Lion', 'Tiger', 'Otter', 'Panda', 'Koala', 'Falcon', 'Dolphin', 'Fox', 'Owl', 'Whale', 'Bison', 'Heron', 'Lynx', 'Crane'];
const COLLAB_COLORS = ['#f2384a', '#0ea5e9', '#16a34a', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1', '#ef4444', '#0891b2'];
function colorFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLLAB_COLORS[h % COLLAB_COLORS.length];
}
function initialsFor(name) {
  return (name || '?').trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
}

// Build this client's identity once: real name for the owner, a stable
// "Anonymous Animal" for link guests, each with a consistent colour.
async function ensureIdentity() {
  if (collab.me) return collab.me;
  const id = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
  let name, role;
  if (collab.isGuest) {
    role = 'guest';
    name = 'Anonymous ' + COLLAB_ANIMALS[Math.floor(Math.random() * COLLAB_ANIMALS.length)];
  } else {
    role = 'owner';
    const session = await getSession();
    const meta = (session && session.user && session.user.user_metadata) || {};
    name = meta.full_name || (session && session.user && session.user.email) || 'You';
  }
  collab.me = { id, name, role, color: colorFor(id) };
  return collab.me;
}

function shareUrl(token) {
  return `${window.location.origin}${window.location.pathname}?share=${token}`;
}

// Remember the doc now on screen so it can be shared / synced.
function setActiveDoc({ id, content, token }) {
  collab.id = id || null;
  collab.content = content || null;
  collab.token = token || null;
  collab.isShared = !!token;
  updateShareButton();
}

function updateShareButton() {
  const btn = $('shareBtn');
  if (!btn) return;
  if (collab.isGuest) { btn.hidden = true; return; }
  btn.hidden = !collab.id;
  btn.classList.toggle('btn--shared', collab.isShared);
  const label = $('shareBtnLabel');
  if (label) label.textContent = collab.isShared ? 'Sharing' : 'Share';
}

/* ----- Edit capture & sync ----- */
function getDocHtml() { return $('proposal').innerHTML; }

let _bcTimer = null, _persistTimer = null;
function onLocalEdit() {
  if (collab.applyingRemote) return;
  collab.lastEditAt = Date.now();
  if (collab.content) collab.content.collabHtml = getDocHtml();
  if (collab.channel) {
    clearTimeout(_bcTimer);
    _bcTimer = setTimeout(() => collab.channel && collab.channel.broadcast(getDocHtml()), COLLAB_BROADCAST_MS);
  }
  if (collab.isShared || collab.isGuest) {
    clearTimeout(_persistTimer);
    _persistTimer = setTimeout(persistDoc, COLLAB_PERSIST_MS);
  }
  // My caret moved as I typed, and remote carets after it shifted — sync both.
  broadcastCursor();
  scheduleCursorRender();
}

async function persistDoc() {
  if (!collab.content) return;
  collab.content.collabHtml = getDocHtml();
  try {
    if (collab.isGuest && collab.token) {
      await saveSharedDoc(collab.token, collab.content);
    } else if (collab.isShared && collab.id) {
      await saveProposal(collab.content);
    }
  } catch { /* best effort */ }
}

let _editListenerAttached = false;
function attachEditListener() {
  if (_editListenerAttached) return;
  $('proposal').addEventListener('input', onLocalEdit);
  _editListenerAttached = true;
}

/* ----- Apply remote edits (idle-guarded, caret-preserving) ----- */
function applyRemoteHtml(html) {
  if (html == null) return;
  const el = $('proposal');
  if (el.innerHTML === html) return;
  const idle = Date.now() - collab.lastEditAt > COLLAB_IDLE_MS;
  const focused = el === document.activeElement || el.contains(document.activeElement);
  if (focused && !idle) { collab.pendingRemoteHtml = html; scheduleIdleApply(); return; }
  doApplyRemote(html);
}
let _idleTimer = null;
function scheduleIdleApply() {
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => {
    const html = collab.pendingRemoteHtml;
    collab.pendingRemoteHtml = null;
    if (html != null && $('proposal').innerHTML !== html) doApplyRemote(html);
  }, COLLAB_IDLE_MS);
}
function doApplyRemote(html) {
  const el = $('proposal');
  const offset = saveCaretOffset(el);
  collab.applyingRemote = true;
  el.innerHTML = html;
  if (collab.content) collab.content.collabHtml = html;
  collab.applyingRemote = false;
  if (offset != null) restoreCaretOffset(el, offset);
  scheduleCursorRender(); // the document changed — reposition remote carets
}
function saveCaretOffset(root) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}
function restoreCaretOffset(root, offset) {
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let remaining = offset, node = walker.nextNode();
    while (node) {
      const len = node.textContent.length;
      if (remaining <= len) {
        const range = document.createRange();
        range.setStart(node, remaining); range.collapse(true);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        return;
      }
      remaining -= len; node = walker.nextNode();
    }
  } catch { /* leave caret as-is */ }
}

/* ----- Channel lifecycle & presence ----- */
async function joinCollab() {
  if (!collab.token || collab.channel) return;
  attachEditListener();
  attachCursorTracking();
  const me = await ensureIdentity();
  collab.channel = await createDocChannel(collab.token, me, {
    onEdit: (html) => applyRemoteHtml(html),
    onCursor: (payload) => onRemoteCursor(payload),
    onPresence: (people) => updatePresence(people),
  });
}
function leaveCollab() {
  if (collab.channel) { collab.channel.leave(); collab.channel = null; }
  collab.participants = [];
  collab.remoteCursors = {};
  renderAvatars($('collabAvatars'), []);
  renderRemoteCursors();
}

// Presence → de-duplicated participant list → avatar stacks + count text.
function updatePresence(people) {
  const seen = new Set();
  collab.participants = (people || []).filter((p) => {
    if (!p || !p.id || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  // Drop cursors for anyone who's no longer present.
  const presentIds = new Set(collab.participants.map((p) => p.id));
  Object.keys(collab.remoteCursors).forEach((uid) => {
    if (!presentIds.has(uid)) delete collab.remoteCursors[uid];
  });
  renderAvatars($('collabAvatars'), collab.participants);
  renderAvatars($('shareAvatars'), collab.participants);
  renderRemoteCursors();
  const n = collab.participants.length || 1;
  const a = $('collabPresence');
  if (a) a.textContent = n <= 1 ? 'Just you so far' : `${n} people here now`;
  const b = $('collabBannerPresence');
  if (b) b.textContent = n <= 1 ? '' : `${n} editing`;
}

// Render an overlapping stack of avatar circles (Google-Docs style).
function renderAvatars(el, people) {
  if (!el) return;
  if (!people || !people.length) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  const MAX = 4;
  const shown = people.slice(0, MAX);
  const extra = people.length - shown.length;
  const myId = collab.me && collab.me.id;
  el.innerHTML = shown.map((p) => {
    const you = p.id === myId;
    const cls = 'collab-avatar' + (you ? ' collab-avatar--you' : ' collab-avatar--clickable');
    const cursor = collab.remoteCursors[p.id];
    const section = cursor && cursor.section ? ` on ${cursor.section}` : '';
    const title = you ? esc(p.name || 'Guest') + ' (you)' : `Jump to where ${esc(p.name || 'Guest')} is editing${section}`;
    return `<span class="${cls}" data-uid="${esc(p.id)}" style="background:${esc(p.color || '#888')}" title="${title}">${esc(initialsFor(p.name))}</span>`;
  }).join('') + (extra > 0 ? `<span class="collab-avatar collab-avatar--more" title="${extra} more">+${extra}</span>` : '');
}

/* ----- Live cursor presence (Google-Docs style) -----
   Each client broadcasts its caret/selection as absolute text offsets within
   #proposal. Others render a coloured caret + name flag (and a selection
   highlight) over the document, and can click an avatar to jump there. The
   overlay lives in .paper-wrap as a sibling of #proposal, so it is never part
   of the synced/persisted document HTML. */
const COLLAB_CURSOR_THROTTLE = 120;
const COLLAB_CURSOR_STALE_MS = 20000;

function selectionOffsets(root) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { start, end: start + range.toString().length };
}
function resolveOffset(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let remaining = offset, node = walker.nextNode(), last = null;
  while (node) {
    last = node;
    const len = node.textContent.length;
    if (remaining <= len) return { node, offset: remaining };
    remaining -= len; node = walker.nextNode();
  }
  return last ? { node: last, offset: last.textContent.length } : null;
}
function nearestSectionLabel(node) {
  let el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const sec = el && el.closest ? el.closest('.p-section, .p-cover, .p-sign') : null;
  if (!sec) return '';
  const head = sec.querySelector('.p-section__title, .p-cover .p-title, h1, h2, h3');
  const t = (head && head.textContent) || sec.textContent || '';
  return t.trim().replace(/\s+/g, ' ');
}

function normalizeSectionLabel(label) {
  return String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function findSectionElementByLabel(label) {
  const want = normalizeSectionLabel(label);
  if (!want) return null;
  const sections = Array.from(document.querySelectorAll('#proposal .p-section, #proposal .p-cover, #proposal .p-sign'));
  for (const sec of sections) {
    const head = sec.querySelector('.p-section__title, .p-cover .p-title, h1, h2, h3');
    const text = normalizeSectionLabel((head && head.textContent) || sec.textContent || '');
    if (text === want || text.startsWith(want) || want.startsWith(text)) return sec;
  }
  return null;
}

let _cursorThrottleAt = 0, _cursorPending = null;
function broadcastCursor() {
  if (!collab.channel || collab.applyingRemote) return;
  const off = selectionOffsets($('proposal'));
  if (!off) return;
  const payload = { start: off.start, end: off.end, section: nearestSectionLabel(resolveOffset($('proposal'), off.start) && resolveOffset($('proposal'), off.start).node) };
  const send = () => { _cursorThrottleAt = Date.now(); if (collab.channel) collab.channel.sendCursor(payload); };
  if (Date.now() - _cursorThrottleAt >= COLLAB_CURSOR_THROTTLE) send();
  else { clearTimeout(_cursorPending); _cursorPending = setTimeout(send, COLLAB_CURSOR_THROTTLE); }
}

function onRemoteCursor(p) {
  if (!p || !p.from) return;
  collab.remoteCursors[p.from] = {
    start: p.start || 0, end: p.end || 0, section: p.section || '',
    name: p.name || 'Guest', color: p.color || '#888', at: Date.now(),
  };
  scheduleCursorRender();
}

function ensureCursorOverlay() {
  let overlay = document.getElementById('collabCursors');
  if (!overlay) {
    const wrap = document.querySelector('.paper-wrap');
    if (!wrap) return null;
    overlay = document.createElement('div');
    overlay.id = 'collabCursors';
    overlay.className = 'collab-cursors no-print';
    wrap.appendChild(overlay);
  }
  return overlay;
}
let _cursorRaf = 0;
function scheduleCursorRender() {
  cancelAnimationFrame(_cursorRaf);
  _cursorRaf = requestAnimationFrame(renderRemoteCursors);
}
function renderRemoteCursors() {
  const overlay = ensureCursorOverlay();
  if (!overlay) return;
  const editor = $('proposal');
  const wrapRect = overlay.parentElement.getBoundingClientRect();
  const now = Date.now();
  let html = '';
  Object.keys(collab.remoteCursors).forEach((uid) => {
    const c = collab.remoteCursors[uid];
    if (now - c.at > COLLAB_CURSOR_STALE_MS) { delete collab.remoteCursors[uid]; return; }
    const startPos = resolveOffset(editor, c.start);
    if (!startPos) return;
    // Selection highlight (when they have text selected)
    if (c.end > c.start) {
      const endPos = resolveOffset(editor, c.end);
      if (endPos) {
        try {
          const r = document.createRange();
          r.setStart(startPos.node, startPos.offset);
          r.setEnd(endPos.node, endPos.offset);
          for (const rect of r.getClientRects()) {
            html += `<div class="collab-sel" style="left:${rect.left - wrapRect.left}px;top:${rect.top - wrapRect.top}px;width:${rect.width}px;height:${rect.height}px;background:${esc(c.color)}"></div>`;
          }
        } catch { /* ignore */ }
      }
    }
    // Caret bar + name flag at the selection start
    const cr = document.createRange();
    cr.setStart(startPos.node, startPos.offset); cr.collapse(true);
    const rects = cr.getClientRects();
    const rect = rects.length ? rects[0] : (startPos.node.parentElement && startPos.node.parentElement.getBoundingClientRect());
    if (!rect) return;
    html += `<div class="collab-caret" data-uid="${esc(uid)}" style="left:${rect.left - wrapRect.left}px;top:${rect.top - wrapRect.top}px;height:${rect.height || 16}px;background:${esc(c.color)}">`
      + `<span class="collab-caret__flag" style="background:${esc(c.color)}">${esc(c.name)}</span></div>`;
  });
  overlay.innerHTML = html;
}

function jumpToUser(uid) {
  const c = collab.remoteCursors[uid];
  if (!c) { showToast("They haven't placed their cursor in the document yet."); return; }
  const section = findSectionElementByLabel(c.section);
  const pos = resolveOffset($('proposal'), c.start);
  const target = section || (pos && (pos.node.nodeType === Node.TEXT_NODE ? pos.node.parentElement : pos.node));
  if (!target) return;
  if (target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (section) {
    section.classList.add('collab-section-target');
    setTimeout(() => section.classList.remove('collab-section-target'), 1800);
  }
  setTimeout(() => {
    renderRemoteCursors();
    const caret = document.querySelector(`#collabCursors .collab-caret[data-uid="${uid}"]`);
    if (caret) { caret.classList.add('collab-caret--flash'); setTimeout(() => caret.classList.remove('collab-caret--flash'), 1700); }
  }, 350);
}

let _cursorTrackingAttached = false;
function attachCursorTracking() {
  if (_cursorTrackingAttached) return;
  _cursorTrackingAttached = true;
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && $('proposal').contains(sel.anchorNode)) broadcastCursor();
  });
  window.addEventListener('resize', scheduleCursorRender);
}

/* ----- Owner: share button + modal ----- */
async function handleShareClick() {
  if (!collab.id) { setStatus('error', 'Generate or open a document first, then share it.'); return; }
  const session = await getSession();
  if (!session) { showAuthModal(); return; }
  if (!collab.isShared) {
    setStatus('working', '<span class="spinner"></span> Enabling sharing…');
    const { token, error } = await enableShare(collab.id);
    if (error) { setStatus('error', `Could not enable sharing: ${esc(error.message || String(error))}`); return; }
    collab.token = token;
    collab.isShared = true;
    setStatus('', '');
    await persistDoc();
    await joinCollab();
    updateShareButton();
  }
  openShareModal();
}
function openShareModal() {
  $('shareLinkInput').value = shareUrl(collab.token);
  const people = (collab.participants && collab.participants.length)
    ? collab.participants
    : (collab.me ? [collab.me] : []);
  renderAvatars($('shareAvatars'), people);
  $('shareModal').classList.add('modal--visible');
  $('shareLinkInput').select();
}
function closeShareModal() { $('shareModal').classList.remove('modal--visible'); }
async function handleStopSharing() {
  if (!collab.id) return;
  if (!confirm('Stop sharing this document? The link will immediately stop working for everyone.')) return;
  const { error } = await disableShare(collab.id);
  if (error) { alert('Could not stop sharing: ' + (error.message || error)); return; }
  collab.isShared = false; collab.token = null;
  leaveCollab();
  updateShareButton();
  closeShareModal();
  setStatus('ok', 'Sharing stopped — the link no longer works.');
}

/* ----- Guest: open a shared doc via ?share= link ----- */
async function enterGuestMode(token) {
  collab.isGuest = true;
  document.body.classList.add('collab-guest');
  $('collabBanner').hidden = false;
  setStatus('working', '<span class="spinner"></span> Opening shared document…');
  const { doc, error } = await getSharedDoc(token);
  if (error || !doc) {
    const gone = error && error.message === 'not-found';
    $('collabBanner').hidden = true;
    $('proposal').innerHTML = `<div class="collab-error"><h2>${gone ? 'This link is no longer active' : 'Could not open this document'}</h2><p>${gone ? 'The owner may have stopped sharing it.' : 'Please check the link or ask the owner to re-share.'}</p></div>`;
    setStatus('', '');
    return;
  }
  collab.id = doc.id;
  collab.token = token;
  collab.content = doc.content || {};
  openDocument(collab.content);
  setStatus('', '');
  attachEditListener();
  await joinCollab();
}

/* ---------- Auth Modal ---------- */
function showAuthModal() {
  setAuthMode('login');
  $('authModal').classList.add('modal--visible');
}
function hideAuthModal() {
  $('authModal').classList.remove('modal--visible');
}

let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  const isSignUp = mode === 'signup';
  $('authTitle').textContent = isSignUp ? 'Create your PocketDevs account' : 'Sign in to PocketDevs';
  $('authSubmit').textContent = isSignUp ? 'Sign Up' : 'Login';
  $('authTabLogin').classList.toggle('btn--primary', !isSignUp);
  $('authTabLogin').classList.toggle('btn--ghost', isSignUp);
  $('authTabLogin').setAttribute('aria-pressed', String(!isSignUp));
  $('authTabSignup').classList.toggle('btn--primary', isSignUp);
  $('authTabSignup').classList.toggle('btn--ghost', !isSignUp);
  $('authTabSignup').setAttribute('aria-pressed', String(isSignUp));
  $('authNameField').hidden = !isSignUp;
  $('authName').required = isSignUp;
}

async function handleAuth(e) {
  e.preventDefault();
  const name = $('authName').value.trim();
  const email = $('authEmail').value;
  const password = $('authPassword').value;
  const isSignUp = authMode === 'signup';
  const errEl = $('authError');

  errEl.hidden = true;
  errEl.className = 'status status--error';
  $('authSubmit').disabled = true;

  try {
    const { data, error } = isSignUp
      ? await signUp(email, password, name)
      : await signIn(email, password);

    if (error) {
      errEl.textContent = error.message || String(error);
      errEl.hidden = false;
    } else {
      const signedIn = !isSignUp || (data && data.session);
      if (!signedIn) {
        errEl.textContent = 'Check your email to confirm sign up!';
        errEl.className = 'status status--ok';
        errEl.hidden = false;
      } else {
        hideAuthModal();
        updateAuthState();
      }
    }
  } catch (err) {
    errEl.textContent = 'Authentication failed unexpectedly. Please try again.';
    errEl.hidden = false;
  } finally {
    $('authSubmit').disabled = false;
  }
}

function greetingPhrase() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
async function updateAuthState() {
  try {
    const session = await getSession();
    const navBtn = $('authNavBtn');
    const greeting = $('authGreeting');
    if (session) {
      const fullName = (session.user.user_metadata && session.user.user_metadata.full_name) || '';
      const displayName = fullName.trim() || session.user.email.split('@')[0];
      const firstName = displayName.trim().split(/\s+/)[0];

      navBtn.hidden = true;
      greeting.hidden = false;
      greeting.textContent = `${greetingPhrase()}, ${firstName}!`;

      $('openDashboardBtn').hidden = false;

      refreshHistory();

      // Auto-open a document when navigated from dashboard (?open=ID)
      const openId = new URLSearchParams(window.location.search).get('open');
      if (openId) {
        try {
          const proposal = await fetchProposalById(openId);
          if (proposal && proposal.content) await loadOwnedDoc(proposal);
        } catch { /* non-blocking */ }
        const url = new URL(window.location.href);
        url.searchParams.delete('open');
        window.history.replaceState({}, '', url.toString());
      }
    } else {
      navBtn.hidden = false;
      navBtn.textContent = 'Login';
      navBtn.onclick = showAuthModal;
      greeting.hidden = true;
      $('historyList').innerHTML = '<p class="card__hint">Login to see your history.</p>';
      $('openDashboardBtn').hidden = true;
      hideDashboardModal();
    }
  } catch (err) {
    console.error('Auth state update failed:', err);
  }
}

/* ---------- Document dispatch ---------- */
function openDocument(content) {
  if (!content) return;
  if (content.docType === 'invoice') {
    setMode('invoice');
    renderInvoice(content);
  } else {
    setMode('proposal');
    render(content);
  }
  // Restore any inline collaborative edits over the freshly rendered structure.
  if (content.collabHtml) $('proposal').innerHTML = content.collabHtml;
}

/* Open a doc the signed-in user owns (from history / dashboard / ?open=),
   wiring up live sync if it's already being shared. */
async function loadOwnedDoc(row) {
  if (!row || !row.content) return;
  openDocument(row.content);
  setActiveDoc({ id: row.id, content: row.content, token: row.share_token });
  if (row.share_token) await joinCollab();
}

/* ---------- History ---------- */
function historyItemHtml(p) {
  return `
    <div class="history-item" data-id="${p.id}">
      <div class="history-item__body">
        <div class="history-item__title">${esc(p.project_title || 'Untitled')}</div>
        <div class="history-item__meta">${esc(p.client_name || '')} · ${esc(p.doc_number || '')}</div>
      </div>
      <button type="button" class="history-item__delete" title="Delete proposal" aria-label="Delete proposal">&times;</button>
    </div>
  `;
}
function historyGroupHtml(label, items) {
  if (!items.length) return '';
  return `<div class="history-group">
    <div class="history-group__label">${label}</div>
    ${items.map(historyItemHtml).join('')}
  </div>`;
}

async function refreshHistory() {
  const list = $('historyList');
  try {
    const items = await fetchUserProposals();
    if (!items || !items.length) {
      list.innerHTML = '<p class="card__hint">No proposals saved yet.</p>';
      return;
    }
    const proposals = items.filter((p) => !(p.content && p.content.docType === 'invoice'));
    const invoices = items.filter((p) => p.content && p.content.docType === 'invoice');
    list.innerHTML = historyGroupHtml('Proposals', proposals) + historyGroupHtml('Invoices', invoices);

    list.querySelectorAll('.history-item').forEach(el => {
      el.querySelector('.history-item__body').onclick = () => {
        const p = items.find(i => i.id === el.dataset.id);
        if (p && p.content) loadOwnedDoc(p);
      };
      el.querySelector('.history-item__delete').onclick = async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this saved proposal? This cannot be undone.')) return;
        const { error } = await deleteProposal(el.dataset.id);
        if (error) { alert('Could not delete proposal: ' + (error.message || error)); return; }
        refreshHistory();
      };
    });
  } catch (err) {
    list.innerHTML = '<p class="card__hint">History temporarily unavailable.</p>';
  }
}

/* ---------- Dashboard ---------- */
let dashboardProposals = [];
let dashboardQuestionnaires = [];
let dashboardTypeFilter = 'all';

function getDashboardDocType(item) {
  if (item._type === 'questionnaire') return 'questionnaire';
  if (item.content && item.content.docType === 'invoice') return 'invoice';
  return 'proposal';
}

function mergeDashboardItems() {
  const proposals = dashboardProposals.map(p => ({ ...p, _type: p.content?.docType === 'invoice' ? 'invoice' : 'proposal' }));
  const questionnaires = dashboardQuestionnaires.map(q => ({ ...q, _type: 'questionnaire' }));
  return [...proposals, ...questionnaires].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

function showDashboardModal() {
  $('dashboardModal').classList.add('modal--visible');
  $('dashboardSearch').value = '';
  setDashboardTypeFilter('all');
  refreshDashboard();
  $('dashboardSearch').focus();
}
function setDashboardTypeFilter(type) {
  dashboardTypeFilter = type;
  document.querySelectorAll('.dashboard__tab').forEach((tab) => {
    tab.classList.toggle('dashboard__tab--active', tab.dataset.type === type);
  });
  filterDashboard($('dashboardSearch').value);
}
function hideDashboardModal() {
  $('dashboardModal').classList.remove('modal--visible');
}

async function refreshDashboard() {
  const grid = $('dashboardGrid');
  grid.innerHTML = '<p class="dashboard__empty">Loading…</p>';
  try {
    [dashboardProposals, dashboardQuestionnaires] = await Promise.all([
      fetchUserProposals(),
      fetchUserQuestionnaires(),
    ]);
    renderDashboardGrid(mergeDashboardItems());
  } catch (err) {
    grid.innerHTML = '<p class="dashboard__empty">Documents temporarily unavailable.</p>';
  }
}

const DASH_TYPE_LABELS = { proposal: 'Proposal', invoice: 'Invoice', questionnaire: 'Questionnaire' };

function renderDashboardGrid(items) {
  const grid = $('dashboardGrid');
  if (!items.length) {
    grid.innerHTML = '<p class="dashboard__empty">No documents found.</p>';
    return;
  }
  grid.innerHTML = items.map((item) => {
    const type = getDashboardDocType(item);
    const title = esc(item.project_title || item.project_name || 'Untitled');
    const client = esc(item.client_name || '');
    const docNo = esc(item.doc_number || '');
    const updated = item.updated_at ? new Date(item.updated_at).toLocaleDateString(getLocale(), { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    const meta = [client, docNo].filter(Boolean).join(' · ');
    return `
      <div class="doc-card" data-id="${item.id}" data-type="${type}">
        <button type="button" class="doc-card__delete" title="Delete document" aria-label="Delete document">&times;</button>
        <div class="doc-card__type doc-card__type--${type}">${DASH_TYPE_LABELS[type]}</div>
        <div class="doc-card__thumb">
          <img src="assets/logo.svg" class="js-logo" />
          <div class="doc-card__thumb-title">${title}</div>
        </div>
        <div class="doc-card__body">
          <div class="doc-card__title" title="${title}">${title}</div>
          ${meta ? `<div class="doc-card__meta">${meta}</div>` : ''}
          <div class="doc-card__meta">${updated}</div>
        </div>
      </div>
    `;
  }).join('');

  const allItems = mergeDashboardItems();
  grid.querySelectorAll('.doc-card').forEach((el) => {
    const id = el.dataset.id;
    const type = el.dataset.type;
    el.addEventListener('click', () => {
      if (type === 'questionnaire') {
        hideDashboardModal();
        window.location.href = `requirements.html?submission=${encodeURIComponent(id)}`;
        return;
      }
      const p = allItems.find((i) => i.id === id);
      if (p && p.content) {
        loadOwnedDoc(p);
        hideDashboardModal();
      }
    });
    el.querySelector('.doc-card__delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this document? This cannot be undone.')) return;
      if (type === 'questionnaire') {
        const { error } = await deleteQuestionnaire(id);
        if (error) { alert('Could not delete: ' + (error.message || error)); return; }
      } else {
        const { error } = await deleteProposal(id);
        if (error) { alert('Could not delete: ' + (error.message || error)); return; }
      }
      refreshDashboard();
      refreshHistory();
    });
  });
}

function filterDashboard(query) {
  const q = query.trim().toLowerCase();
  let filtered = mergeDashboardItems();
  if (dashboardTypeFilter !== 'all') {
    filtered = filtered.filter((item) => getDashboardDocType(item) === dashboardTypeFilter);
  }
  if (q) {
    filtered = filtered.filter((item) => {
      return [item.project_title, item.project_name, item.client_name, item.doc_number]
        .some((v) => (v || '').toLowerCase().includes(q));
    });
  }
  renderDashboardGrid(filtered);
}

/* ---------- PDF Generation ---------- */
// html2canvas rasterizes the ENTIRE document into a single canvas before
// jsPDF slices it into pages. Browsers cap canvas size — Chrome at ~16384px
// per side, Safari/iOS at ~16.7M px² total area — and when a long document at
// scale:2 exceeds those caps, the canvas comes back completely BLANK, producing
// an all-blank PDF. pdfScale() lowers the render scale just enough to keep the
// canvas within a safe cross-browser budget (full scale:2 quality for
// normal-length docs, gracefully reduced only for very long ones).
function pdfScale(element) {
  const w = element.scrollWidth || 800;
  const h = element.scrollHeight || 1000;
  const MAX_DIM = 16000;             // under Chrome's 16384px-per-side hard cap
  const MAX_AREA = 16 * 1000 * 1000; // under Safari/iOS's ~16.7M px² area cap
  let scale = Math.min(2, MAX_DIM / w, MAX_DIM / h, Math.sqrt(MAX_AREA / (w * h)));
  return Math.max(0.5, scale);
}
function downloadPDF() {
  const element = $('proposal');
  const docNo = document.querySelector('.js-doc-no')?.innerText?.trim() || 'PD-PROPOSAL';
  const opt = {
    margin: [15, 15],
    filename: `${docNo}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: pdfScale(element), useCORS: true, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    // 'avoid-all' forces every element to avoid splitting, which can leave whole
    // pages blank for page-spanning content; 'css'+'legacy' lets sections flow
    // across pages while `avoid` keeps small atomic blocks intact.
    pagebreak: { mode: ['css', 'legacy'], avoid: ['.p-party', '.p-sign', '.p-table tr', '.p-term'] }
  };
  setStatus('working', '<span class="spinner"></span>Generating PDF file...');
  // If the page is scrolled when "Download PDF" is clicked, html2canvas's
  // scrollY-compensation option doesn't reliably account for it (confirmed
  // with html2pdf.js 0.10.1): the captured canvas ends up shifted, so the
  // document's true start gets clipped off the top and an equal amount of
  // blank space appears as empty pages at the end. Scrolling to the real
  // top before capture — and restoring afterward — avoids that entirely.
  const restoreY = window.scrollY;
  window.scrollTo(0, 0);
  html2pdf().set(opt).from(element).save()
    .then(() => { window.scrollTo(0, restoreY); setStatus('ok', 'PDF downloaded successfully!'); })
    .catch(err => { window.scrollTo(0, restoreY); setStatus('error', `PDF generation failed: ${err.message}`); });
}

/* ---------- Date helpers ---------- */
function formatToday() {
  return new Date().toLocaleDateString(getLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
}
function freshDocNo() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `PD-${now.getFullYear()}-${mm}${dd}`;
}
function autofillMeta() {
  $('f_docno').value = freshDocNo();
  $('f_date').value = formatToday();
}
function freshInvoiceNo() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `INV-${now.getFullYear()}-${mm}${dd}`;
}
function autofillInvoiceMeta() {
  $('f_inv_no').value = freshInvoiceNo();
  $('f_inv_date').value = new Date().toLocaleDateString(getLocale('f_inv_locale'), { year: 'numeric', month: 'long', day: 'numeric' });
}

/* ---------- Quick Search ---------- */
function quickSearchLabelForProposal(row) {
  const type = row.content?.docType === 'invoice' ? 'Invoice' : 'Proposal';
  return {
    kind: row.content?.docType === 'invoice' ? 'invoice' : 'proposal',
    kindLabel: type,
    title: row.project_title || row.content?.meta?.title || 'Untitled',
    meta: [row.client_name, row.doc_number, type].filter(Boolean).join(' · '),
    keywords: [
      row.project_title,
      row.content?.meta?.title,
      row.client_name,
      row.doc_number,
      row.content?.client?.company,
      row.content?.preparedBy?.name,
      row.content?.meta?.proposalName,
      row.content?.meta?.invoiceName,
    ].filter(Boolean).join(' '),
    id: row.id,
    row,
  };
}

function quickSearchLabelForQuestionnaire(row) {
  return {
    kind: 'questionnaire',
    kindLabel: 'Questionnaire',
    title: row.project_name || row.client_name || 'Questionnaire',
    meta: [row.client_name, row.doc_number, row.project_type].filter(Boolean).join(' · '),
    keywords: [row.project_name, row.client_name, row.doc_number, row.project_type].filter(Boolean).join(' '),
    id: row.id,
    row,
  };
}

async function getQuickSearchItems() {
  const [proposals, questionnaires] = await Promise.all([
    fetchUserProposals(),
    fetchUserQuestionnaires(),
  ]);
  const items = [
    ...proposals.map(quickSearchLabelForProposal),
    ...questionnaires.map(quickSearchLabelForQuestionnaire),
  ];
  if (collab.id && collab.content) {
    const currentType = collab.content.docType === 'invoice' ? 'invoice' : 'proposal';
    items.unshift({
      kind: currentType,
      kindLabel: currentType === 'invoice' ? 'Invoice' : 'Proposal',
      title: collab.content.meta?.title || collab.content.meta?.proposalName || collab.content.meta?.invoiceName || 'Current document',
      meta: 'Currently open',
      keywords: [collab.content.meta?.title, collab.content.meta?.proposalName, collab.content.meta?.invoiceName].filter(Boolean).join(' '),
      id: collab.id,
      row: { id: collab.id, content: collab.content, share_token: collab.token },
    });
  }
  return items;
}

async function openQuickSearchResult(item) {
  if (!item) return;
  if (item.kind === 'questionnaire') {
    window.location.href = `requirements.html?submission=${encodeURIComponent(item.id)}`;
    return;
  }
  if (collab.id === item.id && collab.content) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const row = item.row || await fetchProposalById(item.id) || null;
  if (row && row.content) {
    await loadOwnedDoc(row);
    return;
  }
  const fallback = item.kind === 'invoice' ? 'index.html?mode=invoice' : 'index.html';
  window.location.href = `${fallback}${fallback.includes('?') ? '&' : '?'}open=${encodeURIComponent(item.id)}`;
}

/* ---------- Mode switching ---------- */
function setMode(mode) {
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('mode-tab--active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-mode]').forEach((el) => {
    if (el.classList.contains('mode-tab')) return;
    el.hidden = el.dataset.mode !== mode;
  });
}

/* ---------- Wiring ---------- */
function initDropzone() {
  const dz = $('dropzone');
  $('fileInput').addEventListener('change', (e) => handleFile(e.target.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-drag'); }));
  dz.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });

  // The empty-state placeholder also acts as a dropzone.
  const empty = $('emptyState');
  if (empty) {
    ['dragenter', 'dragover'].forEach((ev) => empty.addEventListener(ev, (e) => { e.preventDefault(); empty.classList.add('is-drag'); }));
    ['dragleave', 'drop'].forEach((ev) => empty.addEventListener(ev, (e) => { e.preventDefault(); empty.classList.remove('is-drag'); }));
    empty.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  }
}

function initDatePickers() {
  document.querySelectorAll('.date-field__btn').forEach((btn) => {
    const targetId = btn.dataset.target;
    const textInput = $(targetId);
    const picker = $(`${targetId}_picker`);
    if (!textInput || !picker) return;

    btn.addEventListener('click', () => {
      const parsed = new Date(textInput.value);
      if (!isNaN(parsed)) {
        const yyyy = parsed.getFullYear();
        const mm = String(parsed.getMonth() + 1).padStart(2, '0');
        const dd = String(parsed.getDate()).padStart(2, '0');
        picker.value = `${yyyy}-${mm}-${dd}`;
      }
      if (typeof picker.showPicker === 'function') picker.showPicker();
      else picker.click();
    });

    picker.addEventListener('change', () => {
      if (!picker.value) return;
      const [yyyy, mm, dd] = picker.value.split('-').map(Number);
      const date = new Date(yyyy, mm - 1, dd);
      textInput.value = date.toLocaleDateString(getLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
    });
  });
}

function init() {
  // Wire auth button immediately — OUTSIDE try/catch so it's always wired
  // even if other initialization fails.
  $('authNavBtn').addEventListener('click', showAuthModal);
  $('authModal').addEventListener('click', (e) => { if (e.target === $('authModal')) hideAuthModal(); });

  try {
    initDropzone();
    initDatePickers();
    applyLogo();
    autofillMeta();
    autofillInvoiceMeta();
    addLineItemRow();
    updateAuthState();

    // Handle ?mode=invoice URL param (from sidebar Invoice link)
    const modeParam = new URLSearchParams(window.location.search).get('mode');
    if (modeParam === 'invoice') setMode('invoice');
    else if (modeParam === 'proposal') setMode('proposal');

    const activeMode = modeParam === 'invoice' ? 'invoice' : 'proposal';
    initLayout({
      activePage: activeMode,
      onSettings: showSettingsModal,
    });

    createQuickSearch({
      buttonId: 'quickSearchBtn',
      title: 'Quick Search',
      subtitle: 'Jump to proposals, invoices, and questionnaires.',
      placeholder: 'Search by title, client, doc no., or keyword',
      getItems: getQuickSearchItems,
      onSelect: openQuickSearchResult,
    });

    // Settings modal wiring
    $('closeSettings').addEventListener('click', hideSettingsModal);
    $('settingsModal').addEventListener('click', (e) => { if (e.target === $('settingsModal')) hideSettingsModal(); });
    document.querySelectorAll('.settings-tab').forEach((btn) => {
      btn.addEventListener('click', () => openSettingsTab(btn.dataset.tab));
    });
    $('settingsAvatarUploadBtn').addEventListener('click', () => $('settingsAvatarInput').click());
    $('settingsAvatarInput').addEventListener('change', (e) => handleAvatarUpload(e.target.files[0]));
    $('settingsAvatarRemoveBtn').addEventListener('click', () => {
      localStorage.removeItem(LS_AVATAR);
      applySettingsAvatar();
    });
    $('saveProfileBtn').addEventListener('click', handleSaveProfile);
    $('saveEmailBtn').addEventListener('click', handleSaveEmail);
    $('savePasswordBtn').addEventListener('click', handleSavePassword);
    $('settingsSignInBtn').addEventListener('click', () => { hideSettingsModal(); showAuthModal(); });
    $('settingsSecuritySignInBtn').addEventListener('click', () => { hideSettingsModal(); showAuthModal(); });

    // Branding tab logo controls (same IDs as before, now inside settings modal)
    $('logoUploadBtn').addEventListener('click', () => $('logoInput').click());
    $('logoInput').addEventListener('change', (e) => handleLogo(e.target.files[0]));
    $('logoResetBtn').addEventListener('click', () => { localStorage.removeItem(LS_LOGO); applyLogo(); });

    // Apply stored avatar on load
    applySidebarAvatar();
    $('f_locale').addEventListener('change', () => { $('f_date').value = formatToday(); });
    $('f_inv_locale').addEventListener('change', () => { $('f_inv_date').value = new Date().toLocaleDateString(getLocale('f_inv_locale'), { year: 'numeric', month: 'long', day: 'numeric' }); });
    $('f_inv_currency').addEventListener('change', updateInvoiceTotal);

    $('addItemBtn').addEventListener('click', () => addLineItemRow());

    $('generateBtn').addEventListener('click', generate);
    $('generateInvoiceBtn').addEventListener('click', generateInvoice);
    $('downloadBtn').addEventListener('click', downloadPDF);
    $('authForm').addEventListener('submit', handleAuth);
    $('closeAuth').addEventListener('click', hideAuthModal);
    $('authTabLogin').addEventListener('click', () => setAuthMode('login'));
    $('authTabSignup').addEventListener('click', () => setAuthMode('signup'));

    $('openDashboardBtn').addEventListener('click', showDashboardModal);
    $('closeDashboard').addEventListener('click', hideDashboardModal);
    $('dashboardModal').addEventListener('click', (e) => {
      if (e.target === $('dashboardModal')) hideDashboardModal();
    });
    $('dashboardSearch').addEventListener('input', (e) => filterDashboard(e.target.value));
    document.querySelectorAll('.dashboard__tab').forEach((tab) => {
      tab.addEventListener('click', () => setDashboardTypeFilter(tab.dataset.type));
    });

    // Live collaboration wiring
    attachEditListener();
    $('shareBtn').addEventListener('click', handleShareClick);
    $('closeShare').addEventListener('click', closeShareModal);
    $('shareModal').addEventListener('click', (e) => { if (e.target === $('shareModal')) closeShareModal(); });
    $('shareCopyBtn').addEventListener('click', () => {
      const inp = $('shareLinkInput');
      inp.select();
      navigator.clipboard?.writeText(inp.value).then(() => {
        $('shareCopyBtn').textContent = 'Copied!';
        setTimeout(() => { $('shareCopyBtn').textContent = 'Copy'; }, 2000);
      }).catch(() => { /* clipboard blocked — link is still selected */ });
    });
    $('stopSharingBtn').addEventListener('click', handleStopSharing);

    // Click a collaborator's avatar to jump to where they're editing.
    ['collabAvatars', 'shareAvatars'].forEach((id) => {
      const c = $(id);
      if (!c) return;
      c.addEventListener('click', (e) => {
        const a = e.target.closest('.collab-avatar[data-uid]');
        if (!a) return;
        const uid = a.dataset.uid;
        if (collab.me && uid === collab.me.id) return;
        if ($('shareModal').classList.contains('modal--visible')) closeShareModal();
        jumpToUser(uid);
      });
    });

    // Guest entry: ?share=<token> opens a shared doc with no account required.
    const shareToken = new URLSearchParams(window.location.search).get('share');
    if (shareToken) enterGuestMode(shareToken);
  } catch (err) {
    console.error('App initialization failed:', err);
  }
}

// Leave the realtime channel cleanly when the tab closes.
window.addEventListener('beforeunload', () => { try { leaveCollab(); } catch { /* ignore */ } });

document.addEventListener('DOMContentLoaded', init);

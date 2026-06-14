/* ============================================================
   PocketDevs Proposal Generator
   Build-free static app. Calls Claude (Opus 4.8) directly from
   the browser; renders structured JSON into a branded proposal.
   ============================================================ */
'use strict';

import { getSession, signIn, signUp, signOut, saveProposal, fetchUserProposals, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';

/* ---------- Constants ---------- */
const MODEL = 'claude-opus-4-8';
// Generation goes through a Supabase Edge Function, which holds the
// Anthropic key as a server-side secret. The browser never sees the key.
const API_URL = `${SUPABASE_URL}/functions/v1/generate-proposal`;
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
- For hard facts (client name, project title, total cost, currency, timeline, dates, document number),
  use ONLY the confirmed details provided by the user. If a needed value is missing, output the literal
  string "[TBD]" — never invent precise figures, dates, or names.
- Currency defaults to Philippine Peso (write amounts like "Php 250,000"). Keep totals exclusive of VAT
  unless told otherwise, and say so.
- Scope of Work should be organized into phases, each with concrete deliverables.
- Timeline, Project Cost, and Milestones should be tabular and internally consistent (milestone amounts
  should reconcile to the total cost when a total is provided).
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
      amount: str('Amount as text, e.g. "Php 120,000" or "[TBD]"'),
    }), 'Cost line items'),
    notes: str('Notes, e.g. exclusive of VAT and reimbursables'),
    total: str('Total amount as text, or "[TBD]"'),
  }),
  milestonesPayment: arr(obj({
    milestone: str('Milestone name'),
    percentage: str('Percent of total, e.g. "50%"'),
    amount: str('Amount as text, or "[TBD]"'),
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
function getLocale() { const el = $('f_locale'); return (el && el.value) || 'en-PH'; }
function currencySymbol() {
  const sel = $('f_currency');
  const opt = sel && sel.options[sel.selectedIndex];
  return (opt && opt.dataset.symbol) || '';
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
  };
}

/* ---------- Generate ---------- */
async function generate() {
  // Generation runs through a Supabase Edge Function, which holds the
  // Anthropic key server-side and requires a signed-in user. We need a valid
  // Supabase session token to authorize the call.
  const session = await getSession();
  if (!session || !session.access_token) {
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
  setStatus('working', '<span class="spinner"></span>Reading the document and drafting all 10 sections… this can take 30–60s.');

  const userText =
    'Draft a PocketDevs proposal' + (pdfBase64 ? ' based on the attached source document and these confirmed details.' : ' from these confirmed details.') +
    '\\nUse ONLY these confirmed values for hard facts; output "[TBD]" for anything missing.\\n\\n' +
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
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      const msg = data && data.error ? data.error.message : `HTTP ${res.status}`;
      if (res.status === 401) { showAuthModal(); }
      setStatus('error', `Generation failed: ${esc(msg)}`);
      return;
    }

    const block = (data.content || []).find((b) => b.type === 'text');
    if (!block) { setStatus('error', 'No proposal text returned. Try again.'); return; }

    let proposal;
    try { proposal = JSON.parse(block.text); }
    catch (e) { setStatus('error', 'Response was not valid JSON.'); return; }

    render(proposal);
    // Best-effort save to history (we're signed in; never blocks the result).
    try {
      const { error: saveErr } = await saveProposal(proposal);
      if (saveErr && saveErr !== 'not-authenticated' && saveErr !== 'offline') {
        console.warn('Could not save proposal to history:', saveErr);
      } else if (!saveErr) {
        refreshHistory();
      }
    } catch (e) { /* history is optional — ignore */ }
    setStatus('ok', `Proposal generated. Click any text to edit, then <b>Download PDF</b>.`);
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
  if (d.meta.budget) {
    sec.push(`<section class="p-section">${sectionHead(6, 'Project Cost')}<div class="p-lede"><p><strong>Proposed Budget:</strong> ${esc(d.meta.budget)}</p></div></section>`);
  } else {
    sec.push(`<section class="p-section">${sectionHead(6, 'Project Cost')}
    <table class="p-table"><thead><tr><th>Line item</th><th>Basis</th><th class="num">Amount</th></tr></thead>
    <tbody>${ci}${cost.total ? `<tr class="p-table__total"><td>Total</td><td></td><td class="num">${esc(cost.total)}</td></tr>` : ''}</tbody></table>
    ${cost.notes ? `<div class="p-note">${esc(cost.notes)}</div>` : ''}</section>`);
  }
  const mp = (d.milestonesPayment || []).map((r) => `<tr><td>${esc(r.milestone)}</td><td class="num">${esc(r.percentage)}</td><td class="num">${esc(r.amount)}</td><td>${esc(r.trigger)}</td></tr>`).join('');
  if (d.meta.paymentDetails) {
    sec.push(`<section class="p-section">${sectionHead(7, 'Milestones and Payment Terms')}<div class="p-lede"><p>${esc(d.meta.paymentDetails)}</p></div></section>`);
  } else {
    sec.push(`<section class="p-section">${sectionHead(7, 'Milestones and Payment Terms')}
    <table class="p-table"><thead><tr><th>Milestone</th><th class="num">%</th><th class="num">Amount</th><th>Trigger</th></tr></thead><tbody>${mp}</tbody></table></section>`);
  }
  sec.push(`<section class="p-section">${sectionHead(8, 'Payment Options')}${list(d.paymentOptions)}</section>`);
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Auth Modal ---------- */
function showAuthModal() {
  $('authModal').classList.add('modal--visible');
}
function hideAuthModal() {
  $('authModal').classList.remove('modal--visible');
}

async function handleAuth(e) {
  e.preventDefault();
  const email = $('authEmail').value;
  const password = $('authPassword').value;
  const isSignUp = e.submitter.dataset.mode === 'signup';

  try {
    const { error } = isSignUp
      ? await signUp(email, password)
      : await signIn(email, password);

    if (error) {
      showToast(error.message, 'error');
    } else {
      showToast(isSignUp ? 'Check your email to confirm sign up!' : 'Welcome back!', 'success');
      hideAuthModal();
      updateAuthState();
    }
  } catch (err) {
    showToast('Authentication failed unexpectedly.', 'error');
  }
}

async function updateAuthState() {
  try {
    const session = await getSession();
    const btn = $('authNavBtn');
    if (session) {
      btn.textContent = session.user.email.split('@')[0];
      btn.onclick = async () => {
        await signOut();
        updateAuthState();
      };
      refreshHistory();
    } else {
      btn.textContent = 'Login';
      btn.onclick = showAuthModal;
      $('historyList').innerHTML = '<p class="card__hint">Login to see your history.</p>';
    }
  } catch (err) {
    console.error('Auth state update failed:', err);
  }
}

/* ---------- History ---------- */
async function refreshHistory() {
  const list = $('historyList');
  try {
    const items = await fetchUserProposals();
    if (!items || !items.length) {
      list.innerHTML = '<p class="card__hint">No proposals saved yet.</p>';
      return;
    }
    list.innerHTML = items.map(p => `
      <div class="history-item" data-id="${p.id}">
        <div class="history-item__title">${esc(p.project_title || 'Untitled')}</div>
        <div class="history-item__meta">${esc(p.client_name || '')} · ${esc(p.doc_number || '')}</div>
      </div>
    `).join('');
    
    list.querySelectorAll('.history-item').forEach(el => {
      el.onclick = () => {
        const p = items.find(i => i.id === el.dataset.id);
        if (p && p.content) render(p.content);
      };
    });
  } catch (err) {
    list.innerHTML = '<p class="card__hint">History temporarily unavailable.</p>';
  }
}

/* ---------- PDF Generation ---------- */
function downloadPDF() {
  const element = $('proposal');
  const docNo = document.querySelector('.js-doc-no')?.innerText?.trim() || 'PD-PROPOSAL';
  const opt = {
    margin: [15, 15],
    filename: `${docNo}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
  };
  setStatus('working', '<span class="spinner"></span>Generating PDF file...');
  html2pdf().set(opt).from(element).save()
    .then(() => setStatus('ok', 'PDF downloaded successfully.'))
    .catch(err => setStatus('error', `PDF generation failed: ${err.message}`));
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

/* ---------- Wiring ---------- */
function initDropzone() {
  const dz = $('dropzone');
  $('fileInput').addEventListener('change', (e) => handleFile(e.target.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-drag'); }));
  dz.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });
}

function init() {
  try {
    initDropzone();
    applyLogo();
    autofillMeta();
    updateAuthState();

    $('settingsBtn').addEventListener('click', () => { $('settingsPanel').hidden = !$('settingsPanel').hidden; });
    $('logoUploadBtn').addEventListener('click', () => $('logoInput').click());
    $('logoInput').addEventListener('change', (e) => handleLogo(e.target.files[0]));
    $('logoResetBtn').addEventListener('click', () => { localStorage.removeItem(LS_LOGO); applyLogo(); setStatus('ok', 'Reverted to the default logo.'); });
    $('f_locale').addEventListener('change', () => { $('f_date').value = formatToday(); });

    $('generateBtn').addEventListener('click', generate);
    $('downloadBtn').addEventListener('click', downloadPDF);
    $('authForm').addEventListener('submit', handleAuth);
    $('closeAuth').addEventListener('click', hideAuthModal);
  } catch (err) {
    console.error('App initialization failed:', err);
  }
}

document.addEventListener('DOMContentLoaded', init);

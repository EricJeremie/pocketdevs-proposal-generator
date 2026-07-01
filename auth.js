/* ============================================================
   Propello auth page logic
   Login is a single simple form. Sign-up is a Typeform-style flow:
   one question at a time (account → KYC → industry → tailoring),
   with click/Enter to advance, letter-key shortcuts on choices, a
   progress bar, and smooth slide transitions. Everything is stored
   in the user's Supabase metadata so proposals fit their industry.
   ============================================================ */
'use strict';

import { getSession, signIn, signUp } from './supabase.js?v=29';
import { INDUSTRY_PROFILES, getIndustryProfile, buildIndustryMetadata } from './industry-profiles.js?v=1';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const params = new URLSearchParams(location.search);

/* Only allow same-origin relative redirects — never an absolute/remote URL. */
function safeNext(value) {
  if (!value) return null;
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('/')) return null;
  return value;
}
const NEXT = safeNext(params.get('next')) || 'dashboard.html';

/* ---------- The sign-up questionnaire ---------- */
const COUNTRIES = ['Philippines', 'United States', 'Canada', 'United Kingdom', 'Australia', 'Singapore',
  'Malaysia', 'Indonesia', 'Thailand', 'Vietnam', 'India', 'United Arab Emirates', 'Japan', 'Hong Kong',
  'New Zealand', 'Germany', 'Netherlands', 'Other'];
const SIZES = ['Just me', '2–10', '11–50', '51–200', '201–500', '500+'];
// All industry profiles ship 3 tailoring questions; used only to keep the
// progress bar steady before an industry is picked.
const EST_TAILORING = 3;

const BASE = [
  { id: 'name', type: 'text', label: "First — what should we call you?", hint: "Your full name, as it'll appear on proposals.", placeholder: 'Jane Santos', autocomplete: 'name', required: true, emptyMsg: 'Please enter your name.' },
  { id: 'email', type: 'email', label: "What's your email?", hint: "You'll use this to sign in.", placeholder: 'you@company.com', autocomplete: 'email', required: true, validate: (v) => isValidEmail(v) ? null : 'Please enter a valid email address.' },
  { id: 'password', type: 'password', label: 'Set a password', hint: 'At least 6 characters.', placeholder: '••••••••', autocomplete: 'new-password', required: true, validate: (v) => v.length >= 6 ? null : 'Use at least 6 characters.' },
  { id: 'company', type: 'text', label: "What's your business called?", placeholder: 'Northlight Studio', autocomplete: 'organization', required: true, emptyMsg: 'Please enter your business name.' },
  { id: 'role', type: 'text', label: 'And your role there?', placeholder: 'Founder, Account Manager, …', autocomplete: 'organization-title', required: true, emptyMsg: 'Please enter your role.' },
  { id: 'phone', type: 'tel', label: 'Best number to reach you?', placeholder: '+63 917 000 0000', autocomplete: 'tel', required: true, emptyMsg: 'Please enter your phone number.' },
  { id: 'country', type: 'select', label: 'Where are you based?', placeholder: 'Select your country', options: COUNTRIES.map((c) => ({ value: c, label: c })), required: true, emptyMsg: 'Please select your country.' },
  { id: 'size', type: 'choice', label: 'How big is your team?', options: SIZES.map((s) => ({ value: s, label: s })), required: true, emptyMsg: 'Please choose a team size.' },
  { id: 'industry', type: 'choice', label: 'Which industry are you in?', hint: "We'll tailor proposal language, scope, and pricing to your field.", options: INDUSTRY_PROFILES.map((p) => ({ value: p.id, label: p.name })), required: true, isIndustry: true, emptyMsg: 'Please choose your industry.' },
];

/* ---------- Icons ---------- */
const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13"/><path d="M12 5l7 7-7 7"/></svg>';
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const CHECK = '<svg class="tf-choice__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

/* ---------- State + elements ---------- */
let mode = params.get('mode') === 'signup' ? 'signup' : 'login';
let slides = BASE.slice();
let idx = 0;
let advanceTimer = 0;
let submitting = false;
const answers = {};

const loginForm = $('loginForm');
const signupFlow = $('signupFlow');
const tfStage = $('tfStage');
const tfFill = $('tfFill');
const tfStatus = $('tfStatus');
const tfClose = $('tfClose');
const tabLogin = $('tabLogin');
const tabSignup = $('tabSignup');

/* If a valid session already exists, skip the form and go straight in. */
(async () => {
  try {
    const session = await getSession();
    if (session) location.replace(NEXT);
  } catch { /* offline — stay on the page */ }
})();

/* ---------- Status helpers ---------- */
function setStatus(message, kind) {
  if (!message) { tfStatus.hidden = true; tfStatus.textContent = ''; return; }
  tfStatus.textContent = message;
  tfStatus.className = `auth-status tf__status auth-status--${kind === 'ok' ? 'ok' : 'error'}`;
  tfStatus.hidden = false;
}
function setLoginStatus(message, kind) {
  const el = $('loginStatus');
  if (!message) { el.hidden = true; el.textContent = ''; return; }
  el.textContent = message;
  el.className = `auth-status auth-status--${kind === 'ok' ? 'ok' : 'error'}`;
  el.hidden = false;
}

/* ---------- Flow helpers ---------- */
function totalSteps() {
  return answers.industry ? slides.length : BASE.length + EST_TAILORING;
}

// Append (or refresh) the chosen industry's tailoring questions after the
// industry slide, so the flow length reflects the selected field.
function rebuildTailoring() {
  slides = slides.filter((s) => !s._tailoring);
  const profile = getIndustryProfile(answers.industry);
  (profile && profile.questions ? profile.questions : []).forEach((q) => {
    slides.push({ id: q.id, type: 'choice', label: q.label, options: q.options, required: q.required !== false, _tailoring: true });
  });
}

function inputType(q) {
  if (q.type === 'email') return 'email';
  if (q.type === 'tel') return 'tel';
  if (q.type === 'password') return 'password';
  return 'text';
}

function controlHtml(q) {
  if (q.type === 'choice') {
    const opts = q.options.map((o, i) => {
      const selected = answers[q.id] === o.value;
      const key = i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
      return `<button type="button" class="tf-choice${selected ? ' is-selected' : ''}" data-value="${esc(o.value)}" role="option" aria-selected="${selected}">
          <span class="tf-choice__key">${key}</span>
          <span class="tf-choice__label">${esc(o.label)}</span>
          ${CHECK}
        </button>`;
    }).join('');
    return `<div class="tf-choices" role="listbox" aria-label="${esc(q.label)}">${opts}</div>`;
  }
  if (q.type === 'select') {
    const opts = `<option value="" disabled ${answers[q.id] ? '' : 'selected'}>${esc(q.placeholder || 'Select…')}</option>` +
      q.options.map((o) => `<option value="${esc(o.value)}" ${answers[q.id] === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    return `<div class="tf-field"><select id="tfInput" class="tf-q__input tf-q__input--select">${opts}</select></div>`;
  }
  const eye = q.type === 'password'
    ? `<button type="button" class="tf-eye" id="tfEye" aria-label="Show password" aria-pressed="false">${EYE}</button>` : '';
  return `<div class="tf-field">
      <input id="tfInput" class="tf-q__input${q.type === 'password' ? ' has-eye' : ''}" type="${inputType(q)}"
        placeholder="${esc(q.placeholder || '')}" autocomplete="${esc(q.autocomplete || 'off')}" value="${esc(answers[q.id] || '')}" />
      ${eye}
    </div>`;
}

function renderSlide(dir = 1) {
  const q = slides[idx];
  if (!q) return;
  setStatus('', '');
  clearTimeout(advanceTimer);

  const willSubmit = !q.isIndustry && idx === slides.length - 1;
  const okLabel = willSubmit ? 'Create account' : 'OK';
  const keyhint = q.type === 'choice' ? 'press a <b>letter</b> to choose' : 'press <b>Enter ↵</b>';
  const from = dir >= 0 ? '24px' : '-24px';

  tfStage.innerHTML = `
    <div class="tf-q" data-qid="${esc(q.id)}" style="--tf-from:${from}">
      <span class="tf-q__num">${idx + 1} ${ARROW}</span>
      <h2 class="tf-q__label">${esc(q.label)}</h2>
      ${q.hint ? `<p class="tf-q__hint">${esc(q.hint)}</p>` : ''}
      ${controlHtml(q)}
      <div class="tf-q__actions">
        ${idx > 0 ? '<button type="button" class="btn btn--glass tf-back" id="tfBack">Back</button>' : ''}
        <button type="button" class="btn btn--primary tf-ok" id="tfOk">${okLabel} <span class="tf-ok__kbd" aria-hidden="true">↵</span></button>
        <span class="tf-q__keyhint">${keyhint}</span>
      </div>
    </div>`;

  tfFill.style.width = `${Math.round((idx / Math.max(1, totalSteps() - 1)) * 100)}%`;

  const slideEl = tfStage.firstElementChild;
  void slideEl.offsetWidth; // commit the pre-animation state, then transition in
  slideEl.classList.add('is-in');

  if (q.type === 'choice') {
    slideEl.querySelectorAll('.tf-choice').forEach((btn) => {
      btn.addEventListener('click', () => selectChoice(q, btn.dataset.value));
    });
  } else {
    const input = $('tfInput');
    if (input) {
      const sync = () => { answers[q.id] = input.value; };
      input.addEventListener('input', sync);
      input.addEventListener('change', sync);
      setTimeout(() => { try { input.focus({ preventScroll: true }); } catch { input.focus(); } }, 70);
    }
    if (q.type === 'password') {
      $('tfEye').addEventListener('click', () => {
        const p = $('tfInput');
        const showing = p.type === 'text';
        p.type = showing ? 'password' : 'text';
        const b = $('tfEye');
        b.setAttribute('aria-pressed', String(!showing));
        b.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      });
    }
  }
  const ok = $('tfOk'); if (ok) ok.addEventListener('click', next);
  const back = $('tfBack'); if (back) back.addEventListener('click', prev);
}

function selectChoice(q, value) {
  answers[q.id] = value;
  tfStage.querySelectorAll('.tf-choice').forEach((b) => {
    const on = b.dataset.value === value;
    b.classList.toggle('is-selected', on);
    b.setAttribute('aria-selected', String(on));
  });
  setStatus('', '');
  // Brief pause so the selection is visible, then advance automatically.
  clearTimeout(advanceTimer);
  advanceTimer = setTimeout(next, 320);
}

function readCurrent(q) {
  if (q.type !== 'choice') {
    const el = $('tfInput');
    if (el) answers[q.id] = (el.value || '').trim();
  }
}

function validate(q) {
  const v = answers[q.id] || '';
  if (q.required && !v) return q.emptyMsg || 'This field is required.';
  if (q.validate) return q.validate(v);
  return null;
}

function next() {
  if (submitting) return;
  const q = slides[idx];
  readCurrent(q);
  const err = validate(q);
  if (err) { setStatus(err, 'error'); return; }

  if (q.isIndustry) { rebuildTailoring(); idx += 1; renderSlide(1); return; }
  if (idx === slides.length - 1) { submit(); return; }
  idx += 1;
  renderSlide(1);
}

function prev() {
  if (submitting || idx === 0) return;
  idx -= 1;
  renderSlide(-1);
}

function renderMessage(title, sub) {
  tfFill.style.width = '100%';
  tfStage.innerHTML = `<div class="tf-q tf-q--message">
      <h2 class="tf-q__label">${esc(title)}</h2>
      ${sub ? `<p class="tf-q__hint">${esc(sub)}</p>` : ''}
    </div>`;
  const el = tfStage.firstElementChild;
  void el.offsetWidth;
  el.classList.add('is-in');
}

async function submit() {
  submitting = true;
  const industryId = answers.industry;
  const profile = getIndustryProfile(industryId);
  const tailoring = {};
  (profile && profile.questions ? profile.questions : []).forEach((q) => {
    if (answers[q.id]) tailoring[q.id] = answers[q.id];
  });
  const industryMeta = buildIndustryMetadata(industryId, tailoring);
  const kyc = {
    company: answers.company || '',
    job_title: answers.role || '',
    phone: answers.phone || '',
    country: answers.country || '',
    company_size: answers.size || '',
  };

  renderMessage('Creating your account…', 'Just a moment.');
  try {
    const { data, error } = await signUp(answers.email, answers.password, answers.name, industryMeta, kyc);
    if (error) {
      renderSlide(0);
      setStatus(error.message || String(error), 'error');
      submitting = false;
      return;
    }
    // Sign-up with email confirmation returns no session yet.
    if (!(data && data.session)) {
      renderMessage('Almost there!', 'Check your email to confirm your account, then sign in.');
      submitting = false;
      return;
    }
    renderMessage('You\'re in!', 'Taking you to your workspace…');
    location.replace(NEXT);
  } catch {
    renderSlide(0);
    setStatus('Something went wrong. Please try again.', 'error');
    submitting = false;
  }
}

/* ---------- Full-screen sign-up takeover ---------- */
let closeTimer = 0;

function openSignup() {
  mode = 'signup';
  tabLogin.setAttribute('aria-selected', 'false');
  tabSignup.setAttribute('aria-selected', 'true');
  clearTimeout(closeTimer);

  signupFlow.hidden = false;
  document.body.classList.add('tf-open');
  // Commit the hidden→shown initial state (opacity:0, scaled) with a reflow,
  // then add the class in the same tick so the transition animates in. Doing
  // this synchronously (not via rAF) keeps it working even in background tabs.
  void signupFlow.offsetWidth;
  signupFlow.classList.add('is-open');

  if (answers.industry) rebuildTailoring();
  renderSlide(0);
}

function closeSignup() {
  mode = 'login';
  tabLogin.setAttribute('aria-selected', 'true');
  tabSignup.setAttribute('aria-selected', 'false');
  signupFlow.classList.remove('is-open');
  document.body.classList.remove('tf-open');
  setLoginStatus('', '');
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { signupFlow.hidden = true; }, 460);
}

/* ---------- Wiring ---------- */
tabLogin.addEventListener('click', closeSignup);
tabSignup.addEventListener('click', openSignup);
tfClose.addEventListener('click', closeSignup);
$('switchMode').addEventListener('click', openSignup);

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  if (!isValidEmail(email) || !password) {
    setLoginStatus('Please enter your email and password.', 'error');
    return;
  }
  const btn = $('loginSubmit');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const { error } = await signIn(email, password);
    if (error) { setLoginStatus(error.message || String(error), 'error'); return; }
    setLoginStatus('Success! Taking you to the app…', 'ok');
    location.replace(NEXT);
  } catch {
    setLoginStatus('Something went wrong. Please try again.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Login';
  }
});

$('loginEye').addEventListener('click', () => {
  const p = $('loginPassword');
  const showing = p.type === 'text';
  p.type = showing ? 'password' : 'text';
  const b = $('loginEye');
  b.setAttribute('aria-pressed', String(!showing));
  b.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
});

// Keyboard: Esc closes; Enter advances; letters/numbers pick a choice.
document.addEventListener('keydown', (e) => {
  if (mode !== 'signup' || signupFlow.hidden || submitting) return;
  if (e.key === 'Escape') { e.preventDefault(); closeSignup(); return; }
  const q = slides[idx];
  if (!q) return;
  if (e.key === 'Enter') { e.preventDefault(); next(); return; }
  if (q.type === 'choice') {
    let i = -1;
    if (/^[a-z]$/i.test(e.key)) i = e.key.toUpperCase().charCodeAt(0) - 65;
    else if (/^[1-9]$/.test(e.key)) i = Number(e.key) - 1;
    if (i >= 0 && i < q.options.length) { e.preventDefault(); selectChoice(q, q.options[i].value); }
  }
});

// Open the full-screen sign-up immediately if arrived via ?mode=signup.
if (mode === 'signup') openSignup();

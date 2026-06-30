/* ============================================================
   Propello auth page logic
   Login is a single step. Sign-up is a 4-step wizard:
     1. Account   (name, email, password)
     2. Business  (KYC: company, role, phone, country, size)
     3. Industry  (pick a profile)
     4. Tailoring (industry-specific questions)
   Everything is stored in the user's Supabase metadata so proposals
   can be tailored to their industry. On success it forwards into the app.
   ============================================================ */
'use strict';

import { getSession, signIn, signUp } from './supabase.js?v=29';
import {
  industryOptionsHtml,
  getIndustryProfile,
  collectIndustryAnswers,
  buildIndustryMetadata,
  areIndustryAnswersComplete,
} from './industry-profiles.js?v=1';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

/* Only allow same-origin relative redirects — never an absolute/remote URL. */
function safeNext(value) {
  if (!value) return null;
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('/')) return null;
  return value;
}
const NEXT = safeNext(params.get('next')) || 'dashboard.html';

const form = $('authForm');
const heading = $('authHeading');
const subhead = $('authSubhead');
const tabLogin = $('tabLogin');
const tabSignup = $('tabSignup');
const foot = $('authFoot');
const statusEl = $('authStatus');
const submitBtn = $('authSubmit');
const backBtn = $('authBack');
const stepsEl = $('authSteps');
const stepsFill = $('authStepsFill');
const stepsLabel = $('authStepsLabel');
const nameField = $('nameField');
const nameInput = $('authName');
const emailInput = $('authEmail');
const passwordInput = $('authPassword');
const industrySelect = $('kycIndustry');

const STEP_LABELS = ['Account', 'Business details', 'Industry', 'Tailoring'];
const TOTAL_STEPS = 4;

let mode = params.get('mode') === 'signup' ? 'signup' : 'login';
let step = 1;

/* Populate the industry dropdown from the shared profile data. */
industrySelect.innerHTML = industryOptionsHtml('', { includePlaceholder: true });

/* If a valid session already exists, skip the form and go straight in. */
(async () => {
  try {
    const session = await getSession();
    if (session) location.replace(NEXT);
  } catch { /* offline — stay on the page */ }
})();

function setStatus(message, kind) {
  if (!message) {
    statusEl.hidden = true;
    statusEl.textContent = '';
    return;
  }
  statusEl.textContent = message;
  statusEl.className = `auth-status auth-status--${kind === 'ok' ? 'ok' : 'error'}`;
  statusEl.hidden = false;
}

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function showStep(n) {
  step = n;
  form.querySelectorAll('.auth-step').forEach((el) => {
    el.hidden = Number(el.dataset.step) !== n;
  });
  stepsFill.style.width = `${(n / TOTAL_STEPS) * 100}%`;
  stepsLabel.textContent = `Step ${n} of ${TOTAL_STEPS} · ${STEP_LABELS[n - 1]}`;
  backBtn.hidden = n === 1;
  submitBtn.textContent = n < TOTAL_STEPS ? 'Continue' : 'Create account';
  setStatus('', '');
}

function applyMode(next) {
  mode = next === 'signup' ? 'signup' : 'login';
  const isSignUp = mode === 'signup';

  heading.textContent = isSignUp ? 'Create your Propello account' : 'Sign in to Propello';
  subhead.textContent = isSignUp
    ? 'Tell us a bit about you so proposals fit your business.'
    : 'Use your email and password to access the app.';

  tabLogin.setAttribute('aria-selected', String(!isSignUp));
  tabSignup.setAttribute('aria-selected', String(isSignUp));

  nameField.hidden = !isSignUp;
  nameInput.required = isSignUp;
  passwordInput.autocomplete = isSignUp ? 'new-password' : 'current-password';

  stepsEl.hidden = !isSignUp;

  if (isSignUp) {
    showStep(1);
  } else {
    form.querySelectorAll('.auth-step').forEach((el) => { el.hidden = Number(el.dataset.step) !== 1; });
    backBtn.hidden = true;
    submitBtn.textContent = 'Login';
  }

  foot.innerHTML = isSignUp
    ? 'Already have an account? <button type="button" id="switchMode" data-target="login">Sign in</button>'
    : 'New to Propello? <button type="button" id="switchMode" data-target="signup">Create an account</button>';
  $('switchMode').addEventListener('click', (e) => applyMode(e.currentTarget.dataset.target));

  setStatus('', '');
}

/* Per-step validation (sign-up). Returns an error string, or null if valid. */
function validateStep(n) {
  if (n === 1) {
    if (!nameInput.value.trim()) return 'Please enter your full name.';
    if (!isValidEmail(emailInput.value.trim())) return 'Please enter a valid email address.';
    if (passwordInput.value.length < 6) return 'Password must be at least 6 characters.';
  }
  if (n === 2) {
    if (!$('kycCompany').value.trim()) return 'Please enter your company or business name.';
    if (!$('kycRole').value.trim()) return 'Please enter your role.';
    if (!$('kycPhone').value.trim()) return 'Please enter your phone number.';
    if (!$('kycCountry').value) return 'Please select your country.';
    if (!$('kycSize').value) return 'Please select your company size.';
  }
  if (n === 3) {
    if (!industrySelect.value) return 'Please choose your industry.';
  }
  if (n === 4) {
    const profile = getIndustryProfile(industrySelect.value);
    const answers = collectIndustryAnswers($('industryQuestions'));
    if (!areIndustryAnswersComplete(profile, answers)) return 'Please answer the setup questions.';
  }
  return null;
}

/* Build the industry-specific questions for the chosen profile. */
function renderIndustryQuestions(industryId) {
  const container = $('industryQuestions');
  const profile = getIndustryProfile(industryId);
  if (!profile || !profile.questions.length) {
    container.innerHTML = '<p class="auth-hint">No extra questions for this field — you\'re all set.</p>';
    return;
  }
  container.innerHTML = profile.questions.map((q) => {
    const opts = ['<option value="" disabled selected>Choose one</option>']
      .concat(q.options.map((o) => `<option value="${o.value}">${o.label}</option>`))
      .join('');
    return `<div class="auth-field">
        <label for="q_${q.id}">${q.label}</label>
        <select id="q_${q.id}" class="auth-select" data-industry-question="${q.id}" required>${opts}</select>
      </div>`;
  }).join('');
}

industrySelect.addEventListener('change', () => renderIndustryQuestions(industrySelect.value));

tabLogin.addEventListener('click', () => applyMode('login'));
tabSignup.addEventListener('click', () => applyMode('signup'));
backBtn.addEventListener('click', () => { if (step > 1) showStep(step - 1); });

$('togglePassword').addEventListener('click', () => {
  const showing = passwordInput.type === 'text';
  passwordInput.type = showing ? 'password' : 'text';
  const btn = $('togglePassword');
  btn.setAttribute('aria-pressed', String(!showing));
  btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setStatus('', '');

  if (mode === 'login') return doLogin();

  // Sign-up: validate the current step, then advance or submit.
  const err = validateStep(step);
  if (err) { setStatus(err, 'error'); return; }

  if (step < TOTAL_STEPS) {
    if (step === 3) renderIndustryQuestions(industrySelect.value);
    showStep(step + 1);
    return;
  }

  await doSignup();
});

async function doLogin() {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!isValidEmail(email) || !password) {
    setStatus('Please enter your email and password.', 'error');
    return;
  }
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in…';
  try {
    const { error } = await signIn(email, password);
    if (error) { setStatus(error.message || String(error), 'error'); return; }
    setStatus('Success! Taking you to the app…', 'ok');
    location.replace(NEXT);
  } catch {
    setStatus('Something went wrong. Please try again.', 'error');
  } finally {
    submitBtn.disabled = false;
    if (mode === 'login') submitBtn.textContent = 'Login';
  }
}

async function doSignup() {
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const industryId = industrySelect.value;
  const answers = collectIndustryAnswers($('industryQuestions'));
  const industryMeta = buildIndustryMetadata(industryId, answers);
  const kyc = {
    company: $('kycCompany').value.trim(),
    job_title: $('kycRole').value.trim(),
    phone: $('kycPhone').value.trim(),
    country: $('kycCountry').value,
    company_size: $('kycSize').value,
  };

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account…';
  try {
    const { data, error } = await signUp(email, password, name, industryMeta, kyc);
    if (error) { setStatus(error.message || String(error), 'error'); return; }

    // Sign-up with email confirmation returns no session yet.
    const signedIn = data && data.session;
    if (!signedIn) {
      setStatus('Almost there — check your email to confirm your account, then sign in.', 'ok');
      applyMode('login');
      emailInput.value = email;
      return;
    }
    setStatus('Success! Taking you to the app…', 'ok');
    location.replace(NEXT);
  } catch {
    setStatus('Something went wrong. Please try again.', 'error');
  } finally {
    submitBtn.disabled = false;
    if (mode === 'signup') submitBtn.textContent = step < TOTAL_STEPS ? 'Continue' : 'Create account';
  }
}

// Initialise from the URL (?mode=signup) on load.
applyMode(mode);

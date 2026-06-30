'use strict';

import { initLayout } from './nav.js?v=29';
import {
  getSession, signIn, signUp, signOut, onAuthChange,
  fetchUserProposals, fetchUserQuestionnaires,
  deleteProposal, deleteQuestionnaire,
} from './supabase.js?v=28';
import { createQuickSearch } from './quick-search.js';
import {
  buildIndustryMetadata,
  collectIndustryAnswers,
  industryOptionsHtml,
  industryQuestionsHtml,
  isIndustryMetadataComplete,
  getIndustryTemplates,
} from './industry-profiles.js?v=1';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function setIndustryQuestionControlsEnabled(root, enabled) {
  if (!root) return;
  root.querySelectorAll('input, select, textarea').forEach((control) => {
    control.disabled = !enabled;
  });
}

function renderAuthIndustryQuestions() {
  const select = $('authIndustry');
  const container = $('authIndustryQuestions');
  if (!select || !container) return;
  container.innerHTML = industryQuestionsHtml(select.value || '', {}, 'dashIndustryQuestion');
  setIndustryQuestionControlsEnabled($('authIndustryField'), authMode === 'signup');
}

function setupAuthIndustryOnboarding() {
  const select = $('authIndustry');
  if (!select) return;
  select.innerHTML = industryOptionsHtml('', { includePlaceholder: true });
  select.value = '';
  select.addEventListener('change', renderAuthIndustryQuestions);
  renderAuthIndustryQuestions();
}

function setAuthIndustryOnboardingVisible(visible) {
  const field = $('authIndustryField');
  if (!field) return;
  field.hidden = !visible;
  setIndustryQuestionControlsEnabled(field, visible);
  const select = $('authIndustry');
  if (select) {
    select.disabled = !visible;
    select.required = visible;
  }
}

function collectAuthIndustryMetadata() {
  const industryId = $('authIndustry')?.value || '';
  if (!industryId) return null;
  return buildIndustryMetadata(industryId, collectIndustryAnswers($('authForm')));
}

let allProposals = [];
let allQuestionnaires = [];
let activeFilter = 'all';
let searchQuery = '';
function getDocType(item) {
  if (item._type === 'questionnaire') return 'questionnaire';
  if (item.content && item.content.docType === 'invoice') return 'invoice';
  return 'proposal';
}

const TYPE_LABELS = { proposal: 'Proposal', invoice: 'Invoice', questionnaire: 'Questionnaire' };
const APPROVAL_LABELS = { draft: 'Draft', review: 'In review', approved: 'Approved' };

function approvalBadgeHtml(content) {
  if (!content || content.docType === 'invoice') return '';
  const status = (content.internal && content.internal.approval && content.internal.approval.status) || 'draft';
  return `<span class="doc-status doc-status--${esc(status)}">${esc(APPROVAL_LABELS[status] || status)}</span>`;
}

function mergeItems() {
  const proposals = allProposals.map(p => ({ ...p, _type: p.content?.docType === 'invoice' ? 'invoice' : 'proposal' }));
  const questionnaires = allQuestionnaires.map(q => ({ ...q, _type: 'questionnaire' }));
  return [...proposals, ...questionnaires].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

function applyFilter() {
  let items = mergeItems();
  if (activeFilter !== 'all') {
    items = items.filter(item => getDocType(item) === activeFilter);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    items = items.filter(item => {
      const title = (item.project_title || item.project_name || '').toLowerCase();
      const client = (item.client_name || '').toLowerCase();
      const docNo = (item.doc_number || '').toLowerCase();
      return title.includes(q) || client.includes(q) || docNo.includes(q);
    });
  }
  renderGrid(items);
}

function renderGrid(items) {
  const grid = $('dashGrid');
  if (!items.length) {
    const label = activeFilter === 'all' ? 'documents' : TYPE_LABELS[activeFilter].toLowerCase() + 's';
    grid.innerHTML = `<p class="dash-page__empty">No ${label} found.</p>`;
    return;
  }
  grid.innerHTML = items.map(item => {
    const type = getDocType(item);
    const title = esc(item.project_title || item.project_name || 'Untitled');
    const client = esc(item.client_name || '');
    const docNo = esc(item.doc_number || '');
    const updated = item.updated_at
      ? new Date(item.updated_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
      : '';
    const meta = [client, docNo].filter(Boolean).join(' · ');
    const isNew = type === 'questionnaire' && item.status === 'submitted';
    return `
      <div class="doc-card" data-id="${item.id}" data-type="${type}">
        <button type="button" class="doc-card__delete" title="Delete document" aria-label="Delete document">&times;</button>
        <div class="doc-card__type doc-card__type--${type}">${TYPE_LABELS[type]}</div>
        ${isNew ? '<div class="doc-card__new">New</div>' : ''}
        <div class="doc-card__thumb">
          <img src="assets/logo.svg" alt="Propello" />
          <div class="doc-card__thumb-title">${title}</div>
        </div>
        <div class="doc-card__body">
          <div class="doc-card__title" title="${title}">${title}</div>
          ${approvalBadgeHtml(item.content)}
          ${meta ? `<div class="doc-card__meta">${meta}</div>` : ''}
          <div class="doc-card__meta">${updated}</div>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.doc-card').forEach(el => {
    const id = el.dataset.id;
    const type = el.dataset.type;

    el.addEventListener('click', () => {
      if (type === 'questionnaire') {
        window.location.href = `requirements.html?submission=${encodeURIComponent(id)}`;
      } else {
        window.location.href = `index.html?open=${encodeURIComponent(id)}`;
      }
    });

    el.querySelector('.doc-card__delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this document? This cannot be undone.')) return;
      if (type === 'questionnaire') {
        const { error } = await deleteQuestionnaire(id);
        if (error) { alert('Could not delete: ' + (error.message || error)); return; }
        allQuestionnaires = allQuestionnaires.filter(q => q.id !== id);
      } else {
        const { error } = await deleteProposal(id);
        if (error) { alert('Could not delete: ' + (error.message || error)); return; }
        allProposals = allProposals.filter(p => p.id !== id);
      }
      applyFilter();
    });
  });
}

/* Sample templates — industry-tailored starting points (one click into the generator). */
function renderTemplates() {
  const grid = $('templateGrid');
  if (!grid) return;
  const templates = getIndustryTemplates();
  grid.innerHTML = templates.map((t) => {
    const items = (t.scopeItems || []).slice(0, 3).map((s) => `<li>${esc(s)}</li>`).join('');
    return `
      <button type="button" class="tmpl-card" data-template="${esc(t.id)}">
        <span class="tmpl-card__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </span>
        <span class="tmpl-card__name">${esc(t.name)}</span>
        <span class="tmpl-card__summary">${esc(t.summary || '')}</span>
        <ul class="tmpl-card__items">${items}</ul>
        <span class="tmpl-card__cta">Use template &rarr;</span>
      </button>
    `;
  }).join('');
  grid.querySelectorAll('.tmpl-card').forEach((el) => {
    el.addEventListener('click', () => {
      window.location.href = `index.html?template=${encodeURIComponent(el.dataset.template)}`;
    });
  });
}

async function loadAll() {
  const grid = $('dashGrid');
  grid.innerHTML = '<p class="dash-page__empty">Loading…</p>';
  try {
    [allProposals, allQuestionnaires] = await Promise.all([
      fetchUserProposals(),
      fetchUserQuestionnaires(),
    ]);
    applyFilter();
  } catch (err) {
    grid.innerHTML = '<p class="dash-page__empty">Could not load documents. Please try refreshing.</p>';
  }
}

function setFilter(type) {
  activeFilter = type;
  document.querySelectorAll('.dash-page__tab').forEach(tab => {
    const active = tab.dataset.type === type;
    tab.classList.toggle('dash-page__tab--active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  applyFilter();
}

function getDashboardQuickSearchItems() {
  return mergeItems().map((item) => {
    const type = getDocType(item);
    const title = item.project_title || item.project_name || 'Untitled';
    const meta = [item.client_name, item.doc_number, TYPE_LABELS[type]].filter(Boolean).join(' · ');
    const keywords = [item.project_title, item.project_name, item.client_name, item.doc_number, item.project_type, item.status].filter(Boolean).join(' ');
    return {
      id: item.id,
      kind: type,
      kindLabel: TYPE_LABELS[type],
      title,
      meta,
      keywords,
      row: item,
    };
  });
}

function openDashboardQuickSearchResult(item) {
  if (!item) return;
  if (item.kind === 'questionnaire') {
    window.location.href = `requirements.html?submission=${encodeURIComponent(item.id)}`;
    return;
  }
  window.location.href = `index.html?open=${encodeURIComponent(item.id)}`;
}

async function updateAuthState(session) {
  if (session === undefined) session = await getSession();

  const authGate = $('authGate');
  const appBody = $('appBody');

  if (session) {
    // Hide auth gate, show app
    if (authGate) authGate.hidden = true;
    if (appBody) appBody.style.visibility = 'visible';
    const greetingEl = $('dashGreeting');
    if (greetingEl) {
      const fullName = (session.user.user_metadata && session.user.user_metadata.full_name) || '';
      const first = fullName.trim().split(/\s+/)[0] || (session.user.email || '').split('@')[0];
      greetingEl.textContent = first ? `Welcome back, ${first}` : 'Welcome back';
    }
    loadAll();
  } else {
    // Show auth gate
    if (authGate) authGate.hidden = false;
    if (appBody) appBody.style.visibility = 'hidden';
  }
}

let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === 'login';
  $('authSubmit').textContent = isLogin ? 'Log in' : 'Create account';
  $('authNameField').hidden = isLogin;
  $('authName').required = !isLogin;
  setAuthIndustryOnboardingVisible(!isLogin);
  $('authTabLogin').classList.toggle('btn--primary', isLogin);
  $('authTabLogin').classList.toggle('btn--ghost', !isLogin);
  $('authTabSignup').classList.toggle('btn--primary', !isLogin);
  $('authTabSignup').classList.toggle('btn--ghost', isLogin);
  $('authTabLogin').setAttribute('aria-pressed', String(isLogin));
  $('authTabSignup').setAttribute('aria-pressed', String(!isLogin));
}

async function handleAuth(e) {
  e.preventDefault();
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const name = $('authName').value.trim();
  const errEl = $('authError');
  const industryProfile = authMode === 'signup' ? collectAuthIndustryMetadata() : null;
  errEl.hidden = true;
  if (authMode === 'signup' && !isIndustryMetadataComplete(industryProfile)) {
    errEl.textContent = 'Please choose an industry and answer the setup questions.';
    errEl.hidden = false;
    return;
  }
  $('authSubmit').disabled = true;
  try {
    const { data, error } = authMode === 'login'
      ? await signIn(email, password)
      : await signUp(email, password, name, industryProfile);
    if (error) {
      errEl.textContent = error.message || String(error);
      errEl.hidden = false;
    } else {
      updateAuthState(data?.session);
    }
  } catch (err) {
    errEl.textContent = 'Something went wrong. Please try again.';
    errEl.hidden = false;
  } finally {
    $('authSubmit').disabled = false;
  }
}

function init() {
  // Show auth gate by default until we know auth state
  const authGate = $('authGate');
  const appBody = $('appBody');

  // Fast pre-check: if no session token in storage, show auth gate immediately
  try {
    const hasStored = Object.keys(localStorage).some(k => k.includes('-auth-token'));
    if (!hasStored) {
      if (authGate) authGate.hidden = false;
      if (appBody) appBody.style.visibility = 'hidden';
    }
  } catch { /* ignore */ }

  onAuthChange(session => updateAuthState(session));

  // Auth gate form wiring
  setupAuthIndustryOnboarding();
  $('authTabLogin').addEventListener('click', () => setAuthMode('login'));
  $('authTabSignup').addEventListener('click', () => setAuthMode('signup'));
  $('authForm').addEventListener('submit', handleAuth);

  // Tab/filter/search wiring
  document.querySelectorAll('.dash-page__tab').forEach(tab => {
    tab.addEventListener('click', () => setFilter(tab.dataset.type));
  });
  $('dashSearch').addEventListener('input', e => {
    searchQuery = e.target.value;
    applyFilter();
  });

  renderTemplates();
  initLayout({ activePage: 'dashboard' });
  createQuickSearch({
    buttonId: 'dashQuickSearchBtn',
    title: 'Quick Search',
    subtitle: 'Jump to proposals, invoices, and questionnaires.',
    placeholder: 'Search by title, client, doc no., or keyword',
    getItems: getDashboardQuickSearchItems,
    onSelect: openDashboardQuickSearchResult,
  });
}

document.addEventListener('DOMContentLoaded', init);

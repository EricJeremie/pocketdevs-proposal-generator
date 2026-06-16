'use strict';

import {
  getSession, signIn, signUp, signOut, onAuthChange,
  fetchUserProposals, fetchUserQuestionnaires,
  deleteProposal, deleteQuestionnaire,
} from './supabase.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
    return `
      <div class="doc-card" data-id="${item.id}" data-type="${type}">
        <button type="button" class="doc-card__delete" title="Delete document" aria-label="Delete document">&times;</button>
        <div class="doc-card__type doc-card__type--${type}">${TYPE_LABELS[type]}</div>
        <div class="doc-card__thumb">
          <img src="assets/logo.svg" alt="PocketDevs" />
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

async function updateAuthState() {
  const session = await getSession();
  const loginPrompt = $('loginPrompt');
  const dashContent = $('dashContent');
  const authNavBtn = $('authNavBtn');
  const userMenu = $('userMenu');
  const greeting = $('authGreeting');

  if (session) {
    const meta = session.user.user_metadata || {};
    const name = meta.full_name || session.user.email || '';
    const firstName = name.trim().split(/\s+/)[0];

    authNavBtn.hidden = true;
    userMenu.hidden = false;
    $('userMenuBtn').textContent = firstName.charAt(0).toUpperCase();
    $('userMenuBtn').title = name.trim();
    greeting.hidden = false;
    greeting.textContent = `Hi, ${firstName}!`;

    loginPrompt.hidden = true;
    dashContent.hidden = false;
    loadAll();
  } else {
    authNavBtn.hidden = false;
    userMenu.hidden = true;
    greeting.hidden = true;
    loginPrompt.hidden = false;
    dashContent.hidden = true;
  }
}

let authMode = 'login';

function showAuthModal() {
  $('authModal').classList.add('modal--visible');
  $('authEmail').focus();
}
function hideAuthModal() {
  $('authModal').classList.remove('modal--visible');
}
function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === 'login';
  $('authTitle').textContent = isLogin ? 'Sign in to PocketDevs' : 'Create an account';
  $('authSubmit').textContent = isLogin ? 'Login' : 'Create account';
  $('authNameField').hidden = isLogin;
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
  errEl.hidden = true;
  $('authSubmit').disabled = true;
  try {
    const { error } = authMode === 'login'
      ? await signIn(email, password)
      : await signUp(email, password, name);
    if (error) {
      errEl.textContent = error.message || String(error);
      errEl.hidden = false;
    } else {
      hideAuthModal();
      updateAuthState();
    }
  } finally {
    $('authSubmit').disabled = false;
  }
}

function init() {
  updateAuthState();
  onAuthChange(() => updateAuthState());

  document.querySelectorAll('.dash-page__tab').forEach(tab => {
    tab.addEventListener('click', () => setFilter(tab.dataset.type));
  });
  $('dashSearch').addEventListener('input', e => {
    searchQuery = e.target.value;
    applyFilter();
  });

  $('authNavBtn').addEventListener('click', showAuthModal);
  $('loginPromptBtn').addEventListener('click', showAuthModal);
  $('closeAuth').addEventListener('click', hideAuthModal);
  $('authModal').addEventListener('click', e => { if (e.target === $('authModal')) hideAuthModal(); });
  $('authTabLogin').addEventListener('click', () => setAuthMode('login'));
  $('authTabSignup').addEventListener('click', () => setAuthMode('signup'));
  $('authForm').addEventListener('submit', handleAuth);

  $('userMenuBtn').addEventListener('click', e => {
    e.stopPropagation();
    const dd = $('userMenuDropdown');
    const open = dd.hidden;
    dd.hidden = !open;
    $('userMenuBtn').setAttribute('aria-expanded', String(open));
  });
  $('userMenuLogout').addEventListener('click', async () => {
    $('userMenuDropdown').hidden = true;
    await signOut();
    updateAuthState();
  });
  document.addEventListener('click', e => {
    const menu = $('userMenu');
    if (!menu.hidden && !menu.contains(e.target)) $('userMenuDropdown').hidden = true;
  });
}

document.addEventListener('DOMContentLoaded', init);

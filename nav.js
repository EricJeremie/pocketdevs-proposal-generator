'use strict';
import { signOut, onAuthChange } from './supabase.js';

export function initNav({ activePage = '', onSettings = null } = {}) {
  if (document.getElementById('navSidebar')) return; // already injected

  // Inject backdrop + sidebar
  const backdrop = document.createElement('div');
  backdrop.id = 'navBackdrop';
  backdrop.className = 'nav-backdrop';
  document.body.appendChild(backdrop);

  const aside = document.createElement('aside');
  aside.id = 'navSidebar';
  aside.className = 'nav-sidebar';
  aside.setAttribute('aria-label', 'Navigation menu');
  aside.innerHTML = `
    <div class="nav-sidebar__head">
      <img src="assets/logo.svg" alt="PocketDevs" class="nav-sidebar__logo" />
      <button id="navCloseBtn" class="nav-sidebar__close" type="button" aria-label="Close menu">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div id="navUser" class="nav-sidebar__user" hidden>
      <div id="navUserAvatar" class="nav-sidebar__avatar">U</div>
      <div class="nav-sidebar__user-info">
        <div id="navUserName" class="nav-sidebar__username"></div>
        <div id="navUserEmail" class="nav-sidebar__useremail"></div>
      </div>
    </div>
    <nav class="nav-sidebar__nav">
      <a href="dashboard.html" class="nav-sidebar__item" data-page="dashboard">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        My Documents
      </a>
      <a href="index.html" class="nav-sidebar__item" data-page="proposal">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        Proposal
      </a>
      <a href="index.html?mode=invoice" class="nav-sidebar__item" data-page="invoice">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        Invoice
      </a>
      <a href="requirements.html" class="nav-sidebar__item" data-page="requirements">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        Requirements
      </a>
      <button type="button" id="navSettingsBtn" class="nav-sidebar__item" data-page="settings">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Settings
      </button>
    </nav>
    <div class="nav-sidebar__footer">
      <button id="navLoginBtn" type="button" class="nav-sidebar__item" hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
        Log in
      </button>
      <button id="navLogoutBtn" type="button" class="nav-sidebar__logout" hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Log out
      </button>
    </div>
  `;
  document.body.appendChild(aside);

  // Mark active page
  if (activePage) {
    document.querySelectorAll(`.nav-sidebar__item[data-page="${activePage}"]`)
      .forEach(el => el.classList.add('nav-sidebar__item--active'));
  }

  function openNav() {
    aside.classList.add('nav-sidebar--open');
    backdrop.classList.add('nav-backdrop--open');
    document.body.style.overflow = 'hidden';
  }
  function closeNav() {
    aside.classList.remove('nav-sidebar--open');
    backdrop.classList.remove('nav-backdrop--open');
    document.body.style.overflow = '';
  }

  document.getElementById('hamburgerBtn')?.addEventListener('click', openNav);
  document.getElementById('navCloseBtn').addEventListener('click', closeNav);
  backdrop.addEventListener('click', closeNav);

  document.getElementById('navSettingsBtn').addEventListener('click', () => {
    closeNav();
    if (onSettings) onSettings();
    else window.location.href = 'index.html';
  });

  document.getElementById('navLoginBtn').addEventListener('click', () => {
    closeNav();
    // trigger whichever Login button exists on this page
    (document.getElementById('authNavBtn') || document.getElementById('rqAuthBtn'))?.click();
  });

  document.getElementById('navLogoutBtn').addEventListener('click', async () => {
    closeNav();
    await signOut();
    window.location.reload();
  });

  function updateSidebarAuth(session) {
    const userEl = document.getElementById('navUser');
    const loginBtn = document.getElementById('navLoginBtn');
    const logoutBtn = document.getElementById('navLogoutBtn');
    if (session) {
      const meta = session.user.user_metadata || {};
      const name = meta.full_name || session.user.email || '';
      const email = session.user.email || '';
      const initials = name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || 'U';
      document.getElementById('navUserAvatar').textContent = initials;
      document.getElementById('navUserName').textContent = name;
      document.getElementById('navUserEmail').textContent = email;
      userEl.hidden = false;
      loginBtn.hidden = true;
      logoutBtn.hidden = false;
    } else {
      userEl.hidden = true;
      loginBtn.hidden = false;
      logoutBtn.hidden = true;
    }
  }

  onAuthChange(session => updateSidebarAuth(session));
}

'use strict';
import { signOut, onAuthChange, getSession } from './supabase.js';

// Inject the full app shell: sidebar + mobile top bar
export function initLayout({ activePage = '', onSettings = null } = {}) {
  if (document.getElementById('appSidebar')) return;

  // Mobile top bar (shown only on small screens)
  const mobileBar = document.createElement('div');
  mobileBar.className = 'app-mobile-bar no-print';
  mobileBar.innerHTML = `
    <button id="sidebarToggle" class="app-mobile-bar__hamburger" type="button" aria-label="Open menu">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
    <img src="assets/logo.svg" alt="PocketDevs" class="app-mobile-bar__logo" />
  `;
  document.body.prepend(mobileBar);

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.id = 'sidebarBackdrop';
  backdrop.className = 'app-sidebar-backdrop';
  document.body.appendChild(backdrop);

  // Sidebar
  const sidebar = document.createElement('aside');
  sidebar.id = 'appSidebar';
  sidebar.className = 'app-sidebar no-print';
  sidebar.setAttribute('aria-label', 'Navigation');
  sidebar.innerHTML = `
    <div class="app-sidebar__brand">
      <div class="app-sidebar__logo-wrap">
        <img src="assets/logo.svg" alt="PocketDevs" class="app-sidebar__logo" />
      </div>
    </div>
    <button id="sidebarCollapseBtn" class="app-sidebar__collapse-btn" type="button" aria-label="Collapse sidebar">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <div id="sidebarUser" class="app-sidebar__user" hidden>
      <div id="sidebarAvatar" class="app-sidebar__avatar">E</div>
      <div class="app-sidebar__user-info">
        <div id="sidebarUserName" class="app-sidebar__username"></div>
        <div id="sidebarUserEmail" class="app-sidebar__useremail"></div>
      </div>
    </div>
    <nav class="app-sidebar__nav">
      <a href="dashboard.html" class="app-sidebar__item" data-page="dashboard" title="My Documents">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        <span class="app-sidebar__label">My Documents</span>
      </a>
      <div class="app-sidebar__divider"></div>
      <a href="index.html" class="app-sidebar__item" data-page="proposal" title="Proposal">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span class="app-sidebar__label">Proposal</span>
      </a>
      <a href="index.html?mode=invoice" class="app-sidebar__item" data-page="invoice" title="Invoice">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        <span class="app-sidebar__label">Invoice</span>
      </a>
      <a href="requirements.html" class="app-sidebar__item" data-page="requirements" title="Requirements">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <span class="app-sidebar__label">Requirements</span>
      </a>
    </nav>
    <div class="app-sidebar__footer">
      <button id="sidebarSettingsBtn" type="button" class="app-sidebar__item" data-page="settings" title="Settings">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span class="app-sidebar__label">Settings</span>
      </button>
      <button id="sidebarLogoutBtn" type="button" class="app-sidebar__logout" hidden title="Log out">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        <span class="app-sidebar__label">Log out</span>
      </button>
    </div>
  `;
  document.body.appendChild(sidebar);

  // Collapsible sidebar (desktop) — persisted across pages
  const COLLAPSE_KEY = 'pd-sidebar-collapsed';
  function setCollapsed(collapsed) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    document.getElementById('sidebarCollapseBtn').setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }
  let storedCollapsed = false;
  try { storedCollapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { /* ignore */ }
  setCollapsed(storedCollapsed);
  document.getElementById('sidebarCollapseBtn').addEventListener('click', () => {
    setCollapsed(!document.body.classList.contains('sidebar-collapsed'));
  });

  // Active page highlight
  if (activePage) {
    document.querySelectorAll(`.app-sidebar__item[data-page="${activePage}"]`)
      .forEach(el => el.classList.add('app-sidebar__item--active'));
  }

  function openSidebar() {
    sidebar.classList.add('app-sidebar--open');
    backdrop.classList.add('app-sidebar-backdrop--open');
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    sidebar.classList.remove('app-sidebar--open');
    backdrop.classList.remove('app-sidebar-backdrop--open');
    document.body.style.overflow = '';
  }

  document.getElementById('sidebarToggle')?.addEventListener('click', openSidebar);
  backdrop.addEventListener('click', closeSidebar);

  document.getElementById('sidebarSettingsBtn').addEventListener('click', () => {
    closeSidebar();
    if (onSettings) onSettings();
    else window.location.href = 'index.html';
  });

  document.getElementById('sidebarLogoutBtn').addEventListener('click', async () => {
    closeSidebar();
    await signOut();
    window.location.replace('dashboard.html');
  });

  function updateSidebarUser(session) {
    const userEl = document.getElementById('sidebarUser');
    const logoutBtn = document.getElementById('sidebarLogoutBtn');
    if (session) {
      const meta = session.user.user_metadata || {};
      const name = meta.full_name || session.user.email || '';
      const email = session.user.email || '';
      const initials = name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || 'U';
      document.getElementById('sidebarAvatar').textContent = initials;
      document.getElementById('sidebarUserName').textContent = name;
      document.getElementById('sidebarUserEmail').textContent = email;
      userEl.hidden = false;
      logoutBtn.hidden = false;
    } else {
      userEl.hidden = true;
      logoutBtn.hidden = true;
    }
  }

  onAuthChange(session => updateSidebarUser(session));
}

// Keep backward-compatible alias
export { initLayout as initNav };

/* ============================================================
   PocketDevs Proposal Generator - Supabase Integration
   Resilient by design: the SDK is loaded lazily and every
   export degrades gracefully. A Supabase/CDN failure must NEVER
   break the app — auth + history are optional features.
   ============================================================ */
'use strict';

export const SUPABASE_URL = 'https://xiykfvyjavkkmfqujcql.supabase.co';
const SUPABASE_KEY = 'sb_publishable_CoqmS7OUcHBQ55Ho22xgyg_RYYtUoLk';
export const SUPABASE_ANON_KEY = SUPABASE_KEY;

let _client = null;
let _failed = false;
let _initPromise = null;

/* Lazily import the SDK and create the client. NEVER throws — resolves to
   the client, or null if Supabase is unavailable (offline, CDN blocked, etc.). */
export function getClient() {
  if (_client) return Promise.resolve(_client);
  if (_failed) return Promise.resolve(null);
  if (!_initPromise) {
    _initPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
      .then(({ createClient }) => {
        _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: true, autoRefreshToken: true },
        });
        return _client;
      })
      .catch((err) => {
        console.warn('Supabase unavailable — running without auth/history:', err && err.message);
        _failed = true;
        return null;
      });
  }
  return _initPromise;
}

export async function isAuthAvailable() { return !!(await getClient()); }

export async function getSession() {
  const sb = await getClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) { console.warn('Supabase session error:', error.message); return null; }
    return (data && data.session) || null;
  } catch (err) {
    console.warn('Failed to get session:', err && err.message);
    return null;
  }
}

export async function signIn(email, password) {
  const sb = await getClient();
  if (!sb) return { error: { message: 'Accounts are offline right now — you can still generate proposals.' } };
  try { return await sb.auth.signInWithPassword({ email, password }); }
  catch (err) { return { error: { message: err.message || 'Sign-in failed.' } }; }
}

export async function signUp(email, password, fullName) {
  const sb = await getClient();
  if (!sb) return { error: { message: 'Accounts are offline right now — you can still generate proposals.' } };
  try { return await sb.auth.signUp({ email, password, options: { data: { full_name: fullName || '' } } }); }
  catch (err) { return { error: { message: err.message || 'Sign-up failed.' } }; }
}

export async function signOut() {
  const sb = await getClient();
  if (!sb) return;
  try { await sb.auth.signOut(); } catch (err) { /* ignore */ }
}

export function onAuthChange(cb) {
  getClient().then((sb) => { if (sb) sb.auth.onAuthStateChange((_evt, session) => cb(session)); });
}

/* ---------- Database Ops (best-effort; columns match the table) ---------- */
export async function saveProposal(proposalData) {
  const sb = await getClient();
  if (!sb) return { error: 'offline' };
  const session = await getSession();
  if (!session) return { error: 'not-authenticated' };
  try {
    const row = {
      user_id: session.user.id,
      doc_number: (proposalData.meta && proposalData.meta.documentNumber) || null,
      project_title: (proposalData.meta && proposalData.meta.title) || null,
      client_name: (proposalData.client && proposalData.client.company) || null,
      content: proposalData,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await sb
      .from('proposals')
      .upsert(row, { onConflict: 'user_id,doc_number' })
      .select();
    return { data, error };
  } catch (err) {
    console.error('Save proposal failed:', err);
    return { error: err.message };
  }
}

export async function fetchUserProposals() {
  const sb = await getClient();
  if (!sb) return [];
  const session = await getSession();
  if (!session) return [];
  try {
    const { data, error } = await sb
      .from('proposals')
      .select('*')
      .eq('user_id', session.user.id)
      .order('updated_at', { ascending: false });
    if (error) { console.warn('Error fetching proposals:', error.message); return []; }
    return data || [];
  } catch (err) {
    console.warn('Fetch proposals exception:', err && err.message);
    return [];
  }
}

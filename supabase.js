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
  getClient().then((sb) => {
    if (!sb) { cb(null); return; }
    sb.auth.onAuthStateChange((_evt, session) => cb(session));
  });
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

export async function deleteProposal(id) {
  const sb = await getClient();
  if (!sb) return { error: 'offline' };
  const session = await getSession();
  if (!session) return { error: 'not-authenticated' };
  try {
    const { error } = await sb
      .from('proposals')
      .delete()
      .eq('id', id)
      .eq('user_id', session.user.id);
    return { error };
  } catch (err) {
    console.error('Delete proposal failed:', err);
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

export async function fetchProposalById(id) {
  const sb = await getClient();
  if (!sb) return null;
  const session = await getSession();
  if (!session) return null;
  try {
    const { data, error } = await sb
      .from('proposals')
      .select('*')
      .eq('id', id)
      .eq('user_id', session.user.id)
      .single();
    if (error) { console.warn('Error fetching proposal by id:', error.message); return null; }
    return data;
  } catch (err) {
    console.warn('Fetch proposal by id exception:', err && err.message);
    return null;
  }
}

export async function saveQuestionnaire(data) {
  const sb = await getClient();
  if (!sb) return { error: 'offline' };
  const session = await getSession();
  if (!session) return { error: 'not-authenticated' };
  try {
    const row = {
      user_id: session.user.id,
      client_name: data.client_name || null,
      project_name: data.project_name || null,
      project_type: data.project_type || null,
      answers: data.answers || {},
      srd_content: data.srd_content || null,
      doc_number: data.doc_number || null,
      status: data.status || 'submitted',
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
      const { data: d, error } = await sb
        .from('questionnaire_submissions')
        .update(row)
        .eq('id', data.id)
        .eq('user_id', session.user.id)
        .select();
      return { data: d, error };
    }
    const { data: d, error } = await sb
      .from('questionnaire_submissions')
      .insert(row)
      .select();
    return { data: d, error };
  } catch (err) {
    console.error('Save questionnaire failed:', err);
    return { error: err.message };
  }
}

export async function fetchUserQuestionnaires() {
  const sb = await getClient();
  if (!sb) return [];
  const session = await getSession();
  if (!session) return [];
  try {
    const { data, error } = await sb
      .from('questionnaire_submissions')
      .select('*')
      .eq('user_id', session.user.id)
      .order('updated_at', { ascending: false });
    if (error) { console.warn('Error fetching questionnaires:', error.message); return []; }
    return data || [];
  } catch (err) {
    console.warn('Fetch questionnaires exception:', err && err.message);
    return [];
  }
}

export async function deleteQuestionnaire(id) {
  const sb = await getClient();
  if (!sb) return { error: 'offline' };
  const session = await getSession();
  if (!session) return { error: 'not-authenticated' };
  try {
    const { error } = await sb
      .from('questionnaire_submissions')
      .delete()
      .eq('id', id)
      .eq('user_id', session.user.id);
    return { error };
  } catch (err) {
    console.error('Delete questionnaire failed:', err);
    return { error: err.message };
  }
}

export async function fetchSubmissionById(id) {
  const sb = await getClient();
  if (!sb) return null;
  const session = await getSession();
  if (!session) return null;
  try {
    const { data, error } = await sb
      .from('questionnaire_submissions')
      .select('*')
      .eq('id', id)
      .eq('user_id', session.user.id)
      .single();
    if (error) { console.warn('Error fetching submission by id:', error.message); return null; }
    return data;
  } catch (err) {
    console.warn('Fetch submission by id exception:', err && err.message);
    return null;
  }
}

/* Anonymous client submits a questionnaire to an owner via an invite link.
   Goes through the submit-questionnaire edge function (service role insert),
   so no client account is needed. Returns { ok } or { error }. */
/* ---------- User Account Updates ---------- */

export async function updateUserProfile({ fullName, avatarDataUrl } = {}) {
  const sb = await getClient();
  if (!sb) return { error: { message: 'Offline — cannot update profile.' } };
  const data = {};
  if (fullName !== undefined) data.full_name = fullName;
  if (avatarDataUrl !== undefined) data.avatar_url = avatarDataUrl;
  try { return await sb.auth.updateUser({ data }); }
  catch (err) { return { error: { message: err.message || 'Profile update failed.' } }; }
}

export async function updateUserEmail(newEmail) {
  const sb = await getClient();
  if (!sb) return { error: { message: 'Offline — cannot update email.' } };
  try { return await sb.auth.updateUser({ email: newEmail }); }
  catch (err) { return { error: { message: err.message || 'Email update failed.' } }; }
}

export async function updateUserPassword(newPassword) {
  const sb = await getClient();
  if (!sb) return { error: { message: 'Offline — cannot update password.' } };
  try { return await sb.auth.updateUser({ password: newPassword }); }
  catch (err) { return { error: { message: err.message || 'Password update failed.' } }; }
}

export async function submitClientQuestionnaire(ownerId, answers) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-questionnaire`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ ownerId, answers }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { error: (data && data.error && data.error.message) || `Submission failed (HTTP ${res.status}).` };
    }
    return { ok: true };
  } catch (err) {
    return { error: err.message || 'Network error while submitting.' };
  }
}

/* ---------- Live Sharing / Collaboration ---------- */

/* Owner-only: turn sharing on for a doc they own (RLS enforces ownership).
   Reuses an existing token so the link stays stable. Returns { token } or { error }. */
export async function enableShare(proposalId) {
  const sb = await getClient();
  if (!sb) return { error: { message: 'Offline — cannot enable sharing.' } };
  const session = await getSession();
  if (!session) return { error: { message: 'Sign in to share a document.' } };
  try {
    // Reuse the token if it already exists.
    const { data: existing } = await sb
      .from('proposals').select('share_token').eq('id', proposalId).single();
    if (existing && existing.share_token) return { token: existing.share_token };

    const token = (crypto.randomUUID && crypto.randomUUID()) ||
      ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
    const { error } = await sb
      .from('proposals').update({ share_token: token }).eq('id', proposalId);
    if (error) return { error };
    return { token };
  } catch (err) {
    return { error: { message: err.message || 'Could not enable sharing.' } };
  }
}

/* Owner-only: revoke sharing — the link stops working immediately. */
export async function disableShare(proposalId) {
  const sb = await getClient();
  if (!sb) return { error: { message: 'Offline.' } };
  try {
    const { error } = await sb
      .from('proposals').update({ share_token: null }).eq('id', proposalId);
    return { error };
  } catch (err) {
    return { error: { message: err.message || 'Could not stop sharing.' } };
  }
}

/* Anonymous (or any) link-holder: load the one shared doc by token. */
export async function getSharedDoc(token) {
  const sb = await getClient();
  if (!sb) return { error: { message: 'Offline — cannot open shared document.' } };
  try {
    const { data, error } = await sb.rpc('get_shared_proposal', { p_token: token });
    if (error) return { error };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { error: { message: 'not-found' } };
    return { doc: row };
  } catch (err) {
    return { error: { message: err.message || 'Could not open shared document.' } };
  }
}

/* Anonymous (or any) link-holder: persist the shared doc's content by token. */
export async function saveSharedDoc(token, content) {
  const sb = await getClient();
  if (!sb) return { error: { message: 'Offline.' } };
  try {
    const { data, error } = await sb.rpc('save_shared_proposal', { p_token: token, p_content: content });
    if (error) return { error };
    return { ok: data === true };
  } catch (err) {
    return { error: { message: err.message || 'Could not save.' } };
  }
}

/* Realtime channel for a shared doc. Broadcasts edits and tracks presence.
   handlers: { onEdit(html, fromId), onPresence(participants) }.
   Returns { broadcast(html), leave() } or null if realtime is unavailable. */
export async function createDocChannel(token, me, handlers = {}) {
  const sb = await getClient();
  if (!sb) return null;
  try {
    const channel = sb.channel(`proposal:${token}`, {
      config: { broadcast: { self: false }, presence: { key: me.id } },
    });

    channel.on('broadcast', { event: 'edit' }, (msg) => {
      const p = msg.payload || {};
      if (p.from === me.id) return;
      handlers.onEdit && handlers.onEdit(p.html, p.from);
    });

    if (handlers.onPresence) {
      const emit = () => {
        const state = channel.presenceState();
        const people = Object.values(state).flat();
        handlers.onPresence(people);
      };
      channel.on('presence', { event: 'sync' }, emit);
      channel.on('presence', { event: 'join' }, emit);
      channel.on('presence', { event: 'leave' }, emit);
    }

    await new Promise((resolve) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.track({ id: me.id, name: me.name, role: me.role, color: me.color });
          resolve();
        }
      });
    });

    return {
      broadcast(html) {
        channel.send({ type: 'broadcast', event: 'edit', payload: { html, from: me.id } });
      },
      async leave() {
        // Flush the presence "leave" before tearing down the socket, so other
        // clients see the avatar disappear immediately rather than after a
        // server-side reap timeout.
        try { await channel.untrack(); } catch { /* ignore */ }
        try { sb.removeChannel(channel); } catch { /* ignore */ }
      },
    };
  } catch (err) {
    console.warn('Realtime channel unavailable:', err && err.message);
    return null;
  }
}

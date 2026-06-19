const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xiykfvyjavkkmfqujcql.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_CoqmS7OUcHBQ55Ho22xgyg_RYYtUoLk';

async function verifySupabaseSession(token, { staffOnly = false } = {}) {
  if (!token) {
    return { ok: false, status: 401, message: 'You must be signed in to continue.' };
  }

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });

    if (!userRes.ok) {
      return { ok: false, status: 401, message: 'Your session is invalid or expired. Please sign in again.' };
    }

    const user = await userRes.json();
    if (!user || !user.id) {
      return { ok: false, status: 401, message: 'Your session is invalid or expired. Please sign in again.' };
    }

    if (staffOnly && user.app_metadata?.role !== 'staff') {
      return { ok: false, status: 403, message: 'This feature is restricted to verified PocketDevs staff.' };
    }

    return { ok: true, user };
  } catch {
    return { ok: false, status: 502, message: 'Could not verify your session. Please try again.' };
  }
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  verifySupabaseSession,
};

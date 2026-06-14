// generate-proposal — server-side proxy to the Anthropic Messages API.
// Holds ANTHROPIC_API_KEY as a Supabase secret so the browser never needs it.
// Set the secret:  Dashboard > Edge Functions > Manage secrets  (or `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`).
//
// Requires a signed-in user: the caller must send
// `Authorization: Bearer <supabase-session-access-token>`.

const SUPABASE_URL = 'https://xiykfvyjavkkmfqujcql.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_CoqmS7OUcHBQ55Ho22xgyg_RYYtUoLk';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405);

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) {
    return json({ error: { message: 'Server is missing ANTHROPIC_API_KEY. Set it as a Supabase secret.' } }, 501);
  }

  // --- Require a signed-in user ---
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return json({ error: { message: 'You must be signed in to generate a proposal.' } }, 401);
  }
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) {
      return json({ error: { message: 'Your session is invalid or expired. Please sign in again.' } }, 401);
    }
    const user = await userRes.json();
    if (!user || !user.id) {
      return json({ error: { message: 'Your session is invalid or expired. Please sign in again.' } }, 401);
    }
  } catch {
    return json({ error: { message: 'Could not verify your session. Please try again.' } }, 502);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: { message: 'Invalid JSON body' } }, 400);
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  } catch (e) {
    return json({ error: { message: 'Upstream request failed: ' + (e as Error).message } }, 502);
  }
});

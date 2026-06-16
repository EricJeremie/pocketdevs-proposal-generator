// generate-requirements — drafts a System Requirements Document from a client
// intake questionnaire. Calls the same GEMINI_API_KEY secret as generate-proposal.
// Requires a signed-in PocketDevs user so the key is never exposed to clients.

const SUPABASE_URL = 'https://xiykfvyjavkkmfqujcql.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_CoqmS7OUcHBQ55Ho22xgyg_RYYtUoLk';
const GEMINI_MODEL = 'gemini-2.5-flash';

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

function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (k === 'additionalProperties') continue;
      out[k] = toGeminiSchema(v);
    }
    return out;
  }
  return schema;
}

function formatAnswers(answers: Record<string, unknown>): string {
  const lines: string[] = [];
  const label = (key: string) => key.replace(/([A-Z])/g, ' $1').trim()
    .replace(/^./, (c) => c.toUpperCase());
  for (const [k, v] of Object.entries(answers)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    const val = Array.isArray(v) ? (v as string[]).join(', ') : String(v);
    lines.push(`${label(k)}: ${val}`);
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are a senior business analyst at PocketDevs, a software development agency in the Philippines. You write thorough, professional System Requirements Documents (SRDs) based on client questionnaire answers.

Rules:
- Write functional requirements as clear, testable statements ("The system shall…").
- Group functional requirements into logical feature modules (at least 6 modules, 3–8 requirements each).
- Non-functional requirements must cover performance, security, scalability, usability, and compatibility.
- Technical recommendations should be practical for a Philippine SME and aligned with PocketDevs' modern stack (React/Next.js, React Native, Node.js, Supabase/PostgreSQL, Vercel/AWS).
- Be specific. Never be vague.
- Use "[TBD]" only when information is truly missing.
- If budget seems low for the described scope, note this honestly in budgetNotes.`;

const SRD_SCHEMA = {
  type: 'object',
  properties: {
    projectName: { type: 'string' },
    projectType: { type: 'string' },
    projectOverview: { type: 'string' },
    businessObjectives: { type: 'array', items: { type: 'string' } },
    targetUsers: { type: 'string' },
    userRoles: { type: 'array', items: { type: 'string' } },
    functionalRequirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          module: { type: 'string' },
          description: { type: 'string' },
          requirements: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    nonFunctionalRequirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          requirements: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    technicalRecommendations: {
      type: 'object',
      properties: {
        stack: { type: 'string' },
        hosting: { type: 'string' },
        integrations: { type: 'array', items: { type: 'string' } },
        rationale: { type: 'string' },
      },
    },
    inScope: { type: 'array', items: { type: 'string' } },
    outOfScope: { type: 'array', items: { type: 'string' } },
    timelineEstimate: { type: 'string' },
    budgetNotes: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405);

  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) {
    return json({ error: { message: 'Server is missing GEMINI_API_KEY.' } }, 501);
  }

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return json({ error: { message: 'You must be signed in to generate an SRD.' } }, 401);
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

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: { message: 'Invalid JSON body' } }, 400); }

  const answers = body.answers as Record<string, unknown>;
  if (!answers || typeof answers !== 'object') {
    return json({ error: { message: 'Missing answers object in request body.' } }, 400);
  }

  const prompt = `Generate a complete System Requirements Document for this client project intake:\n\n${formatAnswers(answers)}\n\nBe thorough. Cover all SRD sections completely. Functional requirements should identify at least 6 distinct modules with specific, testable requirements each.`;

  const geminiBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      maxOutputTokens: 16000,
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(SRD_SCHEMA),
    },
  };

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(geminiBody) },
    );
    const data = await upstream.json();
    if (!upstream.ok) {
      return json({ error: { message: data?.error?.message || `Gemini error (HTTP ${upstream.status})` } }, upstream.status);
    }
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: Record<string, unknown>) => p.text || '').join('');
    if (!text) {
      const reason = data?.candidates?.[0]?.finishReason;
      return json({ error: { message: `Gemini returned no content${reason ? ` (${reason})` : ''}.` } }, 502);
    }
    let srd: unknown;
    try { srd = JSON.parse(text); }
    catch { return json({ error: { message: 'SRD response was not valid JSON.' } }, 502); }
    return json({ srd });
  } catch (e) {
    return json({ error: { message: 'Upstream request failed: ' + (e as Error).message } }, 502);
  }
});

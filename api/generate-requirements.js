const { verifySupabaseSession } = require('../lib/supabase');

const GEMINI_MODEL = 'gemini-2.5-flash';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function sendJson(res, obj, status = 200) {
  res.statusCode = status;
  for (const [key, value] of Object.entries(CORS)) res.setHeader(key, value);
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(obj));
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 300_000) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

const ANSWER_KEYS = [
  'contactName', 'contactCompany', 'contactEmail', 'contactIndustry',
  'projectType', 'projectName', 'projectDescription', 'projectProblem',
  'websiteType', 'websitePages', 'websiteCMS', 'websiteDesign', 'websiteFeatures', 'websiteIntegrations',
  'webappFeatures', 'webappAuth', 'webappRoles', 'webappAdmin', 'webappPayments', 'webappRealtime', 'webappIntegrations', 'webappData',
  'mobilePlatform', 'mobileTech', 'mobileCategory', 'mobileFeatures', 'mobileSpecial', 'mobileAppStore',
  'softwareType', 'softwareEnvironment', 'softwareUsers', 'softwarePerformance', 'softwareSecurity', 'softwareIntegrations',
  'targetUsers', 'userCount', 'devices', 'targetDate', 'flexibleTimeline', 'budgetRange', 'hasExisting',
  'references', 'techPreferences', 'mustHave', 'additionalNotes',
];

const SYSTEM_PROMPT = `You are a senior business analyst and systems architect at PocketDevs, a software development agency in the Philippines. You write System Requirements Documents (SRDs) that match the rigor and structure of an IEEE 830-style Software Requirements Specification — the kind a serious engineering team could build directly from, and a client could sign off on without confusion.

You will be given the raw answers a prospective client gave in an intake questionnaire. Your job is to transform those answers into a complete, internally consistent, professionally written SRD. You must reason about what the client actually described — their project type, the features they listed, the roles/users they mentioned, the integrations they named, their scale, and their constraints — and reflect ALL of it accurately in the document. Never contradict an answer the client gave. Never invent a feature, integration, or constraint the client did not ask for and that isn't a reasonable, clearly-labeled recommendation.

Hard rules:
- Be exhaustive but never vague. Every bullet should be specific and concrete — name actual screens, actual data fields, actual roles, actual third-party services the client mentioned (e.g. "GCash", "PayMongo", "QuickBooks", "Lazada/Shopee") rather than generic placeholders.
- Functional requirements must be written as testable "The system shall…" statements, one discrete behavior per requirement (no compound "and" statements bundling two behaviors).
- Group functional requirements into 6–10 logical modules (e.g. "Account & Authentication", "Catalog Management", "Order & Checkout", "Admin & Reporting", "Notifications", "Roles & Permissions" — pick module names that fit THIS project, do not reuse this list blindly). Each module needs 3–7 requirements.
- Tag every functional and non-functional requirement with a priority of exactly "Must", "Should", or "Could" (MoSCoW), based on how essential it is to the client's stated goals. Most core CRUD/auth/checkout flows are "Must"; nice-to-haves are "Should" or "Could".
- Non-functional requirements must cover at least these categories distinctly: Performance, Security, Scalability, Usability, Reliability & Availability, and Compatibility. Add Maintainability or Localization if relevant. Each category needs 2–4 specific, measurable requirements (real numbers: response times in seconds, uptime percentages, concurrent user counts — extrapolate sensible figures from the client's stated scale when they didn't give numbers).
- User classes must be derived from the roles/users the client actually described (e.g. if they said "Super Admin, Store Manager, Cashier, Customer", use exactly those, do not relabel them). If they described an app with no accounts, still include "Guest / Visitor" and any implicit operator-side class (e.g. "Internal Staff").
- Technical recommendations and the operating environment must be practical for a Philippine SME and aligned with PocketDevs' stack: React/Next.js or plain HTML/CSS/JS for web front-ends, React Native for cross-platform mobile (or native Swift/Kotlin only if the client explicitly asked for native), Node.js/Deno for back-ends, Supabase/PostgreSQL for data, Vercel/Supabase/AWS for hosting. Only deviate if the client's answers explicitly require something else.
- Fold the client's timeline and budget context into "Assumptions and Dependencies" as plain, honest statements (e.g. "The proposed timeline of 3 months assumes timely client feedback during UAT" or "The stated budget range is tight for the full scope described; a phased rollout is assumed"). If the budget genuinely looks too low for the scope described, say so plainly and honestly — do not sugar-coat it.
- Use "[TBD]" only when information is truly missing and cannot be reasonably inferred — never leave a field empty.
- Write in clear, plain, professional English. No marketing fluff, no filler sentences.
- Double-check internal consistency before responding: every user class mentioned in section 2 must appear somewhere in the functional requirements; every integration the client named must appear in Software Interfaces and/or the relevant functional module; the project type (website/web app/mobile app/custom software) must be reflected consistently across product perspective, operating environment, and interfaces. Make no mistakes.`;

const SRD_SCHEMA = {
  type: 'object',
  properties: {
    projectName: { type: 'string' },
    purpose: { type: 'string' },
    scope: { type: 'string' },
    definitions: { type: 'array', items: { type: 'object', properties: { term: { type: 'string' }, definition: { type: 'string' } } } },
    productPerspective: { type: 'string' },
    productFunctions: { type: 'array', items: { type: 'string' } },
    userClasses: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, technicalSkill: { type: 'string' } } } },
    operatingEnvironment: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } } } },
    designConstraints: { type: 'array', items: { type: 'string' } },
    assumptionsAndDependencies: { type: 'array', items: { type: 'string' } },
    functionalRequirements: { type: 'array', items: { type: 'object', properties: { module: { type: 'string' }, requirements: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, priority: { type: 'string', enum: ['Must', 'Should', 'Could'] } } } } } } },
    userInterfaces: { type: 'array', items: { type: 'string' } },
    hardwareInterfaces: { type: 'string' },
    softwareInterfaces: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } } },
    communicationInterfaces: { type: 'array', items: { type: 'string' } },
    nonFunctionalRequirements: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, requirements: { type: 'array', items: { type: 'string' } } } } },
    dataRequirements: { type: 'array', items: { type: 'string' } },
    legalAndCompliance: { type: 'array', items: { type: 'string' } },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
  },
};

const INTERVIEW_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    extractedFacts: { type: 'array', items: { type: 'object', properties: { key: { type: 'string', enum: ANSWER_KEYS }, value: { type: 'string' } } } },
    missingTopics: { type: 'array', items: { type: 'string' } },
    readyToGenerate: { type: 'boolean' },
  },
};

const REVISION_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    extractedFacts: INTERVIEW_SCHEMA.properties.extractedFacts,
    srd: SRD_SCHEMA,
  },
};

function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema && typeof schema === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'additionalProperties') continue;
      out[key] = toGeminiSchema(value);
    }
    return out;
  }
  return schema;
}

function formatAnswers(answers) {
  const lines = [];
  const label = (key) => key.replace(/([A-Z])/g, ' $1').trim().replace(/^./, (c) => c.toUpperCase());
  for (const [key, value] of Object.entries(answers || {})) {
    if (key.startsWith('__')) continue;
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    if (typeof value === 'object' && !Array.isArray(value)) continue;
    const val = Array.isArray(value) ? value.map(String).join(', ') : String(value);
    lines.push(`${label(key)}: ${val}`);
  }
  return lines.join('\n');
}

function sanitizeAnswers(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const source = input;
  const clean = {};
  for (const key of ANSWER_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) clean[key] = value.trim().slice(0, 5000);
    if (Array.isArray(value)) clean[key] = value.map(String).map((v) => v.slice(0, 1000)).slice(0, 30);
  }
  return clean;
}

function sanitizeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m) => m && typeof m === 'object')
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: String(m.content || '').trim().slice(0, 4000),
    }))
    .filter((m) => m.content)
    .slice(-30);
}

function formatConversation(messages) {
  return messages.map((m) => `${m.role === 'user' ? 'Staff' : 'Analyst'}: ${m.content}`).join('\n\n');
}

function factsToAnswers(value) {
  if (!Array.isArray(value)) return {};
  const allowed = new Set(ANSWER_KEYS);
  const extracted = {};
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const key = String(item.key || '');
    const val = String(item.value || '').trim();
    if (allowed.has(key) && val) extracted[key] = val.slice(0, 5000);
  }
  return extracted;
}

async function callGemini(key, prompt, schema, maxOutputTokens) {
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: {
            maxOutputTokens,
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(schema),
          },
        }),
      },
    );
    const data = await upstream.json();
    if (!upstream.ok) return { error: data?.error?.message || `Gemini error (HTTP ${upstream.status})`, status: upstream.status };
    const text = (data?.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('');
    if (!text) {
      const reason = data?.candidates?.[0]?.finishReason;
      return { error: `Gemini returned no content${reason ? ` (${reason})` : ''}.`, status: 502 };
    }
    try {
      return { value: JSON.parse(text) };
    } catch {
      return { error: 'The AI response was not valid JSON.', status: 502 };
    }
  } catch (error) {
    return { error: 'Upstream request failed: ' + error.message, status: 502 };
  }
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') {
    for (const [key, value] of Object.entries(CORS)) res.setHeader(key, value);
    res.statusCode = 200;
    res.end('ok');
    return;
  }

  if (req.method !== 'POST') {
    return sendJson(res, { error: { message: 'Method not allowed' } }, 405);
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return sendJson(res, { error: { message: 'Server is missing GEMINI_API_KEY. Set it as a Vercel env var.' } }, 501);

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > 250_000) return sendJson(res, { error: { message: 'Request body is too large.' } }, 413);

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const sessionCheck = await verifySupabaseSession(token, { staffOnly: true });
  if (!sessionCheck.ok) {
    return sendJson(res, { error: { message: sessionCheck.message } }, sessionCheck.status);
  }

  let body;
  try {
    body = JSON.parse(await readRawBody(req));
  } catch {
    return sendJson(res, { error: { message: 'Invalid JSON body.' } }, 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendJson(res, { error: { message: 'JSON body must be an object.' } }, 400);
  }
  if (JSON.stringify(body).length > 250_000) return sendJson(res, { error: { message: 'Request body is too large.' } }, 413);

  const action = typeof body.action === 'string' ? body.action : 'generate';
  if (!['interview', 'generate', 'revise'].includes(action)) {
    return sendJson(res, { error: { message: 'Unsupported requirements action.' } }, 400);
  }

  const answers = sanitizeAnswers(body.answers);
  const messages = sanitizeMessages(body.messages);

  if (action === 'interview') {
    if (!messages.some((m) => m.role === 'user')) return sendJson(res, { error: { message: 'Send at least one project description.' } }, 400);
    const prompt = `Act as a warm, precise requirements analyst conducting a conversational project intake. Do not write the SRD yet.

Your job for this turn:
1. Extract only facts the staff member explicitly stated or confirmed. Map them to these supported keys: ${ANSWER_KEYS.join(', ')}.
2. Ask exactly ONE focused follow-up question about the most important missing topic. Keep the reply concise and conversational.
3. Set readyToGenerate to true only when these core areas are sufficiently clear: product type and purpose; users and roles; core workflows/features; integrations or explicit absence of them; expected scale/devices; security or compliance needs; timeline/budget/constraints.
4. When ready, do not ask another question. Instead, briefly summarize the agreed scope, say it is ready to generate, return no missing topics, and set readyToGenerate to true.
5. Never invent requirements or silently treat a suggestion as confirmed. For projectType use exactly website, webapp, mobile, or software.

Already captured facts:
${formatAnswers(answers) || '[None yet]'}

Conversation:
${formatConversation(messages)}`;
    const result = await callGemini(key, prompt, INTERVIEW_SCHEMA, 3000);
    if (result.error) return sendJson(res, { error: { message: result.error } }, result.status || 502);
    return sendJson(res, {
      reply: String(result.value?.reply || ''),
      extractedAnswers: factsToAnswers(result.value?.extractedFacts),
      missingTopics: Array.isArray(result.value?.missingTopics) ? result.value.missingTopics : [],
      readyToGenerate: result.value?.readyToGenerate === true,
    });
  }

  if (!Object.keys(answers).length) return sendJson(res, { error: { message: 'No project requirements were provided.' } }, 400);

  if (action === 'revise') {
    const srd = body.srd;
    const instruction = String(body.instruction || messages.filter((m) => m.role === 'user').at(-1)?.content || '').trim().slice(0, 4000);
    if (!instruction) return sendJson(res, { error: { message: 'A revision instruction is required.' } }, 400);
    if (!srd || typeof srd !== 'object' || Array.isArray(srd) || JSON.stringify(srd).length > 180_000) {
      return sendJson(res, { error: { message: 'A valid current SRD is required for revision.' } }, 400);
    }
    const prompt = `Revise the complete SRD below according to the staff member's latest instruction. Return the FULL updated SRD, not a patch. Preserve every unaffected requirement, numbering structure, level of detail, and internal consistency. Update any affected user classes, interfaces, non-functional requirements, assumptions, and acceptance criteria so the document never contradicts itself. Extract newly confirmed facts into the supported answer keys when applicable.

Latest instruction:
${instruction}

Known project facts:
${formatAnswers(answers)}

Current SRD:
${JSON.stringify(srd)}`;
    const result = await callGemini(key, prompt, REVISION_SCHEMA, 24000);
    if (result.error) return sendJson(res, { error: { message: result.error } }, result.status || 502);
    if (!result.value?.srd) return sendJson(res, { error: { message: 'The revised SRD was missing from the AI response.' } }, 502);
    return sendJson(res, {
      reply: String(result.value.reply || 'The System Requirements Document has been updated.'),
      extractedAnswers: factsToAnswers(result.value.extractedFacts),
      srd: result.value.srd,
    });
  }

  const transcript = messages.length ? `\n\nSupporting interview transcript:\n${formatConversation(messages)}` : '';
  const prompt = `Generate a complete, detailed System Requirements Document for this client project intake. Use every relevant confirmed answer below — do not ignore any of it, and do not contradict it:

${formatAnswers(answers)}${transcript}

Be thorough and specific, matching the depth of a professional IEEE-830-style SRS: at least 6 functional requirement modules with 3–7 testable requirements each (each tagged Must/Should/Could), at least 6 non-functional requirement categories (Performance, Security, Scalability, Usability, Reliability & Availability, Compatibility) with 2–4 measurable requirements each, and user classes that match the roles described in the answers. Treat the structured answers as authoritative if the transcript contains earlier, superseded details. Make no mistakes — every section must stay internally consistent with the confirmed requirements.`;
  const result = await callGemini(key, prompt, SRD_SCHEMA, 24000);
  if (result.error) return sendJson(res, { error: { message: result.error } }, result.status || 502);
  return sendJson(res, { srd: result.value });
}

module.exports = handle;

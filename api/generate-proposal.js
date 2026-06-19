const { verifySupabaseSession } = require('../lib/supabase');

const GEMINI_MODEL = 'gemini-2.5-flash';
const BRIEF_BUCKET = 'proposal-briefs';
const MAX_BRIEF_BYTES = 12 * 1024 * 1024;

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

function toGeminiParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  if (!Array.isArray(content)) return [];

  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text') {
      parts.push({ text: block.text });
    } else if (block.type === 'document') {
      const source = block.source;
      if (source && source.type === 'base64') {
        parts.push({ inline_data: { mime_type: source.media_type, data: source.data } });
      }
    }
  }
  return parts;
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
  if (!key) {
    return sendJson(res, { error: { message: 'Server is missing GEMINI_API_KEY. Set it as a Vercel env var.' } }, 501);
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const sessionCheck = await verifySupabaseSession(token, { staffOnly: false });
  if (!sessionCheck.ok) {
    return sendJson(res, { error: { message: sessionCheck.message } }, sessionCheck.status);
  }

  let body;
  try {
    body = JSON.parse(await readRawBody(req));
  } catch {
    return sendJson(res, { error: { message: 'Invalid JSON body' } }, 400);
  }

  let storedDocument = null;
  const sourceDocument = body?.source_document;
  if (sourceDocument) {
    const path = typeof sourceDocument.path === 'string' ? sourceDocument.path : '';
    const expectedPrefix = `${sessionCheck.user.id}/`;
    const validPath = path.startsWith(expectedPrefix)
      && /^[0-9a-f-]{36}\/[A-Za-z0-9._-]+\.pdf$/i.test(path);
    if (sourceDocument.bucket !== BRIEF_BUCKET || !validPath) {
      return sendJson(res, { error: { message: 'Invalid source document reference.' } }, 400);
    }

    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    let documentRes;
    try {
      documentRes = await fetch(
        `${process.env.SUPABASE_URL || 'https://xiykfvyjavkkmfqujcql.supabase.co'}/storage/v1/object/authenticated/${BRIEF_BUCKET}/${encodedPath}`,
        {
          headers: {
            apikey: process.env.SUPABASE_ANON_KEY || 'sb_publishable_CoqmS7OUcHBQ55Ho22xgyg_RYYtUoLk',
            authorization: `Bearer ${token}`,
          },
        },
      );
    } catch {
      return sendJson(res, { error: { message: 'Document storage is temporarily unavailable. Please try again.' } }, 502);
    }
    if (!documentRes.ok) {
      return sendJson(res, { error: { message: 'Could not read the uploaded PDF. Please upload it again.' } }, 400);
    }
    const bytes = Buffer.from(await documentRes.arrayBuffer());
    if (bytes.length > MAX_BRIEF_BYTES) {
      return sendJson(res, { error: { message: 'The source PDF must be 12 MB or smaller.' } }, 413);
    }
    storedDocument = bytes.toString('base64');
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const contents = messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: toGeminiParts(message.content),
  }));
  if (storedDocument) {
    const firstUserMessage = contents.find((message) => message.role === 'user');
    if (!firstUserMessage) {
      return sendJson(res, { error: { message: 'A user message is required.' } }, 400);
    }
    firstUserMessage.parts.unshift({
      inline_data: { mime_type: 'application/pdf', data: storedDocument },
    });
  }

  const generationConfig = {
    maxOutputTokens: body?.max_tokens ?? 16000,
  };
  const outputConfig = body?.output_config;
  const format = outputConfig?.format;
  if (format?.schema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = toGeminiSchema(format.schema);
  }

  const geminiBody = { contents, generationConfig };
  if (body?.system) {
    geminiBody.systemInstruction = { parts: [{ text: body.system }] };
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(geminiBody),
      },
    );

    const data = await upstream.json();
    if (!upstream.ok) {
      const msg = (data && data.error && data.error.message) || `Gemini error (HTTP ${upstream.status})`;
      return sendJson(res, { error: { message: msg } }, upstream.status);
    }

    const candidate = data?.candidates?.[0];
    const text = (candidate?.content?.parts || [])
      .map((part) => part.text || '')
      .join('');

    if (!text) {
      const reason = candidate?.finishReason ? ` (finish reason: ${candidate.finishReason})` : '';
      return sendJson(res, { error: { message: `Gemini returned no content${reason}.` } }, 502);
    }

    return sendJson(res, { content: [{ type: 'text', text }] });
  } catch (error) {
    return sendJson(res, { error: { message: 'Upstream request failed: ' + error.message } }, 502);
  }
}

module.exports = handle;

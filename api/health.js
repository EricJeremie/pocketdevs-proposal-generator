function sendJson(res, obj, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(obj));
}

module.exports = function health(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, { ok: false, error: 'Method not allowed' }, 405);
  }

  return sendJson(res, {
    ok: true,
    service: 'proposal-generator',
    runtime: 'vercel-functions',
  });
};

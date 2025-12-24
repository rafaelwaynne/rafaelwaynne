const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwt(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/devstorage.read_only',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const data = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data);
  const sig = signer.sign(sa.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return data + '.' + sig;
}

async function getAccessToken() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
  if (!credPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS ausente');
  const fp = path.isAbsolute(credPath) ? credPath : path.join(process.cwd(), credPath);
  const sa = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  const assertion = signJwt(sa);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!resp.ok) throw new Error('Falha ao obter token: ' + (await resp.text()));
  const json = await resp.json();
  return json.access_token;
}

async function listBuckets() {
  const project = process.env.CLOUD_PROJECT_ID || '';
  if (!project) throw new Error('CLOUD_PROJECT_ID ausente');
  const token = await getAccessToken();
  const url = `https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(project)}`;
  const resp = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-goog-project-id': project
    }
  });
  if (!resp.ok) throw new Error('Falha ao listar buckets: ' + (await resp.text()));
  const json = await resp.json();
  return json.items || [];
}

module.exports = { listBuckets };

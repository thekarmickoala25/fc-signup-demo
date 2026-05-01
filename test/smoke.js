// Smoke tests — boot the server in a child process, fire a few requests,
// confirm each fails for the right reason. Designed to run without real
// Friendly Captcha credentials: we set placeholder env vars so the server
// boots, then assert on the validation / rate-limit paths that don't
// actually call the FC API.

import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const PORT = 4123;
const env = {
  ...process.env,
  PORT: String(PORT),
  FRC_SITEKEY: 'FCMTEST_smoke_only',
  FRC_API_KEY: 'test_key_smoke_only',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
};

const server = spawn('node', ['server.js'], {
  env,
  stdio: ['ignore', 'inherit', 'inherit'],
});

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`http://localhost:${PORT}${path}`, opts);
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body };
}

try {
  // Wait for the server to come up.
  for (let i = 0; i < 25; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/healthz`);
      if (r.ok) break;
    } catch {}
    await wait(120);
  }

  console.log('healthz');
  const h = await fetchJson('/healthz');
  check('returns ok', h.status === 200 && h.body?.ok === true);

  console.log('signup: missing captcha');
  const a = await fetchJson('/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: '[email protected]', name: 'Ada' }),
  });
  check('400 invalid_input', a.status === 400 && a.body?.error === 'invalid_input');

  console.log('signup: bad email');
  const b = await fetchJson('/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', name: 'Ada', 'frc-captcha-response': 'x' }),
  });
  check('400 invalid_input', b.status === 400 && b.body?.error === 'invalid_input');

  console.log('signup: bad captcha (will hit FC API and be rejected)');
  const c = await fetchJson('/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: '[email protected]',
      name: 'Ada',
      'frc-captcha-response': 'definitely-not-a-real-solution',
    }),
  });
  // With an invalid API key the SDK's non-strict default will allow the
  // request through (wasAbleToVerify=false). With a real-but-bad solution
  // FC returns success=false. Either way we should NOT see a 5xx; we should
  // either see captcha_failed (400) or 201 (fail-open).
  check(
    'no 5xx for unverifiable captcha',
    c.status === 400 || c.status === 201,
    `status=${c.status} body=${JSON.stringify(c.body)}`
  );

  console.log('rate limit');
  let rateLimited = false;
  for (let i = 0; i < 12; i++) {
    const r = await fetchJson('/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `t${i}@example.com`, name: 'X' }),
    });
    if (r.status === 429) {
      rateLimited = true;
      break;
    }
  }
  check('triggers 429 within 12 requests', rateLimited);
} catch (err) {
  console.error('smoke crashed:', err);
  failed++;
} finally {
  server.kill('SIGTERM');
}

if (failed > 0) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nall smoke checks passed.');

// fc-signup-demo / server.js
//
// Express server that protects a signup endpoint with Friendly Captcha.
//
// Why this looks the way it does (SE notes):
//   * The widget runs client-side and writes its solution into a hidden input
//     named `frc-captcha-response` inside the form. We read that, then verify
//     it server-side via Friendly Captcha's siteverify API before doing
//     anything else.
//   * We use the official server SDK so we benefit from the recommended
//     non-strict defaults (fail open if the *verification call itself* can't
//     be reached, but always reject a confirmed-bad solution). This matches
//     the customer-facing guidance in the docs and is the right default for
//     most signup flows where availability matters.
//   * Rate limiting is applied per-IP on the signup endpoint as defence in
//     depth; Friendly Captcha catches automated solvers, the rate limit
//     catches "humans + scripts mixed" abuse.
//   * Helmet + a tight CSP keep the integration honest about which origins
//     it loads code from (only the FC CDN).
//   * Logs are structured (pino) so they're useful in any aggregator a
//     customer already runs.

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { z } from 'zod';
import { FriendlyCaptchaClient } from '@friendlycaptcha/server-sdk';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Config ---------------------------------------------------------------

const config = {
  port: Number(process.env.PORT || 3000),
  env: process.env.NODE_ENV || 'development',
  frcSitekey: process.env.FRC_SITEKEY,
  frcApiKey: process.env.FRC_API_KEY,
  // 'global' or 'eu'. EU keeps verification traffic in the EU region — a
  // very common ask from German / EU customers and a Friendly Captcha
  // differentiator vs. US-hosted competitors.
  frcEndpoint: process.env.FRC_ENDPOINT || 'eu',
};

if (!config.frcSitekey || !config.frcApiKey) {
  // Fail loudly at boot rather than silently accepting unverified signups.
  // eslint-disable-next-line no-console
  console.error(
    '[fatal] FRC_SITEKEY and FRC_API_KEY must be set. Copy .env.example to .env and fill them in.'
  );
  process.exit(1);
}

const logger = pino({
  level: process.env.LOG_LEVEL || (config.env === 'production' ? 'info' : 'debug'),
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});

const frc = new FriendlyCaptchaClient({
  apiKey: config.frcApiKey,
  sitekey: config.frcSitekey,
  apiEndpoint: config.frcEndpoint, // 'global' | 'eu' | full domain
});

// ---- App ------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // honour X-Forwarded-For from Render/Railway/etc.

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // The FC widget loads from jsdelivr; everything else is same-origin.
        'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
        // The FC widget runs the proof-of-work in a Web Worker created from
        // a blob: URL. Without `blob:` here, the worker is silently blocked
        // and the widget never finishes solving.
        'worker-src': ["'self'", 'blob:'],
        // The widget UI itself is rendered inside an iframe served from
        // https://eu*.frcapi.com (or global*) — so the same origins need to
        // be allowed as iframe sources too. Without this the iframe load
        // is blocked and the widget shows "Anti-Robot check took too long
        // to connect, retrying...". child-src is the older alias.
        'frame-src': ["'self'", 'https://*.frcapi.com'],
        'child-src': ["'self'", 'https://*.frcapi.com'],
        'connect-src': ["'self'", 'https://*.frcapi.com'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
      },
    },
  })
);

app.use(pinoHttp({ logger }));
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));

// Render index.html with the sitekey injected into the FC widget's
// data-sitekey attribute server-side. Doing this at request time (rather
// than in client JS after page load) avoids a race with the FC site script,
// which auto-mounts widgets as soon as it loads. The sitekey is a public
// value — there's no reason to keep it out of the static HTML.
const indexTemplate = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const renderedIndex = indexTemplate.replaceAll('__FRC_SITEKEY__', config.frcSitekey);

app.get('/', (_req, res) => {
  res.type('html').send(renderedIndex);
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m', index: false }));

// ---- Signup endpoint ------------------------------------------------------

const signupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 10 attempts / IP / minute. Tight on purpose for the demo.
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'rate_limited', detail: 'Too many attempts. Try again in a minute.' },
});

const SignupSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(120),
  // Field name is fixed by the FC widget — it injects `frc-captcha-response`
  // into the form on solve.
  'frc-captcha-response': z.string().min(1, 'Please complete the captcha.'),
});

// Stand-in for "real" persistence — keeps the demo single-process and obvious.
const users = new Map();

app.post('/api/signup', signupLimiter, async (req, res) => {
  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_input',
      detail: parsed.error.issues.map((i) => i.message).join('; '),
    });
  }

  const { email, name } = parsed.data;
  const captchaResponse = parsed.data['frc-captcha-response'];

  let verifyResult;
  try {
    verifyResult = await frc.verifyCaptchaResponse(captchaResponse);
  } catch (err) {
    req.log.error({ err }, 'friendly-captcha verification threw');
    // Fail closed on unexpected exceptions — better to make the user retry
    // than to silently bypass verification.
    return res.status(503).json({ ok: false, error: 'captcha_unavailable' });
  }

  if (!verifyResult.shouldAccept()) {
    req.log.warn(
      {
        wasAbleToVerify: verifyResult.wasAbleToVerify(),
        // The SDK exposes the underlying error code when verification ran but rejected.
        errorCode: verifyResult.getErrorCode(),
        responseError: verifyResult.getResponseError(),
      },
      'captcha rejected'
    );
    return res.status(400).json({
      ok: false,
      error: 'captcha_failed',
      detail: 'The captcha could not be verified. Please try again.',
    });
  }

  // SiteverifySuccessResponse.data.event_id is the unique ID for this
  // verification — useful for cross-referencing FC dashboard analytics.
  const verifyResponse = verifyResult.getResponse();
  const eventId =
    verifyResponse && verifyResponse.success ? verifyResponse.data.event_id : null;

  // From here on we trust the request enough to do real work.
  if (users.has(email)) {
    return res.status(409).json({ ok: false, error: 'already_registered' });
  }

  const user = {
    email,
    name,
    createdAt: new Date().toISOString(),
    captcha: {
      verified: true,
      // Surfacing some of the verification data in the response is something
      // I'd never do in production — included here so the demo makes the
      // round-trip visible to a reviewer.
      eventId,
    },
  };
  users.set(email, user);

  req.log.info({ email }, 'signup ok');
  return res.status(201).json({ ok: true, user });
});

// ---- Ops endpoints --------------------------------------------------------

app.get('/healthz', (_req, res) => res.json({ ok: true, env: config.env }));

app.get('/api/stats', (_req, res) =>
  res.json({ ok: true, signups: users.size, uptimeSec: Math.round(process.uptime()) })
);

// ---- Boot -----------------------------------------------------------------

app.listen(config.port, () => {
  logger.info(
    { port: config.port, env: config.env, frcEndpoint: config.frcEndpoint },
    'fc-signup-demo listening'
  );
});

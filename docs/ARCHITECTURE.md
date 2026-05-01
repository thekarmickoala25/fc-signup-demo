# Architecture & decisions

This is the longer-form companion to the README — the "why" behind each choice. Written as if I were sending it to a prospect's senior engineer after a technical deep-dive call.

## The integration in one sentence

A Friendly Captcha widget runs client-side, computes a proof-of-work solution invisibly, attaches the solution to the form submit, and the server verifies that solution against `siteverify` before doing any signup work. That's it. The whole thing is ~180 lines of server code and one HTML form.

## Why these dependencies

| Package | Why it's here | What I'd swap it for |
| --- | --- | --- |
| `express` | Boring, well-understood, the customer's team already knows it. | Fastify if the customer has a perf SLO that justifies it. |
| `@friendlycaptcha/server-sdk` | Official SDK. Handles endpoint selection, error codes, strict-mode semantics — things you'd otherwise re-derive from the API docs. | A direct `fetch` call to `siteverify` (~15 lines). Documented in the FC docs. |
| `helmet` | One line, sane defaults, and crucially gives us a CSP we can lock down to the FC CDN only. | Hand-rolled middleware if the customer already has a CSP they own. |
| `express-rate-limit` | Defence in depth — bot solvers will fail FC verification, but rate limit catches "real human, automated script" abuse. | A Redis-backed rate limiter behind a load balancer in real production. |
| `pino` + `pino-http` | Structured logs that drop into any aggregator. | Whatever logger the customer's stack already uses. |
| `zod` | Input validation that matches the contract; better errors than `if (!email)`. | `joi` / `valibot` / hand-rolled — it's a 6-line schema. |

## The single most important call

```js
const verifyResult = await frc.verifyCaptchaResponse(captchaResponse);
if (!verifyResult.shouldAccept()) {
  return res.status(400).json({ ok: false, error: 'captcha_failed' });
}
```

Three things to know about it:

1. **`shouldAccept()` vs `wasAbleToVerify()`**. `wasAbleToVerify()` tells you whether the API call succeeded. `shouldAccept()` tells you what to *do*. In the SDK's default non-strict mode, if the call to siteverify itself fails (network error, FC outage), `shouldAccept()` returns `true` — i.e. fail open. For a signup flow this is almost always what you want: a 30-second FC outage should not 503 your entire signup funnel. For high-value flows (payments, password reset) you'd flip `strict: true` in the client config so the same outage rejects the request instead.

2. **Status code 200 ≠ valid**. The HTTP layer says "I successfully processed your verification request." The `success` field inside the body says "the user's solution was correct." The SDK collapses these into the two functions above; if you ever do this with raw `fetch`, you must check both.

3. **Don't trust the client to skip it.** The widget prevents a human from submitting without solving, but a script can post directly to `/api/signup`. Server-side verification is the only thing that actually stops bots.

## Why EU routing is the default here

Friendly Captcha runs siteverify endpoints in two regions: `global.frcapi.com` and `eu.frcapi.com`. They behave identically; the difference is data residency. Since FC's customer base skews EU-regulated (German banks, insurers, public-sector portals), making `eu` the default means a German DPO can read the env file and immediately know where verification traffic goes. A US-only customer flips one env var.

## CSP

```
script-src 'self' https://cdn.jsdelivr.net
connect-src 'self' https://*.frcapi.com
```

The widget script is loaded from jsdelivr; once mounted, it talks only to FC's puzzle API. The CSP makes that contract enforceable: if the widget ever tried to call out somewhere else, the browser would block it and the customer's CSP report-only mode would surface it. This is the kind of thing a security team will ask about, and the answer is on one line.

## Rate limit shape

10 attempts per IP per minute, returning 429. Tighter than most production defaults on purpose, because:

- This is a signup endpoint. A real user will submit it once, maybe twice with a typo.
- A bot that's failing FC verification will retry — the rate limit ensures we're not paying for siteverify calls on every retry.
- Behind a real LB you'd key on `X-Forwarded-For` (`trust proxy: 1` is set) and ideally also on the email field after a few attempts.

## What's deliberately *not* here

- A database. Signup persists into a `Map` so the demo runs single-process. Add Postgres or whatever the customer uses in prod.
- Email verification. Outside scope of "show the captcha integration."
- A real session/cookie story. Same reason.
- Risk Intelligence wiring. The siteverify response surfaces a `risk_intelligence` field when the customer has it enabled — adding a second branch in the handler to read and act on it is a one-call follow-up demo.

## What I'd add for a production roll-out

1. Replace the `Map` with the customer's user store.
2. Move the rate limit to Redis if there's more than one server.
3. Add a feature flag around the verification call so they can shadow-mode it (log what FC thinks, but don't reject on it) for a week before turning enforcement on. This is how I'd recommend any customer migrate from reCAPTCHA / hCaptcha — measure, then enforce.
4. Pipe the FC `eventId` into their analytics so they can correlate verification events with downstream signal (account abuse, payment chargebacks, etc.).

That's the whole thing.

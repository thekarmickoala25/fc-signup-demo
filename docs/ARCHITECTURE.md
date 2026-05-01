# Architecture and decisions

The longer version. Notes I made for myself while building this, tidied up so they read. If you disagree with any of it, brilliant, that's most of the value of writing it down.

## The whole thing in one sentence

A widget runs in the browser, quietly works out a proof-of-work solution, attaches the answer to the form submit, and the server checks that answer against `siteverify` before doing anything that creates a user. About 225 lines of server code and one HTML form.

## What's in `package.json`

Nothing fancy. Each one is there because it's the obvious choice for the job, not because I went shopping.

`express` because it's boring and everyone reading this code already knows it. If I had a real performance reason, I'd reach for Fastify, but I didn't.

`@friendlycaptcha/server-sdk` rather than a raw `fetch` call. The SDK handles endpoint selection, error codes, and the strict-mode semantics for me. The raw-fetch version is also in your docs and is genuinely about fifteen lines, so it isn't load-bearing — it just felt like the more respectful choice for a demo aimed at FC.

`helmet` for the headers. One line gets me sensible defaults, and the bit I actually care about (the CSP) sits on top of it.

`express-rate-limit` because the captcha catches automated solvers but it doesn't catch a real person running a sloppy script. That's what the rate limit is for.

`pino` and `pino-http` for structured logs. They drop into whatever aggregator someone's already running. If they hate Pino, swap it out, the world won't end.

`zod` because validating the request shape up front means the error you give the user actually says what's wrong, instead of a generic "Required" that helps no one.

## The verify call, which is the bit that matters

```js
const verifyResult = await frc.verifyCaptchaResponse(captchaResponse);
if (!verifyResult.shouldAccept()) {
  return res.status(400).json({ ok: false, error: 'captcha_failed' });
}
```

Three things about it that I think matter, in order of how much I'd lean on them in a conversation.

**`shouldAccept()` and `wasAbleToVerify()` are not the same thing, and that's the whole game.** `wasAbleToVerify()` answers "did the call to FC actually get an answer?" `shouldAccept()` answers "based on that, do I let the request through?" In the SDK's default non-strict mode, if the verification call itself fails (network, FC outage, whatever), `shouldAccept()` returns `true`. That's deliberate — a thirty-second outage at FC shouldn't take down every signup funnel that uses you. For a payment or password reset, you'd flip `strict: true` and the same outage would block. I went with non-strict here because it felt right for signup, but I'd want to know whether you usually nudge customers to set this per-endpoint or globally. I'm guessing per-endpoint is the better default and I'd rather be told.

**HTTP 200 doesn't mean "valid."** The HTTP layer is just saying "I processed your request without crashing." The `success` field inside the body is the actual answer. The SDK rolls these into the two booleans above, but if anyone goes back to raw `fetch` they have to remember to check both, and that's a footgun waiting.

**The widget on its own enforces nothing.** A bot can POST straight at `/api/signup` and skip it. The verification call is what stops them. Worth being explicit about, because the widget's the visible bit and there's a temptation to think of it as the security boundary. It isn't.

## Why EU is the default routing

`global.frcapi.com` and `eu.frcapi.com` behave the same; the difference is data residency. I made `eu` the default because the customer base I'm imagining (German banks, insurers, public-sector things) cares about it, and putting it in the env file means a DPO can audit where verification traffic is actually going in about three seconds.

I don't actually know whether most of your customers pin to `eu`, or use `global` and let you route. That's one of the things I'd want to ask early.

## CSP

The directives I added on top of helmet's defaults:

```
script-src   'self' https://cdn.jsdelivr.net
worker-src   'self' blob:
frame-src    'self' https://*.frcapi.com
child-src    'self' https://*.frcapi.com
connect-src  'self' https://*.frcapi.com
style-src    'self' 'unsafe-inline'
img-src      'self' data:
```

Every line is there for a real reason, and a couple of them I learnt about by getting bitten:

- `script-src` allows jsdelivr (the widget script). Nothing else off-origin.
- `worker-src` needs `blob:` because the widget builds the proof-of-work Web Worker from a `blob:` URL. I missed this on the first pass and the widget silently failed to solve. No console error, just nothing happening.
- `frame-src` and `child-src` need `*.frcapi.com` because the visible bit of the widget is rendered inside an iframe served from FC's domain. I missed this one too — got "Anti-Robot check took too long to connect, retrying..." with no clue why until I read the CSP violations in the console.
- `connect-src` lets the widget fetch puzzles from the same FC origins.
- `style-src 'unsafe-inline'` is the one I'm not happy about. The widget injects styles directly, so without `unsafe-inline` the page renders broken. I think tightening this further would need nonces and a small change on the widget end. Curious whether it's come up from any of your security-conscious customers.

The wider point: the CSP makes the contract enforceable. If the widget ever tried to call somewhere it shouldn't, the browser would block it and the customer's CSP report-only mode would surface it. That's the kind of thing a security team will ask about, and the answer fits in a few lines.

## Rate limit

Ten attempts per IP per minute, returning 429. That's tighter than most production defaults, on purpose:

- A real signup happens once, maybe twice with a typo. Real users never hit ten.
- A bot that's failing captcha verification will retry, and every retry is a wasted siteverify call to FC. Cap the retries.
- Behind a real load balancer you'd key on `X-Forwarded-For` (`trust proxy: 1` is set so it does), and probably also key on the email field after a few attempts so a single bot rotating IPs doesn't slip through.

## What I deliberately didn't do

- **A database.** Users persist into a `Map`, so the demo runs in a single process. Drop in Postgres or whatever's already in the customer's stack.
- **Email verification, sessions, login.** Out of scope. This is a captcha demo, not an auth system.
- **Risk Intelligence.** The siteverify response surfaces a `risk_intelligence` field for accounts that have it on. I'm not branching on it. The natural follow-up demo is "and here's the handler logic when RI's enabled" — a small change, but it didn't belong in v1.

## What I'd add to ship this for real

- Replace the `Map` with the customer's user store.
- Move the rate limit to Redis if there's more than one app server.
- Wrap the verification call in a feature flag for a staged rollout. The migration story for any customer coming off reCAPTCHA or hCaptcha should be: shadow-mode for a week (log what FC thinks, don't enforce on it), look at the false-positive rate, then turn enforcement on. I'd want this to be the default thing we tell people, not something each customer has to figure out alone.
- Pipe the FC `eventId` into the customer's analytics so support can correlate captcha events with downstream signal — abuse, chargebacks, account takeovers. That's where the real value of the verification metadata lives, not in the immediate yes/no.

That's the lot.

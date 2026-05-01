# fc-signup-demo

A working integration of [Friendly Captcha v2](https://friendlycaptcha.com) into a Node.js signup form.

I said I'd have a play around with this myself after meeting in Hamburg, where we got talking about the SE role. I thought the best way to show I'd be useful was to actually integrate the product the way a customer's engineer would, and to write down the choices I made along the way. So this is partly a code sample and partly a "here's how I'd think about it." Happy to be told where I got things wrong.

> **Live demo:** https://fc-signup-demo.onrender.com
> *(On Render's free tier — first request after the service has been idle for a while takes ~30 seconds to wake up. Free-tier tax.)*

## What it actually does

A user lands on the page, fills in name and email, and clicks Create account. Behind the scenes:

- The Friendly Captcha widget loads from jsdelivr and quietly starts solving a proof-of-work puzzle in a Web Worker. The user does nothing — there's no checkbox, no images, nothing to click.
- When the puzzle finishes, the widget writes the solution into a hidden form field called `frc-captcha-response`.
- On submit, the browser POSTs the whole form (including that hidden field) to `/api/signup` as JSON.
- The Express server validates the input, then hands the captcha response off to `@friendlycaptcha/server-sdk`, which calls `siteverify` on Friendly Captcha's API.
- If the verification result says `shouldAccept()`, the user is created and the server returns `201`. Otherwise 400.

The whole protection lives in that server-side verification step. The widget on its own enforces nothing — anyone could skip it and POST directly. But without a valid response, the verification call rejects, and the signup never happens.

## Architecture

```
┌──────────────┐     1. load widget script      ┌────────────────────┐
│   browser    │ ─────────────────────────────► │  jsdelivr (FC CDN) │
│  signup form │                                └────────────────────┘
│              │     2. solve puzzle in bg      ┌────────────────────┐
│              │ ◄─────────────────────────────►│  Friendly Captcha  │
│              │     (via the widget)           │      puzzle API    │
└─────┬────────┘                                └────────────────────┘
      │ 3. POST /api/signup
      │   { name, email, frc-captcha-response }
      ▼
┌──────────────┐     4. verifyCaptchaResponse   ┌────────────────────┐
│ Express app  │ ─────────────────────────────► │  eu.frcapi.com     │
│  (this repo) │ ◄───────────────────────────── │ /api/v2/siteverify │
│              │     5. shouldAccept() ?        └────────────────────┘
│              │
│              │ 6. create user + 201, or reject
└──────────────┘
```

The thing worth understanding from the diagram: the *only* call your server makes to Friendly Captcha is the verification one. Everything else (the puzzle, the widget UI, the iframe) goes browser-to-FC directly. Your server doesn't proxy anything, doesn't see the puzzle, doesn't need to know how proof-of-work works. It just asks "is this response valid?" and gets a yes or no.

## What's real and what's mocked

Real:
- The Friendly Captcha integration end-to-end (widget, siteverify call, result handling).
- The CSP (locked to FC's CDN and API origins, not "*").
- Rate limiting, input validation, structured logging.
- The deploy: this is actually running on Render in Frankfurt right now.

Mocked:
- The user store is an in-memory `Map`. In a real app this'd be Postgres or whatever the customer uses.
- Email verification, sessions, login — all out of scope. This demo is about the captcha integration, not a full auth system.
- Risk Intelligence — Friendly Captcha's higher-tier bot-detection module. The siteverify response surfaces a `risk_intelligence` field for accounts that have it enabled; I just don't act on it.

## Run locally

```bash
git clone https://github.com/thekarmickoala25/fc-signup-demo.git
cd fc-signup-demo
cp .env.example .env       # then fill in FRC_SITEKEY + FRC_API_KEY
npm install
npm run dev
# open http://localhost:3000
```

You'll need a sitekey and API key from the [Friendly Captcha dashboard](https://app.friendlycaptcha.com). The free tier is enough for the demo. Add `localhost` to the application's allowed domains, or the widget will refuse to mount.

## Deploy

The `render.yaml` here is what's running the live demo — push the repo, point Render at it, set `FRC_SITEKEY` and `FRC_API_KEY` in the environment tab, done. Don't forget to add the deployed hostname to the application's allowed domains in the FC dashboard, or the widget will silently fail.

For Railway, `railway.json` does the same thing. For anywhere else, the `Dockerfile` is straightforward:

```bash
docker build -t fc-signup-demo .
docker run -p 3000:3000 \
  -e FRC_SITEKEY=... \
  -e FRC_API_KEY=... \
  -e FRC_ENDPOINT=eu \
  fc-signup-demo
```

## File layout

```
.
├── server.js                  # Express app — the whole backend, ~225 lines
├── public/
│   ├── index.html             # Signup form + FC widget mount point
│   ├── styles.css             # Hand-tuned, no framework
│   └── app.js                 # Submit handler, error states, widget reset
├── test/
│   └── smoke.js               # Boots the server, hits the endpoints, checks responses
├── docs/
│   ├── ARCHITECTURE.md        # Why each choice, in more detail
│   └── SE_TALK_TRACK.md       # First crack at how I'd demo this on a customer call
├── Dockerfile
├── render.yaml
├── railway.json
└── .env.example
```

## A few things I'd want to talk about

These are the questions I'd expect from a customer's engineering team, and they're the things I'd want to think through with someone at FC:

**Strict vs non-strict mode.** The SDK's default is non-strict — if the verification API itself is unreachable for a few seconds, the request goes through. For signup that feels right (an FC outage shouldn't take down everyone's funnels). For payments or password reset I'd flip strict on. I'd want to ask whether you usually recommend customers set this per-endpoint or globally.

**The CSP.** I locked `script-src` to jsdelivr only, `connect-src` and `frame-src` to `*.frcapi.com`. It works, but `style-src` still needs `'unsafe-inline'` because the widget injects styles directly. I think that's unavoidable without nonces and an FC-side change — would be curious whether you've seen customers raise it.

**Risk Intelligence.** I'm not using it here, but the siteverify response includes a `risk_intelligence` field when enabled. The natural next demo is "and here's how a customer would branch on that data" — a one-call follow-up.

**EU vs global routing.** I made `eu` the default because it seemed obvious for FC's customer base, but I don't actually know what split you see in practice. Curious whether most customers pin to one region or use `global` and let FC route.

## What I'd add for production

Persist users into a real database. Move the rate limit to Redis so it works across multiple servers. Add a feature flag around the verification call so a customer migrating from reCAPTCHA / hCaptcha can shadow-mode the integration first (log what FC thinks but don't enforce on it) before turning enforcement on. Pipe the FC `eventId` into analytics so support can correlate captcha events with downstream signal — abuse, chargebacks, etc.

## Tests

```bash
npm run test:smoke
```

Boots the server, hits each endpoint, checks the response shapes and the CSP headers. Doesn't need real FC credentials — uses placeholders and skips the actual verification call. 14 checks; runs in ~2 seconds.

## License

MIT.

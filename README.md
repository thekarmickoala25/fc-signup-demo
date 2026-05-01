# fc-signup-demo

A small, production-shaped reference integration of **Friendly Captcha v2** into a Node.js signup flow. Built as a Solutions Engineering artefact: the kind of thing I'd hand a prospect after a first call so they can see what "good" looks like before they touch their own codebase.

It's deliberately small (~180 lines of server code) but every choice is the choice I'd defend in front of a customer's security team.

## What it shows

- **Frontend**: vanilla HTML form with the FC v2 widget mounted automatically by the site script. No framework lock-in — drops into any stack.
- **Backend**: Express server using `@friendlycaptcha/server-sdk` to verify the puzzle solution before any signup is persisted.
- **Defence in depth**: per-IP rate limit (`express-rate-limit`), strict CSP via Helmet locked to the FC CDN, schema validation with Zod, structured logs with Pino.
- **EU routing by default**: `FRC_ENDPOINT=eu` keeps verification traffic in-region — usually the first thing a German DPO asks about.
- **Fail-closed on exceptions, fail-open on unreachable verification**: matches the SDK's recommended posture for signup flows where availability matters.
- **One-click deployable**: Render, Railway, or any Docker host.

## Architecture

```
┌──────────────┐     1. load widget script      ┌────────────────────┐
│   browser    │ ─────────────────────────────► │  jsdelivr (FC CDN) │
│  signup form │                                 └────────────────────┘
│              │     2. solve puzzle in-bg      ┌────────────────────┐
│              │ ◄─────────────────────────────►│  Friendly Captcha  │
│              │     (via widget)                │      puzzle API    │
└─────┬────────┘                                 └────────────────────┘
      │ 3. POST /api/signup
      │   { name, email, frc-captcha-response }
      ▼
┌──────────────┐     4. verifyCaptchaResponse   ┌────────────────────┐
│ Express app  │ ─────────────────────────────► │  global.frcapi.com │
│  (this repo) │ ◄───────────────────────────── │ /api/v2/siteverify │
│              │     5. shouldAccept() ?        └────────────────────┘
│              │
│              │ 6. persist + 201, or reject
└──────────────┘
```

The widget injects a hidden `frc-captcha-response` field into the form on solve. The server forwards it to `siteverify` and only persists the user when `shouldAccept()` is true.

## Run locally

```bash
git clone <this repo>
cd fc-signup-demo
cp .env.example .env       # then fill in FRC_SITEKEY + FRC_API_KEY
npm install
npm run dev
# open http://localhost:3000
```

Get a sitekey + API key from the [Friendly Captcha dashboard](https://app.friendlycaptcha.com).

## Deploy

### Render (one click after pointing at the repo)

The included `render.yaml` configures a free-tier web service in Frankfurt with EU verification. Push the repo, point Render at it, and set `FRC_SITEKEY` / `FRC_API_KEY` in the dashboard.

### Railway

`railway.json` is included — `railway up` and set the same two env vars.

### Docker / anywhere

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
├── server.js                # Express app — ~150 lines, the whole backend
├── public/
│   ├── index.html           # Signup form + FC widget + sitekey injection
│   ├── styles.css           # Minimal, hand-tuned UI
│   └── app.js               # Submit handler, error states, widget reset
├── test/
│   └── smoke.js             # Node-only smoke test (no deps)
├── docs/
│   ├── ARCHITECTURE.md      # Decisions + tradeoffs in more depth
│   └── SE_TALK_TRACK.md     # How I'd walk a prospect through this
├── Dockerfile
├── render.yaml
└── railway.json
```

## SE walkthrough script (5 minutes)

If I were demoing this on a prospect call, I'd do it in this order. Reading the README is the talk track:

1. **Open the site, fill in the form.** Point out what's *not* there: no checkbox, no image grid, no "I am not a robot" language. The widget mounted automatically and is already solving the proof-of-work in the background.
2. **Submit.** Show the success state. Open dev tools → Network → highlight the `POST /api/signup` request payload. Point at the `frc-captcha-response` field and say: "this is what the widget injected, the server must verify it."
3. **Show the server log line for the signup.** Point at `eventId` — every verification has a unique ID we can correlate to dashboard analytics if Risk Intelligence is enabled.
4. **Trigger a failure.** In dev tools, edit the hidden input to garbage and resubmit. Show the 400 with `error: captcha_failed` and the `wasAbleToVerify=true, errorCode=...` log line.
5. **Trigger the rate limit.** Hammer the endpoint 11 times. Show the 429 — defence in depth, FC catches the bot, rate limit catches the human-with-a-script.
6. **Tour the code.** `server.js` is 150 lines. Three things to call out:
   - The `verifyCaptchaResponse` call and the `shouldAccept()` / `wasAbleToVerify()` distinction (and why "fail open on unreachable" is right for signup flows).
   - The CSP — `connect-src` is locked to `*.frcapi.com`, so the widget genuinely can't talk anywhere else.
   - The `FRC_ENDPOINT=eu` env var — the only difference between US and EU residency is one string.

The point I'd close on: **this is the integration their engineering team would own forever, and it's small enough to read in one sitting.** That's the differentiator vs. competitors that ship 100KB of obfuscated JS into every page.

## Tests

```bash
npm run test:smoke
```

Boots the server, hits `/healthz`, exercises the validation + rate-limit paths. Doesn't require a real Friendly Captcha key.

## License

MIT — do whatever, this is a portfolio piece.

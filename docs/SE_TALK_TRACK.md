# SE talk track — running this demo on a customer call

How I'd actually use this artefact in a sales motion. Treat the demo as a *prop*, not a script — the conversation is the thing.

## Pre-call (10 min prep)

- Read the prospect's signup / login / contact / forum pages. Do they have a captcha already? What is it?
- If they're using reCAPTCHA, expect questions about Google data sharing — that's the whole switching pitch.
- If they're using hCaptcha, expect questions about UX (the image grids).
- If they're a German/EU regulated customer, lead with EU residency and accessibility.

## On the call (5–10 min demo segment)

### 1. "Show me what your users see today" (1 min)

Open their actual signup page. Get them to walk you through it. Point at any captcha friction. **Don't pitch yet.** This is discovery — you want them saying out loud how much they hate it.

### 2. "Here's the same flow with Friendly Captcha" (1 min)

Open this demo. Have them fill in name + email + submit. Don't say anything until they hit submit. Then:

> "Notice you didn't do anything. The widget mounted, started solving the puzzle while you were typing, and finished before you clicked. That's the *whole* user-facing experience."

If they push back ("but how do I know it worked?") — open dev tools, show the hidden `frc-captcha-response` in the form payload.

### 3. "Here's what your engineers see" (2 min)

Open `server.js`. Three highlights, no more:

> **(a)** "This is the verification call. One function, two booleans on the result. `shouldAccept()` is what you branch on."
>
> **(b)** "This is the CSP. The widget can only talk to `*.frcapi.com`. Your security team will ask about this — the answer is on one line."
>
> **(c)** "This env var, `FRC_ENDPOINT=eu`, is the only thing that's different between US and EU residency. Your DPO can audit this in one minute."

### 4. "What happens when something goes wrong?" (2 min)

In dev tools, edit the hidden field to garbage. Submit. Show the 400 + error message. Then:

> "By default the SDK fails *open* if it can't reach our API at all — the right call for signup, where availability matters. For payment confirmation or password reset, you flip strict mode and it fails closed. One config flag, your decision per endpoint."

### 5. Hand off (30 sec)

> "This whole repo is ~180 lines of server code. I'll send you a link — your engineering team can read it in 15 minutes and tell you what's missing for your stack. That's the bar I'd want to hit before we go further."

## Common objections + responses

**"How is proof-of-work different from a checkbox captcha?"**
The user does nothing. Their browser does ~1 second of math. Bots either don't run JS (immediate fail) or have to spend the same compute the user did, at scale, which doesn't pencil out. There's no behavioural fingerprint, no third-party tracking, no GDPR follow-up.

**"What about accessibility?"**
That's the strongest pitch vs. reCAPTCHA / hCaptcha. There is no visual or audio challenge to fail. A blind user, a user with a low-end device, a user without a phone for SMS verification — all of them go through the same invisible path.

**"What's the bot detection rate?"**
Honest answer: proof-of-work catches the long tail of cheap automated solvers. For sophisticated paid solvers, layer Risk Intelligence on top — that's the upsell, and it's where the demo tour goes if they ask.

**"Can we self-host?"**
Friendly Captcha offers self-hosted endpoints for enterprise — that's a deal-qualifier conversation, not a demo question.

**"What about migration from [reCAPTCHA / hCaptcha / Turnstile]?"**
Show them the [hCaptcha migration guide](https://developer.friendlycaptcha.com/docs/v2/guides/migrating-from-hcaptcha) on the dev hub. Same pattern: swap the widget script, swap the verify endpoint, ship behind a feature flag.

## Hand-off email template (after the call)

> Hi {name},
>
> Thanks for the time today. As promised, here's the reference integration we walked through — clone, run, read in 15 min:
>
> {repo URL}
>
> Three things I'd suggest your team look at first:
>
> 1. `server.js` — the verification call is line {N}. That's the whole backend integration.
> 2. `docs/ARCHITECTURE.md` — has the "why" behind each dependency and the strict-vs-non-strict tradeoff for your high-value endpoints.
> 3. `render.yaml` — drop-in deployable on EU infrastructure if you want to spin up a parallel test before touching prod.
>
> Open question from our call: {the thing they asked I didn't have a clean answer for}. I'll come back with that by {day}.
>
> Happy to do a 30-min follow-up with your engineering lead whenever it suits.
>
> {signoff}

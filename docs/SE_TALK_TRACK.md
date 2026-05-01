# Talk track and where the SE role earns its keep

Some thoughts on what a talk track around this demo could look like, plus the places I see an SE adding the most value at FC. The demo itself is just the prop — most of the actual work is what happens around it, and that's the bit I'm most interested in.

## Where I think the role earns its keep

In rough order of where they'd come up in a customer relationship:

**The first technical call.** Running a demo like this one. Not just the happy path — showing the failure modes (strict vs non-strict, what happens when verification can't reach FC) is what makes a thoughtful prospect actually buy in. The demo is the visible bit; the operator's choices in it are what land.

**The security and DPO conversation.** CSP, residency, where verification traffic goes. These aren't questions a salesperson can credibly answer. Someone who can point at the env file and say "this one line is the only thing that changes between EU and global" is doing the actual heavy lifting in the deal.

**The migration plan.** Customers coming off reCAPTCHA, hCaptcha or Turnstile need a measured rollout, not just working code. Shadow-mode for a week, look at the false-positive rate, then enforce. That recommendation should come from someone who's done it before, not be left as homework for the customer's engineers. I'd want this to be a default thing FC tells people, packaged the same way every time.

**The proof-of-concept build.** When procurement says "show it works in our environment before we sign," that's an SE building a small thing in the customer's stack and handing it back. This demo is what that artefact looks like, on a smaller scale.

**Bridging product feedback.** When a customer raises something like "we can't tighten our CSP because the widget injects inline styles," that's an SE listening, deciding whether it's a roadmap item or a workaround, and being the link between the customer and the product team. Captcha is the kind of product where the integration trade-offs are real and worth feeding back; an SE in the middle of those conversations is a feedback channel the product team wouldn't otherwise have.

## Things I'd want to know before a call

A few quick lookups beforehand that I think pay for themselves:

- What captcha are they running today, and where? Signup is the obvious place, but contact forms, login, password reset, forum posts and review submissions are usually where the friction actually shows up.
- Are they EU-regulated? German banks, insurers, public-sector bodies — that's where data residency and accessibility become the lead pitch rather than a footnote.
- If they're on reCAPTCHA, I'd be ready for Google data-sharing concerns. If they're on hCaptcha, the UX (image grids). If they're on Cloudflare Turnstile and happy with it, they're probably not the ideal customer and it's worth knowing that going in.

## How I'd actually run the demo (5–10 min)

### 1. Get them to show me what their users see today (~1 min)

Open their actual signup page on a screenshare and ask them to walk through it. Point at any captcha friction without naming it as friction.

I'd try not to pitch yet. The goal is to have them say out loud what they don't like — that's what the demo is about to address. If they sound happy with what they have, I'd rather know that now than five minutes into a pitch that's not landing.

### 2. Show the same flow with Friendly Captcha (~1 min)

Open the demo. Hand the keyboard over — let them fill it in themselves. Try to say nothing until they hit submit. Then:

> "Notice you didn't do anything. The widget mounted, started solving the puzzle while you were typing, and finished before you clicked. That's the whole user-facing experience."

If they push back ("but how do I know it actually verified?"), open dev tools, Network tab, click on the `POST /api/signup`, and point at the hidden `frc-captcha-response` field in the request body. *That* is what the widget injected, and that's what the server has to verify.

### 3. Show what their engineers will see (~2 min)

Open `server.js`. Three things, no more — I'd be tempted to walk them through the whole file but I think the win here is being short:

- **The verify call.** One function. Two booleans on the result. `shouldAccept()` is the one you branch on. The whole backend integration is right there.
- **The CSP.** The widget can only talk to `*.frcapi.com`. Their security team will ask. The answer is right there, on a few lines.
- **`FRC_ENDPOINT=eu`.** The only thing different between US and EU residency is one env var. Their DPO can audit it in about thirty seconds.

### 4. Show what happens when things go wrong (~2 min)

In dev tools, edit the hidden `frc-captcha-response` to something rubbish and resubmit. Show the 400 from the server with `error: captcha_failed`. Then:

> "By default the SDK fails *open* if it can't reach our verification API at all — that's deliberate, because for a signup flow you'd rather let a few requests through during a thirty-second outage than 503 the entire funnel. For payment or password reset you'd flip strict mode and the same outage would block. One config flag, you choose per endpoint."

The point: they're not just seeing the happy path, they're seeing the failure mode and the operator's choice in it. That's the bit I think a thoughtful prospect actually cares about.

### 5. Hand off (~30 sec)

> "This whole repo is about 225 lines of server code. I'll send you the link — your engineering team can read it in fifteen minutes and tell me what's missing for your stack. That's the bar I'd want to hit before we go any further."

The implicit ask: don't decide now, decide after their team's looked. Lower friction than asking for a yes on the call, and it puts the engineers on side rather than in the way.

## Questions I'd expect, with the best answers I have

Some of these I'm confident in, some I'd want to sense-check with someone at FC before I rely on them.

**"How is proof-of-work actually different from a checkbox captcha?"** The user does nothing. Their browser does about a second of maths. Bots either don't run JavaScript at all (immediate fail), or they have to spend the same compute the user did, at scale — and at scale that compute starts to cost real money, which is the deterrent. There's no behavioural fingerprinting, no third-party tracking pixels, no cookies, nothing GDPR adjacent.

**"What about accessibility?"** This is the strongest pitch versus reCAPTCHA and hCaptcha. There's no visual or audio challenge to fail. A user on a screen reader, a user on a low-end device, a user without a phone for SMS verification — they all take the same invisible path. I think this lands hardest with public-sector and regulated customers, but I'd want to ask whether you've actually seen accessibility close deals or whether it's more of an unblock-the-objection thing.

**"What's the bot-detection rate?"** Honestly: proof-of-work catches the long tail of cheap automated solvers really well, and it doesn't do as well against sophisticated paid solvers. That's where Risk Intelligence comes in, but I shouldn't pitch RI without checking whether the customer's tier covers it. If they ask for hard numbers, I should defer to whoever has actual benchmark data rather than make one up.

**"Can we self-host?"** I think FC offers self-hosted endpoints for enterprise but I'd want to confirm the exact terms before committing to anything in the call. This feels like a deal-qualifier conversation, not a demo question.

**"How would we migrate from [reCAPTCHA / hCaptcha / Turnstile]?"** There's a migration guide on the dev hub: [migrating from hCaptcha](https://developer.friendlycaptcha.com/docs/v2/guides/migrating-from-hcaptcha). Same shape in all three cases — swap the widget script, swap the verify endpoint, run it in shadow-mode for a week so they can compare what FC says with what their old captcha said before they enforce on FC. I'd genuinely recommend that as the default migration path. Measure first, then enforce.

**"What if a determined attacker just runs a real browser through Selenium?"** Honest answer: that's a known limitation of any client-side challenge, and Risk Intelligence is the layer that helps. I shouldn't oversell here.

## Hand-off email after the call

Within an hour of hanging up:

> Hi {name},
>
> Thanks for the time today. As promised, here's the integration we walked through — should run end-to-end in about fifteen minutes if your team wants to clone it locally:
>
> {repo URL}
>
> Three places I'd suggest looking first:
>
> 1. `server.js` — the verify call is around line 156. That's the whole backend.
> 2. `docs/ARCHITECTURE.md` — the why behind each choice, including the strict-vs-non-strict trade-off you'll want to think about for {their high-value endpoint}.
> 3. `render.yaml` — drop-in deployable on EU infrastructure if you'd like to spin up a parallel test before touching prod.
>
> One thing I want to come back to from our call: {the question I didn't have a clean answer for}. I'll have something on that by {day}.
>
> Happy to do a thirty-minute follow-up with your engineering lead whenever it suits.
>
> {signoff}

Things I'd resist the urge to do in this email: attach a deck, add a "let me know what you think," promise a roadmap conversation. The repo is the artefact. The customer's next move is for their engineers to read it.

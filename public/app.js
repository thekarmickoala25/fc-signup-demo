// Frontend behaviour for the signup form.
//
// The Friendly Captcha widget mounts itself onto `.frc-captcha` and, on
// solve, injects a hidden input named `frc-captcha-response` into the
// surrounding form. We use plain FormData on submit so that hidden field
// rides along automatically.

const form = document.getElementById('signup-form');
const submitBtn = document.getElementById('submit-btn');
const statusEl = document.getElementById('status');
const widgetEl = document.querySelector('.frc-captcha');

// Inject the sitekey from the server-rendered config.
if (window.__FRC_SITEKEY__) {
  widgetEl.setAttribute('data-sitekey', window.__FRC_SITEKEY__);
}

function setStatus(msg, kind = '') {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`.trim();
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.classList.toggle('is-loading', isLoading);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setStatus('');
  setLoading(true);

  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());

  try {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));

    if (res.ok && body.ok) {
      setStatus(`Welcome, ${body.user.name}. Account created.`, 'ok');
      form.reset();
      // Reset the captcha so a follow-up submission gets a fresh puzzle.
      // The site script exposes a global helper for this on v2.
      if (window.frcaptcha?.getWidget) {
        const w = window.frcaptcha.getWidget(widgetEl);
        w?.reset();
      }
    } else {
      const detail =
        body.detail ||
        (body.error === 'rate_limited'
          ? 'Too many attempts — try again in a minute.'
          : body.error === 'already_registered'
          ? 'That email is already registered.'
          : body.error === 'captcha_failed'
          ? 'Captcha verification failed. Please try again.'
          : 'Something went wrong. Please try again.');
      setStatus(detail, 'err');
    }
  } catch (err) {
    console.error(err);
    setStatus('Network error. Please try again.', 'err');
  } finally {
    setLoading(false);
  }
});

// /login.html: magic link (+ 6-digit code) and Google.
import { getSession, sendMagicLink, verifyCode, signInWithGoogle, authHashInfo } from './supabase.js';
import { icon, googleMark } from './ui/icons.js';
import { esc } from './ui/dom.js';
import './ui/logo.js';

const root = document.getElementById('login');

init();

async function init() {
  const info = authHashInfo();
  try {
    if (await getSession()) {
      location.replace('/app.html');
      return;
    }
  } catch (err) {
    return emailStep(err.message);
  }
  if (info) history.replaceState(null, '', location.pathname);
  emailStep(info?.error ? friendly(info.error) : '');
}

function friendly(msg) {
  if (/expired|invalid/i.test(msg)) return 'That sign-in link has expired or was already used. Send a new one.';
  if (/rate limit/i.test(msg)) return 'Too many emails sent. Wait a few minutes, then try again.';
  return msg;
}

function errorHtml(msg) {
  return msg ? `${icon('alert')}<span>${esc(msg)}</span>` : '';
}

function emailStep(error = '', email = '') {
  root.innerHTML = `
    <h1>Sign in or create an account</h1>
    <p class="muted">No password needed. We'll email you a link.</p>
    <form class="stack" data-email novalidate>
      <div class="field">
        <label class="label" for="email">Email address</label>
        <input class="input" id="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required value="${esc(email)}">
      </div>
      <div class="field__error" data-error ${error ? '' : 'hidden'} role="alert">${errorHtml(error)}</div>
      <button type="submit" class="btn btn--primary btn--lg btn--block">${icon('mail')}Email me a sign-in link</button>
    </form>
    <p class="divider">or</p>
    <button type="button" class="btn btn--lg btn--block" data-google>${googleMark()}Continue with Google</button>
    <p class="small muted">By continuing you agree to our <a href="/terms.html">terms</a> and <a href="/privacy.html">privacy policy</a>.</p>`;

  const form = root.querySelector('[data-email]');
  const input = root.querySelector('#email');
  const err = root.querySelector('[data-error]');
  const show = (m) => {
    err.hidden = !m;
    err.innerHTML = errorHtml(m);
  };
  if (!email) input.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      input.setAttribute('aria-invalid', 'true');
      return show('Enter a valid email address.');
    }
    input.removeAttribute('aria-invalid');
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await sendMagicLink(value);
      codeStep(value);
    } catch (ex) {
      btn.disabled = false;
      btn.innerHTML = `${icon('mail')}Email me a sign-in link`;
      show(friendly(ex.message || 'Could not send the email. Try again.'));
    }
  });

  root.querySelector('[data-google]').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await signInWithGoogle();
    } catch (ex) {
      e.currentTarget.disabled = false;
      show(ex.message || 'Google sign-in is not available right now.');
    }
  });
}

function codeStep(email) {
  root.innerHTML = `
    <h1>Check your email</h1>
    <p class="muted">We sent a sign-in link to <strong>${esc(email)}</strong>. Open it on this device to continue.</p>
    <form class="stack" data-code novalidate>
      <div class="field">
        <label class="label" for="code">Or enter the 6-digit code from the email</label>
        <input class="input tabular" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*">
        <p class="field__hint">Using the installed app on iPhone? The code keeps you inside the app.</p>
      </div>
      <div class="field__error" data-error hidden role="alert"></div>
      <button type="submit" class="btn btn--primary btn--lg btn--block">Sign in</button>
    </form>
    <button type="button" class="link-btn" data-back>Use a different email</button>`;
  const form = root.querySelector('[data-code]');
  const input = root.querySelector('#code');
  const err = root.querySelector('[data-error]');
  input.focus();
  root.querySelector('[data-back]').addEventListener('click', () => emailStep('', email));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = input.value.replace(/\D/g, '');
    if (code.length !== 6) {
      err.hidden = false;
      err.innerHTML = errorHtml('Enter the 6 digits from the email.');
      return;
    }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await verifyCode(email, code);
      location.replace('/app.html');
    } catch {
      btn.disabled = false;
      btn.textContent = 'Sign in';
      err.hidden = false;
      err.innerHTML = errorHtml("That code didn't work. Check it, or send a new link.");
    }
  });
}

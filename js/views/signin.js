// Sign-in: one email field, a magic link, and a code fallback for installed iOS apps.
import { sendMagicLink, verifyCode } from '../supabase.js';
import { esc } from '../ui/dom.js';

export function mount(root) {
  let email = '';

  const askEmail = (error = '') => {
    root.innerHTML = `
      <form class="signin stack" novalidate>
        <h1 class="view-title">Sign in</h1>
        <div class="field">
          <label class="label field__label" for="si-email">Email</label>
          <input class="input" id="si-email" type="email" autocomplete="email" inputmode="email" required value="${esc(email)}"
            ${error ? 'aria-invalid="true" aria-describedby="si-err"' : ''} />
          ${error ? `<span class="field__error" id="si-err" role="alert">${esc(error)}</span>` : ''}
        </div>
        <button class="btn btn--primary" type="submit">Send magic link</button>
        <p class="aside">This ledger has one reader. Only the owner's address can sign in.</p>
      </form>`;
    const form = root.querySelector('form');
    const input = root.querySelector('#si-email');
    input.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      email = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return askEmail('Enter a valid email address.');
      const btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        await sendMagicLink(email);
        askCode();
      } catch (err) {
        askEmail(/signups? not allowed|not found|Signups/i.test(err.message) ? "That address can't sign in here." : err.message || 'Could not send the link.');
      }
    });
  };

  const askCode = (error = '') => {
    root.innerHTML = `
      <form class="signin stack" novalidate>
        <h1 class="view-title">Check your email</h1>
        <p>A sign-in link is on its way to <b>${esc(email)}</b>.</p>
        <p class="aside">Open the link in this browser. If the email also has a code, you can enter it here instead. On an iPhone Home Screen app, use the code, because the link opens in Safari.</p>
        <div class="field">
          <label class="label field__label" for="si-code">Code from the email</label>
          <input class="input input--url numeral" id="si-code" type="text" inputmode="numeric" autocomplete="one-time-code"
            pattern="[0-9]*" maxlength="10" ${error ? 'aria-invalid="true" aria-describedby="si-err"' : ''} />
          ${error ? `<span class="field__error" id="si-err" role="alert">${esc(error)}</span>` : ''}
        </div>
        <button class="btn btn--primary" type="submit">Sign in with code</button>
        <button class="btn btn--text" type="button" data-back>Use a different address</button>
      </form>`;
    const form = root.querySelector('form');
    const input = root.querySelector('#si-code');
    input.focus();
    root.querySelector('[data-back]').addEventListener('click', () => askEmail());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = input.value.replace(/\D/g, '');
      if (code.length < 6) return askCode('The code has at least 6 digits.');
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      try {
        await verifyCode(email, code);
        // onAuthChange in app.js takes it from here.
      } catch {
        askCode('That code is wrong or has expired.');
      }
    });
  };

  askEmail();
  return () => {};
}

import { getMenuState, isInspectionShortcut, selectActiveSection, initSiteChrome, initReveal } from './nav.js?v=20261003';

export { getMenuState, isInspectionShortcut, selectActiveSection };

const SUPABASE_URL = 'https://rznbcbkrzevtnuvuisdp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6bmJjYmtyemV2dG51dnVpc2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNDk5NTQsImV4cCI6MjEwMzgyNTk1NH0.evm81SCQ-t6nTwi6g_Vhxf2B0fW9q6W1b8D4u8dr4nM';
const CONTACT_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/contact`;

export function getFormMessage(name, success = true) {
  if (!success) return "Couldn't send your message. Please try again in a moment, or email me directly.";
  const cleanName = name.trim();
  return cleanName
    ? `Thanks, ${cleanName} — your message is on its way.`
    : 'Thanks — your message is on its way.';
}

function initPortfolio() {
  initSiteChrome({ scrollSpy: true });
  initReveal();

  const contactForm = document.querySelector('[data-contact-form]');
  const formStatus = document.querySelector('[data-form-status]');
  const submitBtn = contactForm?.querySelector('button[type="submit"]');
  const messageField = document.getElementById('message');
  let toastTimer = 0;

  function autoGrow() {
    messageField.style.height = 'auto';
    messageField.style.height = `${messageField.scrollHeight}px`;
  }
  messageField?.addEventListener('input', autoGrow);

  function showToast(message, isError) {
    if (!formStatus) return;
    formStatus.textContent = message;
    formStatus.classList.toggle('is-error', isError);
    formStatus.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => formStatus.classList.remove('is-visible'), 4200);
  }

  contactForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(contactForm);
    const fields = {
      name: String(data.get('name') ?? ''),
      email: String(data.get('email') ?? ''),
      message: String(data.get('message') ?? ''),
      website: String(data.get('website') ?? ''),
    };

    const originalBtnContent = submitBtn?.innerHTML;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
      submitBtn.innerHTML = '<span class="btn-dots" aria-hidden="true"><span></span><span></span><span></span></span><span class="sr-only">Sending message…</span>';
    }

    let success = false;
    try {
      const res = await fetch(CONTACT_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(fields),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
      success = true;
    } catch {
      success = false;
    }

    showToast(getFormMessage(fields.name, success), !success);
    if (success) {
      contactForm.reset();
      if (messageField) messageField.style.height = '';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.removeAttribute('aria-busy');
      submitBtn.innerHTML = originalBtnContent;
    }
  });
}

if (typeof document !== 'undefined') initPortfolio();

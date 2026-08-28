import { getMenuState, isInspectionShortcut, selectActiveSection, initSiteChrome, initReveal } from './nav.js';

export { getMenuState, isInspectionShortcut, selectActiveSection };

export function getProjectMessage(projectName) {
  return `${projectName.trim()} case study is being prepared.`;
}

export function getFormMessage(name, opened = true) {
  if (!opened) return 'Gmail was blocked. Allow pop-ups, then submit the form again.';
  const cleanName = name.trim();
  return cleanName
    ? `Gmail opened for ${cleanName}. Review the draft and press Send to deliver your message.`
    : 'Gmail opened. Review the draft and press Send to deliver your message.';
}

export function buildGmailComposeUrl({ name, email, message }) {
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: 'vinas.seanvincentvien@gmail.com',
    su: `Portfolio inquiry from ${name.trim()}`,
    body: `Name: ${name.trim()}\nEmail: ${email.trim()}\n\nMessage:\n${message.trim()}`,
  });
  return `https://mail.google.com/mail/?${params}`;
}

function initPortfolio() {
  initSiteChrome({ scrollSpy: true });
  initReveal();

  const projectStatus = document.querySelector('[data-project-status]');
  document.querySelectorAll('button[data-project-name]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!projectStatus) return;
      projectStatus.textContent = getProjectMessage(button.dataset.projectName ?? 'Project');
      projectStatus.focus({ preventScroll: true });
    });
  });

  const contactForm = document.querySelector('[data-contact-form]');
  const formStatus = document.querySelector('[data-form-status]');
  contactForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(contactForm);
    const fields = {
      name: String(data.get('name') ?? ''),
      email: String(data.get('email') ?? ''),
      message: String(data.get('message') ?? ''),
    };
    const gmailDraft = window.open(buildGmailComposeUrl(fields), '_blank');
    if (gmailDraft) gmailDraft.opener = null;
    if (formStatus) {
      formStatus.textContent = getFormMessage(fields.name, Boolean(gmailDraft));
      formStatus.focus({ preventScroll: true });
    }
    if (gmailDraft) contactForm.reset();
  });
}

if (typeof document !== 'undefined') initPortfolio();

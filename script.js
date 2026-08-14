export function getMenuState(isOpen) {
  return { expanded: String(isOpen), hidden: !isOpen };
}

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

export function isInspectionShortcut(event) {
  const key = event.key.toLowerCase();
  return key === 'f12'
    || Boolean(key === 'i' && ((event.ctrlKey && event.shiftKey) || (event.metaKey && event.altKey)));
}

export function selectActiveSection(entries) {
  const visible = entries
    .filter((entry) => entry.isIntersecting)
    .sort((a, b) => b.ratio - a.ratio);
  return visible[0]?.id ?? null;
}

function initPortfolio() {
  const root = document.documentElement;
  const menuButton = document.querySelector('[data-menu-toggle]');
  const menu = document.querySelector('[data-menu]');
  const navLinks = [...document.querySelectorAll('[data-nav-link]')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  root.classList.add('js');

  function setMenu(open, returnFocus = false) {
    if (!menuButton || !menu) return;
    const state = getMenuState(open);
    menuButton.setAttribute('aria-expanded', state.expanded);
    menu.hidden = state.hidden;
    menu.classList.toggle('is-opening', open);
    document.body.classList.toggle('menu-open', open);
    if (returnFocus) menuButton.focus();
  }

  menuButton?.addEventListener('click', () => {
    setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
  });

  navLinks.forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.forEach((item) => {
        const active = item === link;
        item.classList.toggle('is-active', active);
        if (active) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      });
      setMenu(false);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (isInspectionShortcut(event)) event.preventDefault();
    if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
      setMenu(false, true);
    }
  });

  document.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('dragstart', (event) => {
    if (event.target instanceof HTMLImageElement) event.preventDefault();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 760) setMenu(false);
  });

  const revealItems = [...document.querySelectorAll('[data-reveal]')];
  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  } else {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -7% 0px' });
    revealItems.forEach((item) => revealObserver.observe(item));
  }

  const sections = [...document.querySelectorAll('main > section[id]')];
  if ('IntersectionObserver' in window) {
    const ratios = new Map();
    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        ratios.set(entry.target.id, {
          id: entry.target.id,
          isIntersecting: entry.isIntersecting,
          ratio: entry.intersectionRatio,
        });
      });
      const activeId = selectActiveSection([...ratios.values()]);
      if (!activeId) return;
      navLinks.forEach((link) => {
        const active = link.getAttribute('href') === `#${activeId}`;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
    }, { threshold: [0, 0.05, 0.15, 0.35, 0.6], rootMargin: '-18% 0px -48% 0px' });
    sections.forEach((section) => sectionObserver.observe(section));
  }

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

  document.querySelectorAll('[data-current-year]').forEach((item) => {
    item.textContent = String(new Date().getFullYear());
  });
}

if (typeof document !== 'undefined') initPortfolio();

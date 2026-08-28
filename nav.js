export function getMenuState(isOpen) {
  return { expanded: String(isOpen), hidden: !isOpen };
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

export function initSiteChrome({ scrollSpy = false } = {}) {
  const root = document.documentElement;
  const menuButton = document.querySelector('[data-menu-toggle]');
  const menu = document.querySelector('[data-menu]');
  const navLinks = [...document.querySelectorAll('[data-nav-link]')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let menuTransition = 0;

  root.classList.add('js');

  function setMenu(open, returnFocus = false) {
    if (!menuButton || !menu) return;
    const transition = ++menuTransition;
    const state = getMenuState(open);
    menuButton.setAttribute('aria-expanded', state.expanded);
    document.body.classList.toggle('menu-open', open);
    if (returnFocus) menuButton.focus();

    if (open) {
      menu.hidden = false;
      menu.classList.remove('is-closing');
      menu.classList.add('is-opening');
      return;
    }

    menu.classList.remove('is-opening');
    if (menu.hidden || reducedMotion.matches || window.innerWidth >= 760) {
      menu.hidden = true;
      menu.classList.remove('is-closing');
      return;
    }

    menu.classList.add('is-closing');
    menu.addEventListener('animationend', () => {
      if (transition !== menuTransition) return;
      menu.hidden = true;
      menu.classList.remove('is-closing');
    }, { once: true });
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

  if (scrollSpy) {
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
  }

  document.querySelectorAll('[data-current-year]').forEach((item) => {
    item.textContent = String(new Date().getFullYear());
  });

  return { navLinks, setMenu, reducedMotion };
}

export function initReveal(reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')) {
  const revealItems = [...document.querySelectorAll('[data-reveal]')];
  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    revealItems.forEach((item) => item.classList.add('is-visible'));
    return null;
  }
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      obs.unobserve(entry.target);
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -7% 0px' });
  revealItems.forEach((item) => observer.observe(item));
  return observer;
}

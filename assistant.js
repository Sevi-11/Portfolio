/*
 * AIxia site assistant: the chat widget on every page of the portfolio.
 *
 * It talks to the AIxia backend's existing chat stream in "site" mode, and
 * sends ids for what the visitor has on screen (page, section, and the
 * project card or blog post in view). The backend answers only about that,
 * from website knowledge synced by scripts/build-knowledge.mjs.
 *
 * The pure helpers below are exported for tests and for the knowledge build
 * script, which must slug project titles exactly the way this file does.
 */

const PROD_API = 'https://aixia-project.vercel.app';
// AIxia's frontend dev server, which proxies /api to the local backend the
// same way Vercel does in production. Override with
// localStorage.setItem('aixia-api', 'http://...') when developing.
const LOCAL_API = 'http://localhost:3210';
const STATE_KEY = 'aixia-site-assistant';
const WARM_KEY = 'aixia-site-warmed';
const WARM_EVERY_MS = 10 * 60 * 1000;
const WAKE_NOTICE_MS = 5000;
const MAX_KEPT_MESSAGES = 30;
const MAX_QUESTION = 2000;
const SHEET_QUERY = '(max-width: 47.5rem)';

export const SECTION_LABELS = {
  home: 'Introduction',
  projects: 'Projects',
  about: 'About',
  contact: 'Contact',
  blog: 'Blog',
};

// What "Show me" may touch. Help topics name these keys; the widget never
// takes a selector or a URL from the network.
export const TARGETS = {
  resume: '.resume-card',
  'contact-form': '[data-contact-form]',
  social: '.social-links',
  aixia: '.project-featured',
  projects: '.project-grid',
  'blog-filters': '.blog-filters',
  menu: '[data-menu-toggle]',
};
export const OPEN_TARGETS = { resume: 'assets/resume.pdf', blog: 'blog.html', home: 'index.html' };

const STARTERS = {
  home: ['What does Vince work on?', 'Where can I find his profiles?'],
  projects: ['What is this project about?', 'Where is the code for it?'],
  about: ['Where did Vince study?', 'How do I download the résumé?'],
  contact: ['How do I send a message?', 'Is Vince open to collaborations?'],
  blog: ['What is this post about?', 'How do I filter posts by topic?'],
};

const MESSAGES = {
  intro: "Hi, I'm AIxia. Ask me about what's on your screen: this section, a project or post you're looking at, or how to do something here.",
  thinking: 'Thinking…',
  waking: 'Waking AIxia up. After a quiet spell the first answer can take up to a minute.',
  limit: 'AIxia has answered a lot of questions recently. Please try again in a little while.',
  offline: "Couldn't reach AIxia. Check your connection and try again.",
  empty: 'No answer came back. Please try again.',
};

/* ── Pure helpers ─────────────────────────────────────── */

export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Splits a streamed NDJSON body into events, whatever the chunk boundaries. */
export function createLineParser(onEvent) {
  let buffer = '';
  return {
    push(text) {
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
    },
    end() {
      if (buffer.trim()) onEvent(JSON.parse(buffer));
      buffer = '';
    },
  };
}

// Code first so its contents are never read as emphasis; links before [n] so
// "[text](url)" is not read as a citation.
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]*\]\((?:https?:\/\/|mailto:)[^)\s]+\)|\[\d+\])/g;

export function parseInline(text) {
  return String(text).split(INLINE).filter(Boolean).map((part) => {
    if (/^`[^`]+`$/.test(part)) return { t: 'code', v: part.slice(1, -1) };
    if (/^\*\*[^*]+\*\*$/.test(part)) return { t: 'strong', children: parseInline(part.slice(2, -2)) };
    if (/^\*[^*]+\*$/.test(part)) return { t: 'em', children: parseInline(part.slice(1, -1)) };
    const link = /^\[([^\]]*)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)$/.exec(part);
    if (link) return { t: 'link', href: link[2], text: link[1] || link[2] };
    const cite = /^\[(\d+)\]$/.exec(part);
    if (cite) return { t: 'cite', n: Number(cite[1]) };
    return { t: 'text', v: part };
  });
}

/**
 * The Markdown the site prompt produces: paragraphs, bullet and numbered
 * lists, emphasis, code, https links and [n] citations. Headings are shown as
 * bold lines. Anything else stays plain text. Copes with a half-streamed
 * answer, since it re-runs on every token.
 */
export function parseMarkdown(text) {
  const blocks = [];
  let list = null;
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', inline: parseInline(para.join(' ')) });
    para = [];
  };
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); list = null; continue; }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flush();
      const type = ordered ? 'ol' : 'ul';
      if (!list || list.type !== type) {
        list = { type, items: [], start: ordered ? Number(ordered[1]) : 1 };
        blocks.push(list);
      }
      list.items.push(parseInline(ordered ? ordered[2] : bullet[1]));
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      list = null;
      blocks.push({ type: 'p', inline: [{ t: 'strong', children: parseInline(heading[1]) }] });
      continue;
    }
    list = null;
    para.push(line);
  }
  flush();
  return blocks;
}

export function sourceLabel(source) {
  if (!source) return '';
  if (source.source_type === 'cv' || source.document_id != null) {
    return Number.isInteger(source.page) ? `Vince's CV, page ${source.page + 1}` : "Vince's CV";
  }
  return source.title || 'This site';
}

/**
 * Keeps only the actions this page can carry out. `exists` answers whether a
 * section id or target key resolves to something visible on the page.
 */
export function runnableActions(actions, exists) {
  return (actions || []).filter((action) => {
    if (!action || typeof action.target !== 'string') return false;
    if (action.type === 'scroll') return exists('section', action.target);
    if (action.type === 'highlight') return Object.hasOwn(TARGETS, action.target) && exists('target', action.target);
    if (action.type === 'open') return Object.hasOwn(OPEN_TARGETS, action.target);
    return false;
  });
}

export function contextLabel(context) {
  const section = SECTION_LABELS[context.section] || context.section;
  return context.itemLabel ? `${section} · ${context.itemLabel}` : section;
}

/* ── Browser-only from here ───────────────────────────── */

function apiBase() {
  try {
    const override = localStorage.getItem('aixia-api');
    if (override) return override.replace(/\/+$/, '');
  } catch { /* storage unavailable */ }
  const host = location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '';
  return local ? LOCAL_API : PROD_API;
}

function loadState() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
    if (stored && Array.isArray(stored.messages)) return stored;
  } catch { /* storage unavailable or corrupt */ }
  return { sessionId: null, sessionToken: null, messages: [] };
}

function saveState(state) {
  try {
    const messages = state.messages
      .filter((m) => !m.pending)
      .slice(-MAX_KEPT_MESSAGES)
      .map(({ role, text, sources, actions, error }) => ({ role, text, sources, actions, error }));
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ ...state, messages }));
  } catch { /* storage unavailable; the conversation still works in memory */ }
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children);
  return node;
}

const ICONS = {
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.8h3.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function mostVisible(elements, minRatio = 0) {
  const viewport = window.innerHeight;
  let best = null;
  let bestPx = 0;
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    const px = Math.min(rect.bottom, viewport) - Math.max(rect.top, 0);
    if (px <= 0 || rect.height === 0) continue;
    if (px / Math.min(rect.height, viewport) < minRatio) continue;
    if (px > bestPx) { best = element; bestPx = px; }
  }
  return best;
}

function currentContext() {
  if (document.getElementById('posts-container')) {
    const post = mostVisible(document.querySelectorAll('.blog-post'), 0.4);
    const title = post?.querySelector('.post-title');
    // The heading's id is "post-" + the post's own id.
    const item = title?.id?.startsWith('post-') ? slugify(title.id.slice(5)) : null;
    return { page: 'blog', section: 'blog', item, itemLabel: item ? title.textContent.trim() : null };
  }
  const sections = [...document.querySelectorAll('main > section[id]')].filter((s) => !s.hidden);
  const section = mostVisible(sections)?.id || 'home';
  if (section === 'projects') {
    const card = mostVisible(document.querySelectorAll('.project-card'), 0.5);
    const name = card?.querySelector('h3')?.textContent.trim();
    if (name) return { page: 'home', section, item: slugify(name), itemLabel: name };
  }
  return { page: 'home', section, item: null, itemLabel: null };
}

function requestContext(context) {
  const out = { page: context.page, section: context.section };
  if (context.item) out.item = context.item;
  return out;
}

function findTarget(key) {
  const candidates = [...document.querySelectorAll(TARGETS[key])];
  return candidates.find((node) => node.offsetParent !== null || node.getClientRects().length) || null;
}

function initAssistant() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sheet = window.matchMedia(SHEET_QUERY);
  const state = loadState();
  const thisPage = document.getElementById('posts-container') ? 'blog.html' : 'index.html';
  let context = currentContext();
  let busy = false;

  /* Markup */
  const launcher = el('button', {
    class: 'aixia-launcher', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'aixia-panel',
  }, el('img', { src: 'assets/aixia.svg', alt: '', width: '22', height: '22' }), el('span', { text: 'Ask AIxia' }));

  const contextLine = el('p', { class: 'aixia-context' });
  const resetButton = el('button', { class: 'aixia-icon', type: 'button', 'aria-label': 'Start a new conversation', title: 'New conversation' });
  resetButton.innerHTML = ICONS.reset;
  const closeButton = el('button', { class: 'aixia-icon', type: 'button', 'aria-label': 'Close AIxia' });
  closeButton.innerHTML = ICONS.close;

  const log = el('div', { class: 'aixia-log', role: 'log', 'aria-live': 'polite' });
  const suggestions = el('div', { class: 'aixia-suggestions' });
  const input = el('textarea', {
    id: 'aixia-input', rows: '1', maxlength: String(MAX_QUESTION),
    placeholder: "Ask about what's on screen…", autocomplete: 'off',
  });
  const sendButton = el('button', { class: 'aixia-send', type: 'submit', 'aria-label': 'Send' });
  sendButton.innerHTML = ICONS.send;
  const form = el('form', { class: 'aixia-form' },
    el('label', { class: 'sr-only', for: 'aixia-input', text: "Ask AIxia about what's on screen" }), input, sendButton);

  const panel = el('section', { class: 'aixia-panel', id: 'aixia-panel', role: 'dialog', 'aria-label': 'AIxia site assistant', hidden: true },
    el('header', { class: 'aixia-head' },
      el('div', { class: 'aixia-head-text' }, el('p', { class: 'aixia-title', text: 'Ask AIxia' }), contextLine),
      resetButton, closeButton),
    log, suggestions, form,
    el('p', { class: 'aixia-note', text: "Answers come from this page and Vince's CV, and can be wrong." }));

  document.body.append(el('div', { class: 'aixia' }, launcher, panel));

  /* Rendering */
  function renderInline(tokens, sources, parent) {
    for (const token of tokens) {
      if (token.t === 'text') parent.append(token.v);
      else if (token.t === 'code') parent.append(el('code', { text: token.v }));
      else if (token.t === 'strong' || token.t === 'em') {
        const node = el(token.t);
        renderInline(token.children, sources, node);
        parent.append(node);
      } else if (token.t === 'link') {
        parent.append(el('a', { href: token.href, target: '_blank', rel: 'noopener noreferrer', text: token.text }));
      } else if (token.t === 'cite') {
        const source = sources?.[token.n - 1];
        if (!source) { parent.append(`[${token.n}]`); continue; }
        const label = sourceLabel(source);
        if (source.url) {
          const button = el('button', { class: 'aixia-cite', type: 'button', title: `Go to: ${label}`, 'aria-label': `Source ${token.n}: ${label}`, text: String(token.n) });
          button.addEventListener('click', () => openSource(source));
          parent.append(button);
        } else {
          parent.append(el('span', { class: 'aixia-cite', title: label, 'aria-label': `Source ${token.n}: ${label}`, text: String(token.n) }));
        }
      }
    }
  }

  function renderMarkdown(text, sources) {
    const fragment = document.createDocumentFragment();
    for (const block of parseMarkdown(text)) {
      if (block.type === 'p') {
        const p = el('p');
        renderInline(block.inline, sources, p);
        fragment.append(p);
      } else {
        const list = el(block.type, block.type === 'ol' && block.start !== 1 ? { start: String(block.start) } : {});
        for (const item of block.items) {
          const li = el('li');
          renderInline(item, sources, li);
          list.append(li);
        }
        fragment.append(list);
      }
    }
    return fragment;
  }

  function renderMessage(message) {
    if (message.role === 'user') return el('div', { class: 'aixia-msg user', text: message.text });
    const node = el('div', { class: 'aixia-msg ai' });
    if (message.text) node.append(renderMarkdown(message.text, message.sources));
    if (message.status) node.append(el('p', { class: 'aixia-status', text: message.status }));
    if (message.error) node.append(el('p', { class: 'aixia-error', text: message.error }));
    if (!message.pending) {
      const groups = (message.actions || [])
        .map((group) => ({ ...group, actions: runnableActions(group.actions, actionTargetExists) }))
        .filter((group) => group.actions.length);
      for (const group of groups) {
        const label = groups.length > 1 ? `Show me: ${group.label}` : 'Show me';
        const button = el('button', { class: 'aixia-show', type: 'button', text: label });
        button.addEventListener('click', () => runActions(group.actions));
        node.append(button);
      }
    }
    message.node = node;
    return node;
  }

  function renderLog() {
    log.replaceChildren();
    if (!state.messages.length) log.append(el('div', { class: 'aixia-msg ai aixia-intro', text: MESSAGES.intro }));
    for (const message of state.messages) log.append(renderMessage(message));
    log.scrollTop = log.scrollHeight;
  }

  // Batches the re-render of a streaming answer to one per ~frame. A timer
  // rather than requestAnimationFrame, which never fires while a tab is not
  // being painted and would leave the answer stuck on "Thinking…".
  let renderQueued = null;
  function rerender(message) {
    if (renderQueued) return;
    renderQueued = setTimeout(() => {
      renderQueued = null;
      const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      const old = message.node;
      const fresh = renderMessage(message);
      if (old?.isConnected) old.replaceWith(fresh); else log.append(fresh);
      if (stick) log.scrollTop = log.scrollHeight;
    }, 30);
  }

  function showSuggestions(list) {
    suggestions.replaceChildren(...(list || []).slice(0, 3).map((text) => {
      const chip = el('button', { class: 'aixia-chip', type: 'button', text });
      chip.addEventListener('click', () => ask(text));
      return chip;
    }));
  }

  function refreshContext() {
    // On a phone the panel covers the page, so what was on screen when it
    // opened is still what the visitor means.
    if (!panel.hidden && sheet.matches) return;
    const next = currentContext();
    const changed = next.section !== context.section || next.item !== context.item;
    context = next;
    contextLine.textContent = `Viewing: ${contextLabel(context)}`;
    if (changed && !busy && !state.messages.length) showSuggestions(STARTERS[context.section]);
  }

  /* Actions and citations */
  function actionTargetExists(kind, key) {
    if (kind === 'section') {
      const section = document.getElementById(key);
      return Boolean(section && !section.hidden);
    }
    return Boolean(findTarget(key));
  }

  function spotlight(node) {
    node.classList.remove('aixia-spotlight');
    void node.offsetWidth; // restart the animation if it is already running
    node.classList.add('aixia-spotlight');
    setTimeout(() => node.classList.remove('aixia-spotlight'), 2600);
  }

  const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  async function runActions(actions) {
    // The panel can sit on top of the very thing being pointed at, so it gets
    // out of the way. The conversation is kept; the launcher reopens it.
    close();
    const behavior = reducedMotion.matches ? 'auto' : 'smooth';
    // When something will be highlighted, scrolling to it is the whole
    // journey; a separate section scroll first would be a second jolt.
    const highlights = actions.some((action) => action.type === 'highlight');
    for (const action of actions) {
      if (action.type === 'scroll') {
        if (highlights) continue;
        document.getElementById(action.target)?.scrollIntoView({ behavior, block: 'start' });
        await wait(behavior === 'smooth' ? 550 : 50);
      } else if (action.type === 'highlight') {
        const node = findTarget(action.target);
        if (!node) continue;
        node.scrollIntoView({ behavior, block: 'center' });
        await wait(behavior === 'smooth' ? 450 : 50);
        spotlight(node);
      } else if (action.type === 'open') {
        const url = OPEN_TARGETS[action.target];
        if (action.target === 'resume') window.open(url, '_blank', 'noopener');
        else window.location.href = url;
        return;
      }
    }
  }

  function openSource(source) {
    const [file, hash] = String(source.url).split('#');
    if (file !== thisPage) { window.location.href = source.url; return; }
    const target = hash && document.getElementById(hash);
    if (!target) return;
    if (sheet.matches) close();
    target.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    spotlight(target);
  }

  /* Talking to AIxia */
  function post(body) {
    return fetch(`${apiBase()}/api/chat/stream/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function ask(rawQuestion) {
    const question = rawQuestion.trim().slice(0, MAX_QUESTION);
    if (!question || busy) return;
    busy = true;
    sendButton.disabled = true;
    log.setAttribute('aria-busy', 'true');
    showSuggestions([]);
    input.value = '';
    autoGrow();

    refreshContext();
    const user = { role: 'user', text: question };
    const reply = { role: 'ai', text: '', sources: [], actions: [], pending: true, status: MESSAGES.thinking };
    if (!state.messages.length) log.replaceChildren();
    state.messages.push(user, reply);
    log.append(renderMessage(user), renderMessage(reply));
    log.scrollTop = log.scrollHeight;

    const wakeTimer = setTimeout(() => { reply.status = MESSAGES.waking; rerender(reply); }, WAKE_NOTICE_MS);
    let nextSuggestions = [];

    try {
      const body = { question, mode: 'site', context: requestContext(context) };
      if (state.sessionId) Object.assign(body, { session_id: state.sessionId, session_token: state.sessionToken });
      let response = await post(body);
      if ((response.status === 403 || response.status === 404) && state.sessionId) {
        // An expired or unknown session: start a fresh one rather than fail.
        state.sessionId = null;
        state.sessionToken = null;
        delete body.session_id;
        delete body.session_token;
        response = await post(body);
      }
      if (response.status === 429) throw Object.assign(new Error(MESSAGES.limit), { friendly: true });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const parser = createLineParser((event) => {
        clearTimeout(wakeTimer);
        if (event.type === 'sources') reply.sources = event.sources || [];
        else if (event.type === 'token') { reply.text += event.content; reply.status = null; }
        else if (event.type === 'actions') reply.actions = event.actions || [];
        else if (event.type === 'suggestions') nextSuggestions = event.suggestions || [];
        else if (event.type === 'error') reply.error = event.message;
        else if (event.type === 'done') {
          state.sessionId = event.session_id;
          state.sessionToken = event.session_token;
        }
        rerender(reply);
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.end();
      if (!reply.text && !reply.error) reply.error = MESSAGES.empty;
    } catch (error) {
      reply.error = error.friendly ? error.message : MESSAGES.offline;
    } finally {
      clearTimeout(wakeTimer);
      reply.pending = false;
      reply.status = null;
      rerender(reply);
      busy = false;
      sendButton.disabled = false;
      log.removeAttribute('aria-busy');
      showSuggestions(nextSuggestions);
      saveState(state);
    }
  }

  function warmUp() {
    // Render's free tier sleeps when idle. A cheap request on page load gets
    // it waking before anyone asks a question.
    try {
      const last = Number(sessionStorage.getItem(WARM_KEY) || 0);
      if (Date.now() - last < WARM_EVERY_MS) return;
      sessionStorage.setItem(WARM_KEY, String(Date.now()));
    } catch { /* storage unavailable: ping anyway */ }
    fetch(`${apiBase()}/api/healthz`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
  }

  /* Opening and closing */
  function open() {
    context = currentContext();
    contextLine.textContent = `Viewing: ${contextLabel(context)}`;
    panel.hidden = false;
    launcher.hidden = true;
    launcher.setAttribute('aria-expanded', 'true');
    document.body.classList.toggle('aixia-sheet-open', sheet.matches);
    renderLog();
    if (!busy) showSuggestions(state.messages.length ? [] : STARTERS[context.section]);
    input.focus();
  }

  function close() {
    panel.hidden = true;
    launcher.hidden = false;
    launcher.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('aixia-sheet-open');
    launcher.focus({ preventScroll: true });
  }

  function reset() {
    if (busy) return;
    state.sessionId = null;
    state.sessionToken = null;
    state.messages = [];
    saveState(state);
    renderLog();
    showSuggestions(STARTERS[context.section]);
    input.focus();
  }

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  }

  launcher.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  resetButton.addEventListener('click', reset);
  form.addEventListener('submit', (event) => { event.preventDefault(); ask(input.value); });
  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      ask(input.value);
    }
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
  });

  let scrollQueued = false;
  window.addEventListener('scroll', () => {
    if (panel.hidden || scrollQueued) return;
    scrollQueued = true;
    setTimeout(() => { scrollQueued = false; refreshContext(); }, 120);
  }, { passive: true });

  if (document.readyState === 'complete') setTimeout(warmUp, 1500);
  else window.addEventListener('load', () => setTimeout(warmUp, 1500), { once: true });
}

if (typeof document !== 'undefined') initAssistant();

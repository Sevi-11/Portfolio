import { initSiteChrome, initReveal } from './nav.js';

const GITHUB_OWNER = 'Sevi-11';
const GITHUB_REPO = 'Portfolio';
const GITHUB_BRANCH = 'master';
const GITHUB_DATA_PATH = 'blog-data.json';
const OWNER_TOKEN_KEY = 'portfolio_owner_token';

export function isLocalHost(hostname = location.hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '';
}

function getOwnerToken() {
  try { return localStorage.getItem(OWNER_TOKEN_KEY) || ''; } catch { return ''; }
}

function setOwnerToken(token) {
  try {
    if (token) localStorage.setItem(OWNER_TOKEN_KEY, token);
    else localStorage.removeItem(OWNER_TOKEN_KEY);
  } catch { /* localStorage unavailable */ }
}

function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function decodeBase64Utf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function publishViaGithubApi(post, token) {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_DATA_PATH}`;
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
  };

  const getRes = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
  if (!getRes.ok) throw new Error(`Couldn't read blog-data.json from GitHub (HTTP ${getRes.status}). Check your token.`);
  const file = await getRes.json();
  const currentPosts = JSON.parse(decodeBase64Utf8(file.content));
  const updatedPosts = [post, ...currentPosts];

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Add blog post: ${post.title}`,
      content: encodeBase64Utf8(JSON.stringify(updatedPosts, null, 2) + '\n'),
      sha: file.sha,
      branch: GITHUB_BRANCH,
    }),
  });
  if (!putRes.ok) {
    const err = await putRes.json().catch(() => null);
    throw new Error(err?.message || `GitHub publish failed (HTTP ${putRes.status}).`);
  }
  return post;
}

/* ── Owner access ─────────────────────────────────────── */

function initOwnerAccess() {
  const composeSection = document.getElementById('compose');
  const signinBtn = document.querySelector('[data-owner-signin]');
  const panel = document.querySelector('[data-owner-panel]');
  const tokenInput = document.getElementById('owner-token');
  const unlockBtn = document.querySelector('[data-owner-unlock]');
  const cancelBtn = document.querySelector('[data-owner-cancel]');
  if (!composeSection) return;

  function applyState() {
    const unlocked = isLocalHost() || Boolean(getOwnerToken());
    composeSection.hidden = !unlocked;
    if (signinBtn) {
      signinBtn.hidden = isLocalHost();
      signinBtn.textContent = getOwnerToken() ? 'Owner sign-out' : 'Owner sign-in';
    }
  }

  signinBtn?.addEventListener('click', () => {
    if (getOwnerToken()) {
      setOwnerToken('');
      applyState();
      return;
    }
    panel.hidden = false;
    tokenInput?.focus();
  });

  cancelBtn?.addEventListener('click', () => {
    panel.hidden = true;
    tokenInput.value = '';
  });

  unlockBtn?.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    if (!token) return;
    setOwnerToken(token);
    tokenInput.value = '';
    panel.hidden = true;
    applyState();
    composeSection.scrollIntoView({ behavior: 'smooth' });
  });

  applyState();
}

export function formatDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatTimestamp(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function renderContentBlock(block) {
  switch (block.type) {
    case 'text':
      return `<p class="post-text">${escapeHtml(block.body)}</p>`;
    case 'image':
      return `<figure class="post-image"><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt || '')}" loading="lazy"></figure>`;
    case 'video':
      return block.src.startsWith('data:video')
        ? `<div class="post-video post-video-file"><video src="${escapeHtml(block.src)}" controls preload="metadata"></video></div>`
        : `<div class="post-video"><iframe src="${escapeHtml(block.src)}" title="${escapeHtml(block.title || '')}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
    default:
      return '';
  }
}

export function renderPost(post) {
  const contentHtml = post.content.map(renderContentBlock).join('');
  const tagsHtml = post.tags?.length
    ? `<ul class="tag-list" aria-label="Tags">${post.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
    : '';
  const timestampHtml = post.createdAt
    ? `<span class="post-timestamp">Posted at ${formatTimestamp(post.createdAt)}</span>`
    : '';

  return `
    <article class="blog-post" data-reveal aria-labelledby="post-${post.id}">
      <header class="post-header">
        <time class="post-date" datetime="${post.date}">${formatDate(post.date)}</time>
        ${timestampHtml}
        <h3 class="post-title" id="post-${post.id}">${escapeHtml(post.title)}</h3>
      </header>
      <div class="post-body">${contentHtml}</div>
      ${tagsHtml}
    </article>`;
}

export function renderPosts(posts, container) {
  if (!posts.length) {
    container.innerHTML = '<p class="empty-state">No posts yet. Check back soon.</p>';
    return;
  }
  container.innerHTML = posts.map(renderPost).join('');
}

export function collectTags(posts) {
  const tagSet = new Set();
  posts.forEach((post) => post.tags?.forEach((t) => tagSet.add(t)));
  return [...tagSet].sort();
}

export function filterByTag(posts, tag) {
  if (tag === 'all') return posts;
  return posts.filter((post) => post.tags?.includes(tag));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ── Composer ─────────────────────────────────────────── */

function initComposer(onPublished) {
  const form = document.querySelector('[data-composer-form]');
  if (!form) return;

  const titleInput = document.getElementById('post-title');
  const dateInput = document.getElementById('post-date');
  const tagsInput = document.getElementById('post-tags');
  const blocksList = document.getElementById('blocks-list');
  const previewEl = document.getElementById('composer-preview');
  const previewCard = document.getElementById('preview-card');
  const statusEl = document.querySelector('[data-composer-status]');
  const previewBtn = document.querySelector('[data-preview-toggle]');
  const publishBtn = document.querySelector('[data-publish]');

  const now = new Date();
  dateInput.value = now.toISOString().slice(0, 10);

  let blocks = [];
  let blockId = 0;
  let previewVisible = false;

  function getBlockLabel(type) {
    return { text: 'Text', image: 'Image', video: 'Video' }[type] || type;
  }

  function createBlockField(type) {
    const id = ++blockId;
    const item = document.createElement('div');
    item.className = 'block-item';
    item.dataset.blockId = id;
    item.dataset.blockType = type;

    let inner = `
      <div class="block-item-header">
        <span class="block-type-badge">${getBlockLabel(type)}</span>
        <button type="button" class="block-remove-btn" data-remove-block="${id}" aria-label="Remove ${getBlockLabel(type)} block">&times;</button>
      </div>`;

    if (type === 'text') {
      inner += `<textarea placeholder="Write your thoughts..." data-block-field="body"></textarea>`;
    } else if (type === 'image') {
      inner += `
        <div class="upload-row">
          <button type="button" class="upload-btn" data-upload-trigger>Upload image</button>
          <input type="file" accept="image/*" data-block-upload hidden>
          <span class="upload-status" data-upload-status>No file chosen</span>
        </div>
        <img class="block-thumb" data-block-thumb hidden alt="">
        <div class="field-row">
          <div><label>Image URL</label><input type="text" placeholder="or paste an image URL" data-block-field="src"></div>
          <div><label>Alt text</label><input type="text" placeholder="Describe the image" data-block-field="alt"></div>
        </div>`;
    } else if (type === 'video') {
      inner += `
        <div class="upload-row">
          <button type="button" class="upload-btn" data-upload-trigger>Upload video</button>
          <input type="file" accept="video/*" data-block-upload hidden>
          <span class="upload-status" data-upload-status>No file chosen</span>
        </div>
        <div class="field-row">
          <div><label>Video URL</label><input type="text" placeholder="or paste an embed URL (YouTube, etc.)" data-block-field="src"></div>
          <div><label>Title</label><input type="text" placeholder="Video title" data-block-field="title"></div>
        </div>`;
    }

    item.innerHTML = inner;
    if (type === 'image' || type === 'video') wireUpload(item, type);
    return item;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function wireUpload(item, type) {
    const trigger = item.querySelector('[data-upload-trigger]');
    const fileInput = item.querySelector('[data-block-upload]');
    const status = item.querySelector('[data-upload-status]');
    const srcField = item.querySelector('[data-block-field="src"]');
    const thumb = item.querySelector('[data-block-thumb]');
    const maxBytes = 25 * 1024 * 1024;

    trigger?.addEventListener('click', () => fileInput.click());

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > maxBytes) {
        status.textContent = `${file.name} is too large (25MB max).`;
        fileInput.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        srcField.value = String(reader.result);
        status.textContent = `${file.name} (${formatBytes(file.size)})`;
        if (thumb && type === 'image') {
          thumb.src = String(reader.result);
          thumb.hidden = false;
        }
        if (previewVisible) updatePreview();
      };
      reader.onerror = () => { status.textContent = `Couldn't read ${file.name}.`; };
      reader.readAsDataURL(file);
    });

    srcField?.addEventListener('input', () => {
      if (!srcField.value.startsWith('data:')) {
        status.textContent = 'No file chosen';
        fileInput.value = '';
        if (thumb) thumb.hidden = true;
      }
    });
  }

  function addBlock(type) {
    const el = createBlockField(type);
    blocksList.appendChild(el);
    blocks.push({ id: ++blockId, type, el });
    if (previewVisible) updatePreview();
  }

  function collectBlocks() {
    return [...blocksList.querySelectorAll('.block-item')].map((item) => {
      const type = item.dataset.blockType;
      const data = { type };
      if (type === 'text') {
        data.body = item.querySelector('[data-block-field="body"]').value;
      } else {
        data.src = item.querySelector('[data-block-field="src"]').value;
        if (type === 'image') data.alt = item.querySelector('[data-block-field="alt"]').value;
        if (type === 'video') data.title = item.querySelector('[data-block-field="title"]').value;
      }
      return data;
    });
  }

  function collectTagsFromInput() {
    return tagsInput.value
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }

  function buildPostObject() {
    const now = new Date();
    return {
      id: 'post-' + String(Date.now()).slice(-6),
      title: titleInput.value.trim(),
      date: dateInput.value,
      createdAt: now.toISOString(),
      tags: collectTagsFromInput(),
      content: collectBlocks(),
    };
  }

  function updatePreview() {
    const post = buildPostObject();
    previewCard.innerHTML = `
      <header class="post-header">
        <time class="post-date" datetime="${post.date}">${formatDate(post.date)}</time>
        <span class="post-timestamp">Posted at ${formatTimestamp(post.createdAt)}</span>
        <h3 class="post-title">${escapeHtml(post.title || 'Untitled')}</h3>
      </header>
      <div class="post-body">${post.content.map(renderContentBlock).join('')}</div>
      ${post.tags.length ? `<ul class="tag-list" aria-label="Tags">${post.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}`;
  }

  function showStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#c83232' : 'var(--navy)';
    setTimeout(() => { statusEl.textContent = ''; }, 3500);
  }

  function resetComposer() {
    titleInput.value = '';
    tagsInput.value = '';
    dateInput.value = new Date().toISOString().slice(0, 10);
    blocksList.innerHTML = '';
    blocks = [];
    previewVisible = false;
    previewEl.hidden = true;
    previewCard.innerHTML = '';
    if (previewBtn) previewBtn.textContent = 'Preview';
  }

  blocksList.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove-block]');
    if (!removeBtn) return;
    const item = removeBtn.closest('.block-item');
    if (item) {
      item.remove();
      if (previewVisible) updatePreview();
    }
  });

  document.querySelector('[data-add-block="text"]')?.addEventListener('click', () => addBlock('text'));
  document.querySelector('[data-add-block="image"]')?.addEventListener('click', () => addBlock('image'));
  document.querySelector('[data-add-block="video"]')?.addEventListener('click', () => addBlock('video'));

  previewBtn?.addEventListener('click', () => {
    previewVisible = !previewVisible;
    previewEl.hidden = !previewVisible;
    previewBtn.textContent = previewVisible ? 'Hide preview' : 'Preview';
    if (previewVisible) updatePreview();
  });

  publishBtn?.addEventListener('click', async () => {
    const post = buildPostObject();
    if (!post.title) { showStatus('Add a title before publishing.', true); return; }
    if (!post.content.length) { showStatus('Add at least one content block.', true); return; }

    publishBtn.disabled = true;
    publishBtn.innerHTML = 'Publishing…';
    try {
      let published;
      let liveMessage = 'Published. Your post is live below.';

      if (isLocalHost()) {
        const res = await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(post),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
        published = payload;
      } else {
        const token = getOwnerToken();
        if (!token) throw new Error('Sign in as owner first.');
        published = await publishViaGithubApi(post, token);
        liveMessage = 'Published to GitHub. The live site updates in about a minute as Pages rebuilds.';
      }

      resetComposer();
      showStatus(liveMessage);
      onPublished?.(published);
    } catch (err) {
      showStatus(`Couldn't publish: ${err.message}`, true);
    } finally {
      publishBtn.disabled = false;
      publishBtn.innerHTML = 'Publish post <span aria-hidden="true">↑</span>';
    }
  });

  form.addEventListener('input', () => {
    if (previewVisible) updatePreview();
  });
}

function initBlog() {
  const container = document.getElementById('posts-container');
  const loading = document.querySelector('[data-loading]');
  const filtersEl = document.querySelector('.blog-filters');

  initSiteChrome();
  initOwnerAccess();

  let allPosts = [];
  let activeTag = 'all';

  function render() {
    const filtered = filterByTag(allPosts, activeTag);
    renderPosts(filtered, container);
    initReveal();
  }

  function syncFilterButtons(tags) {
    if (!filtersEl) return;
    [...filtersEl.querySelectorAll('.filter-btn:not([data-tag="all"])')].forEach((btn) => btn.remove());
    tags.forEach((tag) => {
      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.type = 'button';
      btn.dataset.tag = tag;
      btn.textContent = tag;
      if (tag === activeTag) btn.classList.add('is-active');
      filtersEl.appendChild(btn);
    });
  }

  filtersEl?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-tag]');
    if (!btn) return;
    activeTag = btn.dataset.tag;
    filtersEl.querySelectorAll('.filter-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tag === activeTag));
    render();
  });

  function addPublishedPost(post) {
    allPosts = [post, ...allPosts].sort((a, b) => b.date.localeCompare(a.date));
    activeTag = 'all';
    filtersEl?.querySelectorAll('.filter-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tag === 'all'));
    syncFilterButtons(collectTags(allPosts));
    render();
  }

  initComposer(addPublishedPost);

  fetch('blog-data.json')
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((posts) => {
      allPosts = posts.sort((a, b) => b.date.localeCompare(a.date));
      if (loading) loading.remove();
      syncFilterButtons(collectTags(allPosts));
      render();
    })
    .catch(() => {
      if (loading) loading.textContent = 'Failed to load posts.';
    });
}

if (typeof document !== 'undefined') initBlog();

import { initSiteChrome, initReveal } from './nav.js?v=20261003';

const GITHUB_OWNER = 'Sevi-11';
const GITHUB_REPO = 'Portfolio';
const GITHUB_BRANCH = 'master';
const GITHUB_DATA_PATH = 'blog-data.json';
const GITHUB_ARCHIVE_PATH = 'blog-archive.json';
const MEDIA_DIR = 'assets/blog';
const OWNER_TOKEN_KEY = 'portfolio_owner_token';

export function isLocalHost(hostname = location.hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '';
}

// sessionStorage, not localStorage: every GitHub Pages site under
// sevi-11.github.io shares one origin, so a token left in localStorage would be
// readable by any of them. A session-scoped token dies with the tab.
function getOwnerToken() {
  try { return sessionStorage.getItem(OWNER_TOKEN_KEY) || ''; } catch { return ''; }
}

function setOwnerToken(token) {
  try {
    if (token) sessionStorage.setItem(OWNER_TOKEN_KEY, token);
    else sessionStorage.removeItem(OWNER_TOKEN_KEY);
  } catch { /* sessionStorage unavailable */ }
}

// Earlier versions kept the token in localStorage; don't leave it behind.
function forgetLegacyToken() {
  try { localStorage.removeItem(OWNER_TOKEN_KEY); } catch { /* localStorage unavailable */ }
}

export function createPostId() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `post-${Date.now().toString(36)}-${suffix}`;
}

// Browsers drop tabs, newlines and other control characters while parsing a
// URL, so "java\tscript:" still runs. Strip them before checking the scheme,
// and render the cleaned value rather than the original.
export function cleanUrl(src) {
  return String(src ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function isRelativePath(src) {
  return Boolean(src) && !src.startsWith('//') && !/^[a-z][a-z0-9+.-]*:/i.test(src);
}

// Allowed sources per block: https URLs, an inline data: URL of the right kind,
// or a path inside this site (where uploaded media is stored).
export function safeMediaSrc(src, kind) {
  const url = cleanUrl(src);
  if (kind === 'embed') return /^https:\/\//i.test(url) ? url : '';
  if (/^https:\/\//i.test(url) && kind === 'image') return url;
  if (url.toLowerCase().startsWith(`data:${kind}/`)) return url;
  return isRelativePath(url) ? url : '';
}

export function isVideoFile(src) {
  const url = cleanUrl(src);
  return url.toLowerCase().startsWith('data:video/') || isRelativePath(url);
}

const MEDIA_EXTENSIONS = { jpeg: 'jpg', 'svg+xml': 'svg', quicktime: 'mov', 'x-matroska': 'mkv' };

export function parseDataUrl(src) {
  const match = /^data:(image|video)\/([\w.+-]+);base64,(.+)$/i.exec(cleanUrl(src));
  if (!match) return null;
  const subtype = match[2].toLowerCase();
  const ext = (MEDIA_EXTENSIONS[subtype] || subtype).replace(/[^a-z0-9]/g, '') || 'bin';
  return { kind: match[1].toLowerCase(), ext, base64: match[3] };
}

// Only names this code generates, so a hand-edited "assets/blog/../x" can never
// point a delete somewhere else.
const MEDIA_PATH = new RegExp(`^${MEDIA_DIR}/post-[a-z0-9]+-[a-f0-9]+-\\d+\\.[a-z0-9]+$`);

export function mediaPathsOf(post) {
  return (post.content ?? [])
    .map((block) => cleanUrl(block.src))
    .filter((src) => MEDIA_PATH.test(src));
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

function githubContentsUrl(path) {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
}

function githubHeaders(token, accept = 'application/vnd.github+json') {
  return { Authorization: `token ${token}`, Accept: accept };
}

async function getGithubFile(path, token) {
  const url = `${githubContentsUrl(path)}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, { headers: githubHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Couldn't read ${path} from GitHub (HTTP ${res.status}). Check your token.`);
  const file = await res.json();

  // The JSON response only inlines files up to 1 MB; past that `content` is
  // empty and the body has to be requested raw.
  let text;
  if (file.encoding === 'base64' && file.content) {
    text = decodeBase64Utf8(file.content);
  } else {
    const raw = await fetch(url, { headers: githubHeaders(token, 'application/vnd.github.raw+json') });
    if (!raw.ok) throw new Error(`Couldn't read ${path} from GitHub (HTTP ${raw.status}).`);
    text = await raw.text();
  }
  return { sha: file.sha, posts: JSON.parse(text) };
}

async function putGithubContent(path, base64Content, sha, message, token) {
  const body = { message, content: base64Content, branch: GITHUB_BRANCH };
  if (sha) body.sha = sha;

  const res = await fetch(githubContentsUrl(path), {
    method: 'PUT',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.message || `GitHub write to ${path} failed (HTTP ${res.status}).`);
  }
}

function putGithubFile(path, posts, sha, message, token) {
  return putGithubContent(path, encodeBase64Utf8(JSON.stringify(posts, null, 2) + '\n'), sha, message, token);
}

async function deleteGithubFile(path, token) {
  const meta = await fetch(`${githubContentsUrl(path)}?ref=${GITHUB_BRANCH}`, { headers: githubHeaders(token) });
  if (meta.status === 404) return;
  if (!meta.ok) throw new Error(`Couldn't read ${path} from GitHub (HTTP ${meta.status}).`);
  const { sha } = await meta.json();
  const res = await fetch(githubContentsUrl(path), {
    method: 'DELETE',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Delete blog media: ${path}`, sha, branch: GITHUB_BRANCH }),
  });
  if (!res.ok) throw new Error(`Couldn't delete ${path} from GitHub (HTTP ${res.status}).`);
}

// Uploaded images and videos become files of their own instead of base64
// strings inside blog-data.json, which would otherwise grow by the size of
// every upload and get re-downloaded by every visitor.
async function uploadMediaViaGithubApi(post, token) {
  const content = [];
  for (const [index, block] of post.content.entries()) {
    const media = parseDataUrl(block.src);
    if (!media) {
      content.push(block);
      continue;
    }
    const path = `${MEDIA_DIR}/${post.id}-${index + 1}.${media.ext}`;
    await putGithubContent(path, media.base64, null, `Add blog media: ${path}`, token);
    content.push({ ...block, src: path });
  }
  return { ...post, content };
}

async function publishViaGithubApi(post, token) {
  const dataFile = await getGithubFile(GITHUB_DATA_PATH, token);
  if (!dataFile) throw new Error(`${GITHUB_DATA_PATH} not found in repo.`);
  const published = await uploadMediaViaGithubApi(post, token);
  const updatedPosts = [published, ...dataFile.posts];
  await putGithubFile(GITHUB_DATA_PATH, updatedPosts, dataFile.sha, `Add blog post: ${post.title}`, token);
  return published;
}

async function deletePostViaGithubApi(postId, token, { archive = true } = {}) {
  const dataFile = await getGithubFile(GITHUB_DATA_PATH, token);
  if (!dataFile) throw new Error(`${GITHUB_DATA_PATH} not found in repo.`);
  const index = dataFile.posts.findIndex((p) => p.id === postId);
  if (index === -1) throw new Error('Post not found.');

  const [removed] = dataFile.posts.splice(index, 1);
  await putGithubFile(
    GITHUB_DATA_PATH,
    dataFile.posts,
    dataFile.sha,
    `${archive ? 'Archive' : 'Delete'} blog post: ${removed.title}`,
    token,
  );

  if (archive) {
    const archiveFile = await getGithubFile(GITHUB_ARCHIVE_PATH, token);
    const archivePosts = archiveFile ? archiveFile.posts : [];
    archivePosts.unshift({ ...removed, archivedAt: new Date().toISOString() });
    await putGithubFile(GITHUB_ARCHIVE_PATH, archivePosts, archiveFile?.sha, `Archive blog post: ${removed.title}`, token);
  } else {
    // An archived post keeps its media; a permanently deleted one takes it along.
    // A leftover file is harmless, so a failure here must not report the
    // (already committed) post deletion as failed.
    for (const path of mediaPathsOf(removed)) {
      await deleteGithubFile(path, token).catch((err) => console.warn(err));
    }
  }

  return removed;
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
  forgetLegacyToken();

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
    case 'image': {
      const src = safeMediaSrc(block.src, 'image');
      if (!src) return '';
      return `<figure class="post-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(block.alt || '')}" loading="lazy"></figure>`;
    }
    case 'video': {
      if (isVideoFile(block.src)) {
        const src = safeMediaSrc(block.src, 'video');
        if (!src) return '';
        return `<div class="post-video post-video-file"><video src="${escapeHtml(src)}" controls preload="metadata"></video></div>`;
      }
      const src = safeMediaSrc(block.src, 'embed');
      if (!src) return '';
      return `<div class="post-video"><iframe src="${escapeHtml(src)}" title="${escapeHtml(block.title || '')}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
    }
    default:
      return '';
  }
}

// Mirrors renderContentBlock: a block it would silently drop is one the
// composer should refuse to publish.
export function findUnsafeBlock(blocks) {
  return blocks.find((block) => {
    if (block.type === 'image') return !safeMediaSrc(block.src, 'image');
    if (block.type === 'video') return !safeMediaSrc(block.src, isVideoFile(block.src) ? 'video' : 'embed');
    return false;
  }) ?? null;
}

export function renderPost(post, { ownerMode = false } = {}) {
  const contentHtml = post.content.map(renderContentBlock).join('');
  const tagsHtml = post.tags?.length
    ? `<ul class="tag-list" aria-label="Tags">${post.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
    : '';
  const timestampHtml = post.createdAt
    ? `<span class="post-timestamp">Posted at ${formatTimestamp(post.createdAt)}</span>`
    : '';
  const deleteHtml = ownerMode
    ? `<button type="button" class="post-delete-btn" data-delete-post="${escapeHtml(post.id)}" aria-label="Delete post: ${escapeHtml(post.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3m-9 0 1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
    : '';

  return `
    <article class="blog-post" data-reveal aria-labelledby="post-${post.id}">
      ${deleteHtml}
      <header class="post-header">
        <time class="post-date" datetime="${post.date}">${formatDate(post.date)}</time>
        ${timestampHtml}
        <h3 class="post-title" id="post-${post.id}">${escapeHtml(post.title)}</h3>
      </header>
      <div class="post-body">${contentHtml}</div>
      ${tagsHtml}
    </article>`;
}

export function renderPosts(posts, container, ownerMode = false) {
  if (!posts.length) {
    container.innerHTML = '<p class="empty-state">No posts yet. Check back soon.</p>';
    return;
  }
  container.innerHTML = posts.map((post) => renderPost(post, { ownerMode })).join('');
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

export function getFeedCopy(tag) {
  if (tag === 'all') return { kicker: 'All entries', title: 'The trail so far.' };
  return { kicker: tag, title: `The trail on ${tag}.` };
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
      id: createPostId(),
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
    if (findUnsafeBlock(post.content)) {
      showStatus('Media links must be https:// URLs or uploaded files.', true);
      return;
    }

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
  const feedKicker = document.querySelector('[data-feed-kicker]');
  const feedTitle = document.querySelector('[data-feed-title]');
  const feedStatus = document.querySelector('[data-feed-status]');

  initSiteChrome();
  initOwnerAccess();

  let allPosts = [];
  let activeTag = 'all';

  function isOwnerMode() {
    return isLocalHost() || Boolean(getOwnerToken());
  }

  function render() {
    const filtered = filterByTag(allPosts, activeTag);
    renderPosts(filtered, container, isOwnerMode());
    const copy = getFeedCopy(activeTag);
    if (feedKicker) feedKicker.textContent = copy.kicker;
    if (feedTitle) feedTitle.textContent = copy.title;
    initReveal();
  }

  function showFeedStatus(message, isError) {
    if (!feedStatus) return;
    feedStatus.textContent = message;
    feedStatus.style.color = isError ? '#c83232' : 'var(--navy)';
    setTimeout(() => { feedStatus.textContent = ''; }, 3500);
  }

  /* ── Delete modal ─────────────────────────────────────── */

  const deleteModal = document.querySelector('[data-delete-modal]');
  const deleteModalBody = document.querySelector('[data-delete-modal-body]');
  const deleteCancelBtn = document.querySelector('[data-delete-cancel]');
  const deleteArchiveBtn = document.querySelector('[data-delete-archive]');
  const deleteForeverBtn = document.querySelector('[data-delete-forever]');
  let pendingDelete = null;

  function openDeleteModal(post, triggerBtn) {
    pendingDelete = { postId: post.id, triggerBtn };
    if (deleteModalBody) {
      deleteModalBody.textContent = `"${post.title}" — archive it to keep a copy, or delete it permanently. Permanent deletion can't be undone.`;
    }
    if (deleteModal) {
      deleteModal.hidden = false;
      deleteArchiveBtn?.focus();
    }
  }

  function closeDeleteModal() {
    if (deleteModal) deleteModal.hidden = true;
    pendingDelete = null;
  }

  function cancelDelete() {
    const triggerBtn = pendingDelete?.triggerBtn;
    if (triggerBtn) triggerBtn.disabled = false;
    closeDeleteModal();
    triggerBtn?.focus();
  }

  async function performDelete(archive) {
    if (!pendingDelete) return;
    const { postId, triggerBtn } = pendingDelete;
    [deleteArchiveBtn, deleteForeverBtn, deleteCancelBtn].forEach((b) => { if (b) b.disabled = true; });

    try {
      if (isLocalHost()) {
        const mode = archive ? 'archive' : 'forever';
        const res = await fetch(`/api/posts/${encodeURIComponent(postId)}?mode=${mode}`, { method: 'DELETE' });
        const payload = await res.json().catch(() => null);
        if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
      } else {
        const token = getOwnerToken();
        if (!token) throw new Error('Sign in as owner first.');
        await deletePostViaGithubApi(postId, token, { archive });
      }

      allPosts = allPosts.filter((p) => p.id !== postId);
      syncFilterButtons(collectTags(allPosts));
      render();
      showFeedStatus(archive ? 'Post archived.' : 'Post deleted permanently.');
      closeDeleteModal();
    } catch (err) {
      showFeedStatus(`Couldn't delete: ${err.message}`, true);
      if (triggerBtn) triggerBtn.disabled = false;
      closeDeleteModal();
    } finally {
      [deleteArchiveBtn, deleteForeverBtn, deleteCancelBtn].forEach((b) => { if (b) b.disabled = false; });
    }
  }

  deleteCancelBtn?.addEventListener('click', cancelDelete);
  deleteArchiveBtn?.addEventListener('click', () => performDelete(true));
  deleteForeverBtn?.addEventListener('click', () => performDelete(false));
  deleteModal?.addEventListener('click', (event) => {
    if (event.target === deleteModal) cancelDelete();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && deleteModal && !deleteModal.hidden) cancelDelete();
  });

  container.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-delete-post]');
    if (!btn || !isOwnerMode()) return;

    const postId = btn.dataset.deletePost;
    const post = allPosts.find((p) => p.id === postId);
    if (!post) return;

    btn.disabled = true;
    openDeleteModal(post, btn);
  });

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

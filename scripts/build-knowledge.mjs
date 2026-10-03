#!/usr/bin/env node
/*
 * Builds the website knowledge AIxia's site assistant answers from.
 *
 *   node scripts/build-knowledge.mjs          print the entries as JSON
 *   node scripts/build-knowledge.mjs --sync   send them to AIxia
 *
 * --sync reads AIXIA_API_URL (e.g. https://aixia-backend.onrender.com) and
 * AIXIA_SYNC_TOKEN from the environment. The GitHub Action in
 * .github/workflows/sync-aixia.yml runs it on every push that changes the site.
 *
 * One entry per home-page section, per project card, per blog post and per
 * how-to topic in knowledge/help.md. AIxia hashes each entry and re-embeds
 * only the ones that changed, so running this often is cheap.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { slugify } from '../assistant.js';

const root = new URL('../', import.meta.url);

const SECTION_TITLES = {
  home: 'Introduction',
  projects: 'Projects',
  about: 'About Vince',
  contact: 'Contact',
};

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', middot: '·', hellip: '…' };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Visible text of an HTML fragment, the way a reader would take it in.
 * Decorative parts (aria-hidden, svg, script) are dropped; links keep their
 * destination in brackets so AIxia can say where "View repository" goes;
 * images contribute their alt text.
 */
export function htmlToText(html) {
  const text = html
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(\w+)\b[^>]*\baria-hidden="true"[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, inner) => {
      const href = /\bhref="([^"]+)"/i.exec(attrs)?.[1] ?? '';
      const label = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        || /\baria-label="([^"]+)"/i.exec(attrs)?.[1] || '';
      return /^(https?:|mailto:)/i.test(href) ? ` ${label} (${href}) ` : ` ${label} `;
    })
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, ' $1 ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|figure|figcaption|blockquote|ul|ol|header|article|label)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function sections(html) {
  const out = [];
  const pattern = /<section\b([^>]*)>([\s\S]*?)<\/section>/gi;
  for (const [, attrs, body] of html.matchAll(pattern)) {
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    if (!id || /\bhidden\b/.test(attrs)) continue;
    out.push({ id, body });
  }
  return out;
}

/** Entries for index.html: one per section, and one per project card. */
export function homeEntries(html) {
  const entries = [];
  for (const { id, body } of sections(html)) {
    const section = slugify(id);
    let rest = body;
    if (section === 'projects') {
      const cards = [...body.matchAll(/<article\b[^>]*class="[^"]*\bproject-card\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi)];
      for (const [card, inner] of cards) {
        const name = htmlToText(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(inner)?.[1] ?? '');
        if (!name) continue;
        const item = slugify(name);
        entries.push({
          id: `site:projects:${item}`, type: 'site', page: 'home', section, item,
          url: 'index.html#projects', title: name,
          text: `Project card in the Projects section.\n${htmlToText(inner)}`,
        });
        rest = rest.replace(card, ' ');
      }
    }
    const text = htmlToText(rest);
    if (!text) continue;
    entries.push({
      id: `site:${section}`, type: 'site', page: 'home', section,
      url: `index.html#${id}`, title: SECTION_TITLES[section] || id, text,
    });
  }
  return entries;
}

/** Entries for the blog: the page itself, then one per post. */
export function blogEntries(html, posts) {
  const entries = [];
  // The hero only: the feed section is a placeholder that blog.js fills in.
  const intro = sections(html).filter(({ id }) => id === 'blog-hero').map(({ body }) => htmlToText(body)).join('\n');
  if (intro) {
    entries.push({
      id: 'site:blog', type: 'site', page: 'blog', section: 'blog',
      url: 'blog.html', title: 'Blog', text: `${intro}\nPosts can be filtered by tag with the buttons above the list.`,
    });
  }
  for (const post of posts) {
    const item = slugify(post.id);
    const body = (post.content ?? []).map((block) => {
      if (block.type === 'text') return block.body;
      if (block.type === 'image') return block.alt ? `[Image: ${block.alt}]` : '';
      if (block.type === 'video') return block.title ? `[Video: ${block.title}]` : '';
      return '';
    }).filter(Boolean).join('\n\n');
    if (!body.trim()) continue;
    const tags = post.tags?.length ? `\nTags: ${post.tags.join(', ')}` : '';
    entries.push({
      id: `blog:${item}`, type: 'blog', page: 'blog', section: 'blog', item,
      url: `blog.html#post-${post.id}`, title: post.title,
      text: `Blog post published ${post.date}.${tags}\n\n${body}`,
    });
  }
  return entries;
}

const ACTION_RE = /^(scroll|highlight|open):([a-z0-9-]+)$/;

/** Entries for knowledge/help.md. See the comment at the top of that file. */
export function helpEntries(markdown) {
  const entries = [];
  const topics = markdown.split(/^## /m).slice(1);
  for (const topic of topics) {
    const [heading, ...lines] = topic.split('\n');
    const title = heading.trim();
    const body = lines.join('\n');
    const meta = /<!--([\s\S]*?)-->/.exec(body);
    const fields = Object.fromEntries((meta?.[1] ?? '').split(';').map((part) => {
      const [key, ...value] = part.split(':');
      return [key.trim(), value.join(':').trim()];
    }).filter(([key]) => key));
    const text = body.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!title || !text) continue;

    const page = fields.page || 'any';
    const actions = (fields.actions ? fields.actions.split(',') : []).map((raw) => {
      const match = ACTION_RE.exec(raw.trim());
      if (!match) throw new Error(`help.md, "${title}": unknown action "${raw.trim()}"`);
      return { type: match[1], target: match[2] };
    });
    const sectionsList = (fields.section || 'any').split(',').map((s) => slugify(s)).filter(Boolean);
    const slug = slugify(title);
    for (const section of sectionsList) {
      const file = page === 'blog' ? 'blog.html' : 'index.html';
      const anchor = section !== 'any' && page !== 'blog' ? `#${section}` : '';
      entries.push({
        id: sectionsList.length > 1 ? `help:${slug}:${section}` : `help:${slug}`,
        type: 'help', page, section, url: `${file}${anchor}`, title, text,
        ...(actions.length ? { actions } : {}),
      });
    }
  }
  return entries;
}

export async function buildKnowledge() {
  const read = (path) => readFile(new URL(path, root), 'utf8');
  const [index, blog, posts, help] = await Promise.all([
    read('index.html'), read('blog.html'), read('blog-data.json'), read('knowledge/help.md'),
  ]);
  return [...homeEntries(index), ...blogEntries(blog, JSON.parse(posts)), ...helpEntries(help)];
}

async function sync(entries) {
  const api = process.env.AIXIA_API_URL?.replace(/\/+$/, '');
  const token = process.env.AIXIA_SYNC_TOKEN;
  if (!api || !token) throw new Error('Set AIXIA_API_URL and AIXIA_SYNC_TOKEN to sync.');
  const response = await fetch(`${api}/api/knowledge/sync/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ entries }),
    // A sleeping free-tier backend takes up to a minute to wake, then embeds.
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Sync failed (HTTP ${response.status}): ${body.error ?? 'no details'}`);
  return body;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entries = await buildKnowledge();
  if (process.argv.includes('--sync')) {
    const result = await sync(entries);
    console.log(`Synced ${entries.length} entries:`, result);
  } else {
    console.log(JSON.stringify({ entries }, null, 2));
  }
}

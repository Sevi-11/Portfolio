import test from 'node:test';
import assert from 'node:assert/strict';
import { blogEntries, buildKnowledge, helpEntries, homeEntries, htmlToText } from '../scripts/build-knowledge.mjs';

test('html text keeps what a reader sees and where links go', () => {
  const text = htmlToText(`
    <div class="visual" aria-hidden="true"><span>RAG</span></div>
    <h3>AIxia</h3><p>Answers &amp; cites.</p>
    <a href="https://github.com/x"><svg><path/></svg>View repository <span aria-hidden="true">↗</span></a>
    <a href="mailto:a@b.c" aria-label="Email"><svg></svg></a>
    <img src="u.webp" alt="University of the East">`);
  assert.equal(text, 'AIxia\nAnswers & cites.\nView repository (https://github.com/x)\nEmail (mailto:a@b.c)\nUniversity of the East');
});

test('home page: one entry per section and per project card', () => {
  const html = `<main>
    <section class="hero" id="home"><h1>Hi</h1></section>
    <section id="projects"><h2>Selected work</h2>
      <article class="project-card project-featured"><h3>AIxia</h3><p>RAG.</p></article>
      <article class="project-card"><h3>Classification Lab</h3><p>Trees.</p></article>
    </section>
    <section id="compose" hidden><p>Owner only</p></section>
  </main>`;
  const entries = homeEntries(html);
  assert.deepEqual(entries.map((e) => e.id), ['site:home', 'site:projects:aixia', 'site:projects:classification-lab', 'site:projects']);
  const card = entries[2];
  assert.equal(card.item, 'classification-lab');
  assert.equal(card.url, 'index.html#projects');
  assert.match(card.text, /Trees\./);
  assert.doesNotMatch(entries[3].text, /Trees\./, 'cards are not repeated in the section entry');
});

test('blog: the intro plus one entry per post, text blocks only', () => {
  const html = '<section id="blog-hero"><h1>Notes</h1></section><section id="blog"><p>Loading posts...</p></section>';
  const entries = blogEntries(html, [
    { id: 'post-abc', title: 'First', date: '2026-01-02', tags: ['career'], content: [
      { type: 'text', body: 'Hello.' }, { type: 'image', src: 'data:image/png;base64,AA', alt: 'Desk' },
    ] },
    { id: 'post-empty', title: 'Empty', date: '2026-01-03', content: [] },
  ]);
  assert.deepEqual(entries.map((e) => e.id), ['site:blog', 'blog:post-abc']);
  assert.doesNotMatch(entries[0].text, /Loading/);
  assert.equal(entries[1].url, 'blog.html#post-post-abc');
  assert.match(entries[1].text, /Tags: career/);
  assert.match(entries[1].text, /\[Image: Desk\]/);
  assert.doesNotMatch(entries[1].text, /base64/);
});

test('help topics carry their page, section and actions', () => {
  const entries = helpEntries(`# Title, ignored
<!-- file comment, ignored -->

## Download the résumé
<!-- page: home; section: about; actions: scroll:about, highlight:resume -->
1. Scroll to About.

## Find profiles
<!-- page: home; section: home, contact -->
Icons under the intro.
`);
  assert.deepEqual(entries.map((e) => e.id), ['help:download-the-resume', 'help:find-profiles:home', 'help:find-profiles:contact']);
  assert.deepEqual(entries[0].actions, [{ type: 'scroll', target: 'about' }, { type: 'highlight', target: 'resume' }]);
  assert.equal(entries[0].url, 'index.html#about');
  assert.equal(entries[0].text, '1. Scroll to About.');
  assert.equal(entries[1].actions, undefined);
});

test('a typo in a help action fails the build instead of shipping', () => {
  assert.throws(() => helpEntries('## X\n<!-- page: home; section: about; actions: explode:all -->\nText'), /unknown action/);
});

test('the real site builds into valid, unique entries', async () => {
  const entries = await buildKnowledge();
  const ids = entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of entries) {
    assert.match(entry.id, /^[a-z0-9][a-z0-9:_-]{0,119}$/);
    assert.match(entry.url, /^(index|blog)\.html(#[A-Za-z0-9_-]{1,100})?$/);
    assert.ok(entry.text.trim(), entry.id);
  }
  assert.equal(entries.filter((e) => e.id.startsWith('site:projects:')).length, 7);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contextLabel,
  createLineParser,
  parseInline,
  parseMarkdown,
  runnableActions,
  slugify,
  sourceLabel,
} from '../assistant.js';

test('slugs match between the widget and the knowledge build', () => {
  assert.equal(slugify('AIxia'), 'aixia');
  assert.equal(slugify('Classification Lab'), 'classification-lab');
  assert.equal(slugify("Download Vince's résumé"), 'download-vince-s-resume');
  assert.equal(slugify('  --Weird__Name!! '), 'weird-name');
});

test('the stream parser handles events split across chunks', () => {
  const events = [];
  const parser = createLineParser((event) => events.push(event));
  parser.push('{"type":"sources","sources":[]}\n{"type":"tok');
  parser.push('en","content":"Hi"}\n');
  parser.push('{"type":"done","session_id":1}');
  parser.end();
  assert.deepEqual(events.map((e) => e.type), ['sources', 'token', 'done']);
  assert.equal(events[1].content, 'Hi');
});

test('inline markdown: emphasis, code, citations and safe links only', () => {
  assert.deepEqual(parseInline('See **this** [2].'), [
    { t: 'text', v: 'See ' },
    { t: 'strong', children: [{ t: 'text', v: 'this' }] },
    { t: 'text', v: ' ' },
    { t: 'cite', n: 2 },
    { t: 'text', v: '.' },
  ]);
  assert.deepEqual(parseInline('[repo](https://github.com/x)'), [{ t: 'link', href: 'https://github.com/x', text: 'repo' }]);
  assert.deepEqual(parseInline('[bad](javascript:alert(1))').map((t) => t.t), ['text']);
  assert.deepEqual(parseInline('`a *b*`'), [{ t: 'code', v: 'a *b*' }]);
});

test('block markdown: paragraphs, numbered steps and bullets', () => {
  const blocks = parseMarkdown('Here is how:\n1. Scroll to About [1].\n2. Select **Resume**.\n\n- one\n- two');
  assert.deepEqual(blocks.map((b) => b.type), ['p', 'ol', 'ul']);
  assert.equal(blocks[1].items.length, 2);
  assert.equal(blocks[1].start, 1);
  assert.equal(parseMarkdown('### Heading')[0].inline[0].t, 'strong');
});

test('a half-streamed answer still parses', () => {
  assert.doesNotThrow(() => parseMarkdown('1. Scroll to **Ab'));
  assert.doesNotThrow(() => parseMarkdown('See [1'));
});

test('source labels name the CV page or the site section', () => {
  assert.equal(sourceLabel({ source_type: 'cv', page: 0 }), "Vince's CV, page 1");
  assert.equal(sourceLabel({ document_id: 3, page: null }), "Vince's CV");
  assert.equal(sourceLabel({ source_type: 'site', title: 'Projects' }), 'Projects');
});

test('only allowlisted actions that exist on this page survive', () => {
  const exists = (kind, key) => (kind === 'section' ? key === 'about' : key === 'resume');
  const kept = runnableActions([
    { type: 'scroll', target: 'about' },
    { type: 'scroll', target: 'nowhere' },
    { type: 'highlight', target: 'resume' },
    { type: 'highlight', target: 'constructor' },
    { type: 'open', target: 'blog' },
    { type: 'open', target: 'https://evil.example' },
    { type: 'eval', target: 'x' },
  ], exists);
  assert.deepEqual(kept, [
    { type: 'scroll', target: 'about' },
    { type: 'highlight', target: 'resume' },
    { type: 'open', target: 'blog' },
  ]);
});

test('the context pill names the section and the item in view', () => {
  assert.equal(contextLabel({ section: 'projects', itemLabel: 'SentryScan' }), 'Projects · SentryScan');
  assert.equal(contextLabel({ section: 'about', itemLabel: null }), 'About');
});

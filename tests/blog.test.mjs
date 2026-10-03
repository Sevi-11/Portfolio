import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPostId,
  findUnsafeBlock,
  isVideoFile,
  mediaPathsOf,
  parseDataUrl,
  safeMediaSrc,
} from '../blog.js';

test('media sources reject script URLs, including ones split by control characters', () => {
  for (const src of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>', '//evil.example/x']) {
    assert.equal(safeMediaSrc(src, 'image'), '', src);
    assert.equal(safeMediaSrc(src, 'embed'), '', src);
  }
});

test('media sources keep https URLs, matching data URLs, and site paths', () => {
  assert.equal(safeMediaSrc('https://youtube.com/embed/x', 'embed'), 'https://youtube.com/embed/x');
  assert.equal(safeMediaSrc('http://youtube.com/embed/x', 'embed'), '');
  assert.equal(safeMediaSrc('data:image/png;base64,AA', 'image'), 'data:image/png;base64,AA');
  assert.equal(safeMediaSrc('data:image/png;base64,AA', 'video'), '');
  assert.equal(safeMediaSrc('assets/blog/post-a-b-1.mp4', 'video'), 'assets/blog/post-a-b-1.mp4');
  assert.equal(isVideoFile('assets/blog/post-a-b-1.mp4'), true);
  assert.equal(isVideoFile('https://youtube.com/embed/x'), false);
});

test('unsafe blocks are found before publishing', () => {
  assert.equal(findUnsafeBlock([{ type: 'text', body: 'hi' }, { type: 'image', src: 'https://x.test/a.png' }]), null);
  assert.deepEqual(findUnsafeBlock([{ type: 'video', src: 'javascript:alert(1)' }]), { type: 'video', src: 'javascript:alert(1)' });
});

test('uploads parse into a safe file extension', () => {
  assert.deepEqual(parseDataUrl('data:image/jpeg;base64,AAA'), { kind: 'image', ext: 'jpg', base64: 'AAA' });
  assert.equal(parseDataUrl('data:video/quicktime;base64,AA').ext, 'mov');
  assert.equal(parseDataUrl('https://x.test/a.png'), null);
});

test('only generated media paths are eligible for deletion', () => {
  const id = createPostId();
  const own = `assets/blog/${id}-1.png`;
  assert.deepEqual(mediaPathsOf({ content: [{ src: own }, { src: 'assets/blog/../../server.js' }, { src: 'assets/logo.png' }] }), [own]);
});

test('post ids do not repeat', () => {
  const ids = new Set(Array.from({ length: 500 }, createPostId));
  assert.equal(ids.size, 500);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getMenuState,
  getProjectMessage,
  getFormMessage,
  buildGmailComposeUrl,
  isInspectionShortcut,
  selectActiveSection,
} from '../script.js';

test('menu state exposes matching aria and hidden values', () => {
  assert.deepEqual(getMenuState(true), { expanded: 'true', hidden: false });
  assert.deepEqual(getMenuState(false), { expanded: 'false', hidden: true });
});

test('project feedback names the selected project without inventing a link', () => {
  assert.equal(getProjectMessage('AIxia'), 'AIxia case study is being prepared.');
});

test('form feedback is local and honest', () => {
  assert.equal(
    getFormMessage('Ada'),
    'Gmail opened for Ada. Review the draft and press Send to deliver your message.',
  );
  assert.equal(
    getFormMessage('   '),
    'Gmail opened. Review the draft and press Send to deliver your message.',
  );
  assert.equal(
    getFormMessage('Ada', false),
    'Gmail was blocked. Allow pop-ups, then submit the form again.',
  );
});

test('Gmail compose URL addresses the owner and includes every required field', () => {
  const url = new URL(buildGmailComposeUrl({
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    message: 'Let us build something useful.',
  }));

  assert.equal(url.origin + url.pathname, 'https://mail.google.com/mail/');
  assert.equal(url.searchParams.get('view'), 'cm');
  assert.equal(url.searchParams.get('fs'), '1');
  assert.equal(url.searchParams.get('to'), 'vinas.seanvincentvien@gmail.com');
  assert.match(url.searchParams.get('su'), /Portfolio inquiry from Ada Lovelace/);
  assert.match(url.searchParams.get('body'), /ada@example\.test/);
  assert.match(url.searchParams.get('body'), /Let us build something useful\./);
});

test('active section chooses the intersecting entry with greatest ratio', () => {
  const active = selectActiveSection([
    { id: 'home', isIntersecting: true, ratio: 0.25 },
    { id: 'projects', isIntersecting: true, ratio: 0.7 },
    { id: 'about', isIntersecting: false, ratio: 0.9 },
  ]);

  assert.equal(active, 'projects');
});

test('inspection shortcut detector covers the requested key combinations', () => {
  assert.equal(isInspectionShortcut({ key: 'F12' }), true);
  assert.equal(isInspectionShortcut({ key: 'I', ctrlKey: true, shiftKey: true }), true);
  assert.equal(isInspectionShortcut({ key: 'i', metaKey: true, altKey: true }), true);
  assert.equal(isInspectionShortcut({ key: 'I', ctrlKey: true }), false);
});

test('document provides the four-section accessible portfolio structure', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  for (const id of ['home', 'projects', 'about', 'contact']) {
    assert.match(html, new RegExp(`<section[^>]+id="${id}"`));
  }
  assert.match(html, /class="skip-link"/);
  assert.match(html, /data-menu-toggle[^>]+aria-expanded="false"/);
  assert.equal((html.match(/data-project-name=/g) ?? []).length, 6);
  assert.equal((html.match(/<button[^>]+data-project-name=/g) ?? []).length, 1);
  assert.equal((html.match(/<a[^>]+data-project-name=/g) ?? []).length, 5);
  assert.equal((html.match(/class="github-mark"/g) ?? []).length, 5);
  assert.match(html, /type="submit">Send with Gmail/);
  assert.match(html, /Gmail opens a prepared draft/);
  assert.match(html, /<label[^>]+for="name"/);
  assert.match(html, /<label[^>]+for="email"/);
  assert.match(html, /<label[^>]+for="message"/);
  assert.match(html, /data-form-status[^>]+role="status"/);
});

test('body contains only the approved external and email destinations', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const body = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? '';
  const destinations = [...body.matchAll(/href="(https?:\/\/[^\"]+|mailto:[^\"]+)"/gi)].map((match) => match[1]);
  const approvedProfiles = [
    'https://github.com/Sevi-11',
    'https://www.linkedin.com/in/sean-vincent-vien-vi%C3%B1as-34390a324/',
    'mailto:vinas.seanvincentvien@gmail.com',
  ];

  const approvedProjects = [
    'https://github.com/Sevi-11/SMOKi_Project',
    'https://github.com/Sevi-11/AeroBand_Project',
    'https://github.com/Sevi-11/ClassificationAlgorithms',
    'https://github.com/Sevi-11/SupervisedLearning-RandomForest',
    'https://github.com/Sevi-11/UnsupervisedLearning-Apriori',
  ];

  assert.equal(destinations.length, 11);
  assert.deepEqual([...new Set(destinations)].sort(), [...approvedProfiles, ...approvedProjects].sort());
  assert.equal((body.match(/class="social-links"/g) ?? []).length, 2);
  assert.equal((body.match(/class="social-link"/g) ?? []).length, 6);
  assert.equal((body.match(/aria-label="(GitHub|LinkedIn|Email)"/g) ?? []).length, 6);
  assert.equal((body.match(/target="_blank" rel="noopener noreferrer"/g) ?? []).length, 9);
});

test('project repository destinations are assigned respectfully and AIxia remains unlinked', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const expected = new Map([
    ['SMOKi', 'https://github.com/Sevi-11/SMOKi_Project'],
    ['AeroBand', 'https://github.com/Sevi-11/AeroBand_Project'],
    ['Classification Lab', 'https://github.com/Sevi-11/ClassificationAlgorithms'],
    ['Anomaly Detection', 'https://github.com/Sevi-11/SupervisedLearning-RandomForest'],
    ['Grocery Patterns', 'https://github.com/Sevi-11/UnsupervisedLearning-Apriori'],
  ]);

  for (const [name, href] of expected) {
    assert.match(html, new RegExp(`<a[^>]+href="${href}"[^>]+data-project-name="${name}"`));
  }
  assert.match(html, /<button[^>]+data-project-name="AIxia"/);
  assert.doesNotMatch(html, /<a[^>]+data-project-name="AIxia"/);
});

test('SMOKi and AeroBand retain their distinct project descriptions', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const projectCards = html.match(/<article class="project-card"[\s\S]*?<\/article>/g) ?? [];
  const smoki = projectCards.find((card) => card.includes('data-project-name="SMOKi"')) ?? '';
  const aerBand = projectCards.find((card) => card.includes('data-project-name="AeroBand"')) ?? '';

  assert.match(smoki, /vehicle smoke emission classification/i);
  assert.match(smoki, /convolutional neural network/i);
  assert.doesNotMatch(smoki, /wearable device/i);
  assert.match(aerBand, /IoT-powered wearable device/i);
  assert.match(aerBand, /real-time air quality monitoring/i);
  assert.doesNotMatch(aerBand, /vehicle smoke emission/i);
});

test('stylesheet includes responsive and accessible design contracts', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  for (const token of [
    '#F4F1EA', '#0A1128', '#4A5568', '#D9D9D9',
    'Bodoni Moda', 'Comfortaa', 'Inter',
  ]) {
    assert.match(css, new RegExp(token.replace('#', '\\#'), 'i'));
  }
  for (const contract of [
    'clamp(', 'minmax(', '@media (max-width:',
    '@media (prefers-reduced-motion: reduce)', ':focus-visible',
    'scroll-margin-top', 'overflow-wrap',
    'scrollbar-width: none', '::-webkit-scrollbar',
    '.social-link:hover', '.social-link:active',
    'user-select: none', '-webkit-user-drag: none',
    '.nav-links.is-opening', '@keyframes menu-enter',
    '.project-action svg',
  ]) {
    assert.ok(css.includes(contract), `missing CSS contract: ${contract}`);
  }
});

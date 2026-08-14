import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = 'http://127.0.0.1:4174';
const output = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
});
const results = [];
const browserErrors = [];

for (const [width, height, name] of [
  [320, 568, 'phone-320-short'],
  [375, 812, 'phone-375'],
  [414, 896, 'phone-414'],
  [768, 1024, 'tablet'],
  [1024, 768, 'laptop'],
  [1366, 768, 'laptop-1366'],
  [1440, 900, 'desktop'],
  [1920, 1080, 'wide'],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      browserErrors.push(`console:${message.text()}`);
    }
  });
  page.on('pageerror', (error) => browserErrors.push(`page:${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().startsWith(baseUrl)) {
      browserErrors.push(`response:${response.status()}:${response.url()}`);
    }
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(750);

  const metrics = await page.evaluate(() => {
    const box = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const fontSize = (selector) => Number.parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      hero: box('.hero'),
      heroFont: fontSize('.hero h1'),
      sectionHeadingFont: fontSize('.section-heading h2'),
      featuredCard: box('.project-featured'),
      regularCard: box('.project-card:not(.project-featured)'),
      portrait: box('.portrait-card'),
      aboutCards: {
        portrait: box('.portrait-card'),
        story: box('.story-card'),
        education: box('.education-card'),
        quote: box('.quote-card'),
        toolkit: box('.toolkit-card'),
      },
    };
  });
  const sections = await page.locator('main > section:visible').count();
  results.push({ viewport: name, sections, ...metrics });

  if (name === 'phone-375') {
    assert.ok(metrics.hero.height <= 720, `mobile hero is ${metrics.hero.height}px tall`);
    assert.ok(metrics.heroFont <= 54, `mobile hero type is ${metrics.heroFont}px`);
  }
  if (name === 'tablet') {
    assert.ok(metrics.portrait.height <= 620, `tablet portrait is ${metrics.portrait.height}px tall`);
    assert.ok(metrics.regularCard.height <= 560, `tablet project card is ${metrics.regularCard.height}px tall`);
    assert.ok(Math.abs(metrics.aboutCards.portrait.height - metrics.aboutCards.story.height) <= 2, 'tablet portrait and story row must align');
    assert.ok(Math.abs(metrics.aboutCards.education.height - metrics.aboutCards.quote.height) <= 2, 'tablet education and quote row must align');
  }
  if (name === 'laptop') {
    assert.ok(metrics.aboutCards.portrait.height <= 620, `1024px bento lead card is ${metrics.aboutCards.portrait.height}px tall`);
  }
  if (name === 'laptop-1366') {
    assert.ok(metrics.hero.height <= 700, `laptop hero is ${metrics.hero.height}px tall`);
    assert.ok(metrics.heroFont <= 88, `laptop hero type is ${metrics.heroFont}px`);
    assert.ok(metrics.sectionHeadingFont <= 60, `section heading is ${metrics.sectionHeadingFont}px`);
    assert.ok(metrics.featuredCard.height <= 420, `featured card is ${metrics.featuredCard.height}px tall`);
    assert.ok(metrics.regularCard.height <= 470, `project card is ${metrics.regularCard.height}px tall`);
    const about = metrics.aboutCards;
    assert.ok(about.portrait.height <= 700, `desktop bento is ${about.portrait.height}px tall`);
    assert.ok(Math.abs(about.portrait.height - (about.story.height + about.quote.height + 22)) <= 3, 'desktop portrait must span both bento rows');
    assert.equal(about.story.height, about.education.height, 'desktop first bento row must align');
    assert.equal(about.quote.height, about.toolkit.height, 'desktop second bento row must align');
  }
  if (name === 'wide') {
    assert.ok(metrics.aboutCards.portrait.height <= 760, `ultrawide bento is ${metrics.aboutCards.portrait.height}px tall`);
  }

  if (name === 'phone-375') {
    const toggle = page.locator('[data-menu-toggle]');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('[data-menu]').isVisible(), true);
    assert.equal(await page.locator('[data-menu]').evaluate((menu) => menu.classList.contains('is-opening')), true);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('[data-menu]').isVisible(), true);
    assert.equal(await page.locator('[data-menu]').evaluate((menu) => menu.classList.contains('is-closing')), true);
    await page.locator('[data-menu]').waitFor({ state: 'hidden' });
  }

  if (name === 'desktop') {
    await page.locator('[data-nav-link][href="#projects"]').click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('[data-nav-link][href="#projects"]').getAttribute('aria-current'), 'page');
    await page.locator("[data-project-name='AIxia']").click();
    assert.match(await page.locator('[data-project-status]').innerText(), /AIxia case study is being prepared/);
    await page.locator('#name').fill('Ada');
    await page.locator('#email').fill('ada@example.test');
    await page.locator('#message').fill('A local browser verification message.');
    await page.evaluate(() => {
      window.__openedGmailUrl = '';
      window.open = (url) => { window.__openedGmailUrl = String(url); return {}; };
    });
    await page.locator("[data-contact-form] button[type='submit']").click();
    assert.match(await page.evaluate(() => window.__openedGmailUrl), /^https:\/\/mail\.google\.com\/mail\//);
    assert.match(await page.locator('[data-form-status]').innerText(), /Review the draft and press Send/);
  }

  if (['phone-375', 'tablet', 'laptop-1366', 'desktop'].includes(name)) {
    for (const sectionId of ['projects', 'about', 'contact']) {
      await page.locator(`#${sectionId}`).scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }
    await page.locator('#home').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.locator('[data-reveal]').evaluateAll((items) => {
      items.forEach((item) => item.classList.add('is-visible'));
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  }
  await page.close();
}

const reduced = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
await reduced.goto(baseUrl, { waitUntil: 'networkidle' });
await reduced.waitForTimeout(100);
assert.equal(await reduced.locator('[data-reveal]').first().isVisible(), true);
assert.equal(await reduced.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
await reduced.close();
await browser.close();

assert.deepEqual(browserErrors, []);
assert.equal(results.every((item) => item.sections === 4), true);
assert.equal(
  results.some((item) => item.overflow),
  false,
  `horizontal overflow: ${results.filter((item) => item.overflow).map((item) => item.viewport).join(', ')}`,
);
console.log(JSON.stringify({ viewports: results, browserErrors }, null, 2));

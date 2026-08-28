import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const dataFile = join(root, 'blog-data.json');
const port = process.env.PORT ? Number(process.env.PORT) : 5173;
const maxBodyBytes = 30 * 1024 * 1024;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
        reject(new Error('Upload too large (30MB limit).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isValidBlock(block) {
  if (!block || typeof block !== 'object') return false;
  if (block.type === 'text') return typeof block.body === 'string' && block.body.trim().length > 0;
  if (block.type === 'image' || block.type === 'video') return typeof block.src === 'string' && block.src.trim().length > 0;
  return false;
}

function sanitizePost(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid post payload.');
  const title = String(input.title ?? '').trim();
  const date = String(input.date ?? '').trim();
  if (!title) throw new Error('Title is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A valid date is required.');

  const tags = Array.isArray(input.tags)
    ? input.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    : [];

  const content = Array.isArray(input.content)
    ? input.content.filter(isValidBlock).map((block) => {
        if (block.type === 'text') return { type: 'text', body: String(block.body) };
        if (block.type === 'image') return { type: 'image', src: String(block.src), alt: String(block.alt ?? '') };
        return { type: 'video', src: String(block.src), title: String(block.title ?? '') };
      })
    : [];
  if (!content.length) throw new Error('At least one content block is required.');

  return {
    id: 'post-' + Date.now().toString(36),
    title,
    date,
    createdAt: new Date().toISOString(),
    tags,
    content,
  };
}

async function handlePublish(req, res) {
  try {
    const raw = await readBody(req);
    const payload = JSON.parse(raw || '{}');
    const post = sanitizePost(payload);

    const existingRaw = await readFile(dataFile, 'utf8').catch(() => '[]');
    const posts = JSON.parse(existingRaw || '[]');
    posts.unshift(post);
    await writeFile(dataFile, JSON.stringify(posts, null, 2) + '\n', 'utf8');

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(post));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Failed to publish post.' }));
  }
}

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(root, safePath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

const server = createServer((req, res) => {
  if (req.url === '/api/posts') {
    if (req.method === 'POST') return handlePublish(req, res);
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed.' }));
    return;
  }
  serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`Portfolio server running at http://localhost:${port}`);
});

import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostId, findUnsafeBlock, mediaPathsOf, parseDataUrl } from './blog.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const dataFile = join(root, 'blog-data.json');
const archiveFile = join(root, 'blog-archive.json');
const mediaDir = 'assets/blog';
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
  '.pdf': 'application/pdf',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
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
  if (findUnsafeBlock(content)) throw new Error('Media links must be https:// URLs or uploaded files.');

  return {
    id: createPostId(),
    title,
    date,
    createdAt: new Date().toISOString(),
    tags,
    content,
  };
}

// Same layout the GitHub publish path uses: uploads become files under
// assets/blog/ rather than base64 strings inside blog-data.json.
async function storeMedia(post) {
  const content = [];
  for (const [index, block] of post.content.entries()) {
    const media = parseDataUrl(block.src);
    if (!media) {
      content.push(block);
      continue;
    }
    const path = `${mediaDir}/${post.id}-${index + 1}.${media.ext}`;
    await mkdir(join(root, mediaDir), { recursive: true });
    await writeFile(join(root, path), Buffer.from(media.base64, 'base64'));
    content.push({ ...block, src: path });
  }
  return { ...post, content };
}

async function handlePublish(req, res) {
  try {
    const raw = await readBody(req);
    const payload = JSON.parse(raw || '{}');
    const post = await storeMedia(sanitizePost(payload));

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

async function handleDelete(req, res, postId, archive) {
  try {
    const existingRaw = await readFile(dataFile, 'utf8').catch(() => '[]');
    const posts = JSON.parse(existingRaw || '[]');
    const index = posts.findIndex((p) => p.id === postId);
    if (index === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Post not found.' }));
      return;
    }

    const [removed] = posts.splice(index, 1);
    await writeFile(dataFile, JSON.stringify(posts, null, 2) + '\n', 'utf8');

    if (archive) {
      const archiveRaw = await readFile(archiveFile, 'utf8').catch(() => '[]');
      const archivePosts = JSON.parse(archiveRaw || '[]');
      archivePosts.unshift({ ...removed, archivedAt: new Date().toISOString() });
      await writeFile(archiveFile, JSON.stringify(archivePosts, null, 2) + '\n', 'utf8');
    } else {
      await Promise.all(mediaPathsOf(removed).map((path) => rm(join(root, path), { force: true })));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(removed));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Failed to delete post.' }));
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
  const urlPath = req.url.split('?')[0];

  if (urlPath === '/api/posts') {
    if (req.method === 'POST') return handlePublish(req, res);
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed.' }));
    return;
  }

  const deleteMatch = urlPath.match(/^\/api\/posts\/([^/]+)$/);
  if (deleteMatch) {
    if (req.method === 'DELETE') {
      const mode = new URL(req.url, `http://${req.headers.host}`).searchParams.get('mode');
      return handleDelete(req, res, decodeURIComponent(deleteMatch[1]), mode !== 'forever');
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed.' }));
    return;
  }

  serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`Portfolio server running at http://localhost:${port}`);
});

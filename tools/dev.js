#!/usr/bin/env node
'use strict';
/*
 * Local preview: builds the site, serves docs/ at http://localhost:4000
 * and rebuilds whenever a post, template or config file changes.
 * Refresh the browser tab to see the change.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { build } = require('./build');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
const PORT = Number(process.env.PORT) || 4000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

function safeBuild() {
  try { build(); } catch (e) { console.error('Build failed: ' + e.message); }
}
safeBuild();

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(OUT, path.normalize(p));
  if (!file.startsWith(OUT)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.existsSync(path.join(OUT, '404.html')) ? fs.readFileSync(path.join(OUT, '404.html')) : 'Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Preview: http://localhost:${PORT}  (Ctrl+C to stop)`));

let timer;
for (const target of ['posts', 'src', 'site.config.json']) {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) continue;
  try {
    fs.watch(full, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(safeBuild, 200);
    });
  } catch (e) { console.warn('Cannot watch ' + target + ': ' + e.message); }
}

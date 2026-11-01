#!/usr/bin/env node
'use strict';
/*
 * Static site builder.
 *   posts/*.md  +  src/  +  site.config.json   ->   docs/
 * Run with:  node tools/build.js   (or: npm run build)
 */

const fs = require('fs');
const path = require('path');
const { render, slugify, esc } = require('./markdown');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const POSTS = path.join(ROOT, 'posts');
const OUT = path.join(ROOT, 'docs');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8').replace(/^﻿/, ''));

const siteUrl = (config.siteUrl || '').replace(/\/+$/, '');
const abs = (p) => (siteUrl ? `${siteUrl}/${p}` : p);

const FONT_LINKS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap">',
].join('\n');

// Applies the saved light/dark choice before first paint to avoid a flash.
const THEME_INIT = `<script>try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>`;

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23030712'/%3E%3Crect x='3' y='3' width='26' height='26' fill='none' stroke='%236366f1' stroke-width='2'/%3E%3Ctext x='16' y='22' font-family='monospace' font-size='14' font-weight='700' fill='%236366f1' text-anchor='middle'%3ENX%3C/text%3E%3C/svg%3E";

const HLJS_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css';
const HLJS_JS = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';

/* ---------- file helpers ---------- */
function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

/* ---------- posts ---------- */
function unquote(v) {
  return v.replace(/^(['"])(.*)\1$/, '$2');
}

function parseFrontMatter(raw) {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) {
      v = v.slice(1, -1).split(',').map((x) => unquote(x.trim())).filter(Boolean);
    } else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else v = unquote(v);
    data[kv[1].toLowerCase()] = v;
  }
  return { data, body: m[2] };
}

function parseDate(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtDate = (d) => dateFmt.format(d);
const isoDate = (d) => d.toISOString().slice(0, 10);

function loadPosts() {
  if (!fs.existsSync(POSTS)) return [];
  const files = fs.readdirSync(POSTS).filter((f) => f.toLowerCase().endsWith('.md'));
  const seen = new Set();
  const posts = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(POSTS, file), 'utf8');
    const { data, body } = parseFrontMatter(raw);
    const base = file.replace(/\.md$/i, '');
    const fileDate = base.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);

    const rendered = render(body);
    const firstH1 = rendered.headings.find((h) => h.level === 1);
    const title = data.title || (firstH1 && firstH1.text) || base;
    if (!data.title) console.warn(`  ! ${file}: no "title" in front matter`);

    const date = parseDate(data.date) || parseDate(fileDate && fileDate[1]) || new Date(fs.statSync(path.join(POSTS, file)).mtime);
    if (!parseDate(data.date)) console.warn(`  ! ${file}: no valid "date" in front matter, using ${isoDate(date)}`);

    let slug = slugify(String(data.slug || (fileDate ? fileDate[2] : base))) || slugify(title) || 'post';
    for (let n = 2; seen.has(slug); n++) slug = `${slug}-${n}`;
    seen.add(slug);

    let tags = data.tags || [];
    if (typeof tags === 'string') tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
    tags = tags.map((label) => ({ label, slug: slugify(label) })).filter((t) => t.slug);

    const words = body.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length;
    let summary = data.summary || data.description || '';
    if (!summary) {
      const para = body.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^(#|>|```|[-*+]\s|\d+[.)]\s|\||<)/.test(p));
      summary = (para || '').replace(/[`*_~>#]|\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ');
      if (summary.length > 170) summary = summary.slice(0, 167).replace(/\s+\S*$/, '') + '...';
    }

    posts.push({
      file,
      slug,
      title,
      date,
      updated: parseDate(data.updated),
      summary,
      tags,
      draft: data.draft === true,
      toc: data.toc !== false,
      minutes: Math.max(1, Math.ceil(words / 200)),
      html: rendered.html,
      headings: rendered.headings,
      url: `blog/${slug}.html`,
    });
  }

  posts.sort((a, b) => b.date - a.date || a.title.localeCompare(b.title));
  return posts;
}

/* ---------- shared page parts ---------- */
function headHtml({ title, description, base, pagePath, type = 'website', extra = '' }) {
  const full = title === config.siteTitle ? title : `${title} · ${config.siteTitle}`;
  const canonical = siteUrl ? abs(pagePath) : '';
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${esc(full)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    '<meta name="theme-color" content="#030712">',
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    canonical ? `<meta property="og:url" content="${esc(canonical)}">\n<link rel="canonical" href="${esc(canonical)}">` : '',
    `<link rel="alternate" type="application/rss+xml" title="${esc(config.siteTitle)}" href="${base}feed.xml">`,
    `<link rel="icon" href="${FAVICON}">`,
    THEME_INIT,
    FONT_LINKS,
    extra,
    `<link rel="stylesheet" href="${base}assets/style.css">`,
  ].filter(Boolean).join('\n');
}

function headerHtml(base, active) {
  const link = (id, label, href) =>
    `<a href="${href}"${active === id ? ' class="active" aria-current="page"' : ''}>${label}</a>`;
  const initials = config.initials || config.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2);
  return `<header class="top">
  <div class="wrap bar">
    <a class="brand" href="${base}index.html"><span class="avatar" aria-hidden="true">${esc(initials)}</span><span>${esc(config.name)}</span></a>
    <nav aria-label="Main">
      ${link('blog', 'Blog', `${base}blog.html`)}
      ${link('about', 'About', `${base}about.html`)}
    </nav>
    <button class="theme" type="button" id="theme" aria-label="Toggle color theme">
      <svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
      <svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
    </button>
  </div>
</header>`;
}

function footerHtml(base) {
  return `<footer>
  <div class="wrap">
    <span>&copy; ${new Date().getFullYear()} ${esc(config.name)}</span>
    <span><a href="${base}about.html#contact">${esc(config.email)}</a> &middot; <a href="${base}feed.xml">RSS</a></span>
  </div>
</footer>`;
}

const tagLinks = (p, base) =>
  p.tags.map((t) => `<a class="chip" href="${base}blog.html#${t.slug}">${esc(t.label)}</a>`).join('');

function postRow(p, base) {
  const search = esc([p.title, p.summary, ...p.tags.map((t) => t.label)].join(' ').toLowerCase());
  return `<li class="postrow" data-tags="${p.tags.map((t) => t.slug).join(' ')}" data-search="${search}">
  <div class="meta"><time datetime="${isoDate(p.date)}">${fmtDate(p.date)}</time><span>${p.minutes} min read</span></div>
  <h3><a href="${base}${p.url}">${esc(p.title)}</a></h3>
  ${p.summary ? `<p>${esc(p.summary)}</p>` : ''}
  <div class="chips">${tagLinks(p, base)}</div>
</li>`;
}

/* ---------- pages ---------- */
function fillTemplate(file, vars) {
  let html = fs.readFileSync(path.join(SRC, file), 'utf8');
  for (const [k, v] of Object.entries(vars)) html = html.split(`{{${k}}}`).join(v);
  return html;
}

function homePage(posts) {
  const latest = posts.slice(0, config.homePostCount || 3);
  const section = posts.length
    ? `<section class="section">
    <div class="wrap">
      <h2>Latest posts</h2>
      <ul class="postlist">
${latest.map((p) => postRow(p, '')).join('\n')}
      </ul>
      <p class="more"><a href="blog.html">All posts &rarr;</a></p>
    </div>
  </section>`
    : '';
  return fillTemplate('home.html', {
    HEAD: headHtml({ title: config.siteTitle, description: config.description, base: '', pagePath: 'index.html' }),
    HEADER: headerHtml('', ''),
    LATEST: section,
    FOOTER: footerHtml(''),
    INITIALS: esc(config.initials || ''),
  });
}

function aboutPage() {
  return fillTemplate('about.html', {
    HEAD: headHtml({ title: 'About', description: config.description, base: '', pagePath: 'about.html' }),
    HEADER: headerHtml('', 'about'),
    FOOTER: footerHtml(''),
    INITIALS: esc(config.initials || ''),
    EMAIL: esc(config.email),
  });
}

function blogPage(posts) {
  const counts = new Map();
  for (const p of posts) for (const t of p.tags) {
    const c = counts.get(t.slug) || { label: t.label, n: 0 };
    c.n++;
    counts.set(t.slug, c);
  }
  const tagButtons = [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].label.localeCompare(b[1].label))
    .map(([slug, c]) => `<button type="button" class="chip" data-tag="${slug}" aria-pressed="false">${esc(c.label)} <span class="n">${c.n}</span></button>`)
    .join('\n      ');

  const body = posts.length
    ? `<div class="filters">
      <label class="sr" for="q">Search posts</label>
      <input id="q" type="search" placeholder="Search posts..." autocomplete="off">
      <button type="button" class="chip" data-tag="" aria-pressed="true">All <span class="n">${posts.length}</span></button>
      ${tagButtons}
    </div>
    <ul class="postlist" id="postlist">
${posts.map((p) => postRow(p, '')).join('\n')}
    </ul>
    <p class="empty" id="empty" hidden>No posts match. Try another tag or search term.</p>`
    : '<p class="empty">No posts yet. New writing will appear here.</p>';

  return `<!doctype html>
<html lang="en">
<head>
${headHtml({ title: 'Blog', description: config.blogIntro, base: '', pagePath: 'blog.html' })}
</head>
<body>
${headerHtml('', 'blog')}
<main>
  <section class="hero-dark">
    <div class="wrap">
      <p class="eyebrow">Blog</p>
      <h1>${esc(config.blogTitle)}</h1>
      <p class="lead">${esc(config.blogIntro)}</p>
    </div>
  </section>
  <section class="section">
    <div class="wrap">
      <h2>All posts</h2>
      ${body}
    </div>
  </section>
</main>
${footerHtml('')}
<script src="assets/site.js" defer></script>
</body>
</html>
`;
}

function postPage(p, newer, older, hasPosts) {
  const base = '../';
  const h2 = p.headings.filter((h) => h.level === 2);
  const toc = p.toc && h2.length >= 3
    ? `<nav class="toc" aria-label="On this page"><b>On this page</b><ol>${h2.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></nav>`
    : '';
  const pager = newer || older
    ? `<nav class="pager" aria-label="More posts">
      ${older ? `<a class="prev" href="${base}${older.url}"><small>&larr; Older</small>${esc(older.title)}</a>` : '<span></span>'}
      ${newer ? `<a class="next" href="${base}${newer.url}"><small>Newer &rarr;</small>${esc(newer.title)}</a>` : ''}
    </nav>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
${headHtml({
    title: p.title,
    description: p.summary || config.description,
    base,
    pagePath: p.url,
    type: 'article',
    extra: `<link rel="stylesheet" href="${HLJS_CSS}">`,
  })}
</head>
<body>
${headerHtml(base, 'blog')}
<main>
  <div class="wrap page">
    <p class="crumb"><a href="${base}blog.html">&larr; All posts</a></p>
    <article>
      <header class="post-head">
        <div class="chips">${tagLinks(p, base)}</div>
        <h1>${esc(p.title)}</h1>
        <div class="post-meta">
          <time datetime="${isoDate(p.date)}">${fmtDate(p.date)}</time>
          <span>${p.minutes} min read</span>
          ${p.updated ? `<span>Updated ${fmtDate(p.updated)}</span>` : ''}
          <span>by ${esc(config.name)}</span>
        </div>
        ${p.summary ? `<p class="post-sum">${esc(p.summary)}</p>` : ''}
        ${toc}
      </header>
      <div class="post-body">
${p.html}
      </div>
    </article>
    ${pager}
  </div>
</main>
${footerHtml(base)}
<script src="${HLJS_JS}" defer></script>
<script src="${base}assets/site.js" defer></script>
</body>
</html>
`;
}

function notFoundPage() {
  const root = siteUrl ? new URL(siteUrl).pathname.replace(/\/+$/, '') + '/' : '/';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · ${esc(config.siteTitle)}</title>
<link rel="stylesheet" href="${root}assets/style.css">
</head>
<body>
<main>
  <div class="wrap page">
    <h1 class="title">Page not found</h1>
    <p class="intro">That address doesn't exist. It may have moved or been removed.</p>
    <p><a href="${root}index.html">Back to the home page</a> &middot; <a href="${root}blog.html">Read the blog</a></p>
  </div>
</main>
</body>
</html>
`;
}

function feedXml(posts) {
  const items = posts.slice(0, 30).map((p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(abs(p.url))}</link>
      <guid isPermaLink="${siteUrl ? 'true' : 'false'}">${esc(abs(p.url))}</guid>
      <pubDate>${p.date.toUTCString()}</pubDate>
      <description>${esc(p.summary)}</description>
${p.tags.map((t) => `      <category>${esc(t.label)}</category>`).join('\n')}
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(config.siteTitle)}</title>
    <link>${esc(siteUrl ? siteUrl + '/' : 'index.html')}</link>
    <description>${esc(config.description)}</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
}

function sitemapXml(posts) {
  const urls = [
    { loc: abs('index.html') },
    { loc: abs('blog.html') },
    { loc: abs('about.html') },
    ...posts.map((p) => ({ loc: abs(p.url), lastmod: isoDate(p.updated || p.date) })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

/* ---------- build ---------- */
function build() {
  const t0 = Date.now();
  if (path.basename(OUT) !== 'docs') throw new Error('Refusing to clean an unexpected output folder: ' + OUT);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  copyDir(path.join(SRC, 'static'), OUT);
  copyDir(path.join(SRC, 'assets'), path.join(OUT, 'assets'));
  copyDir(path.join(POSTS, 'images'), path.join(OUT, 'blog', 'images'));

  const all = loadPosts();
  const posts = all.filter((p) => !p.draft);
  const drafts = all.length - posts.length;

  write('index.html', homePage(posts));
  write('about.html', aboutPage());
  write('blog.html', blogPage(posts));
  posts.forEach((p, i) => write(p.url, postPage(p, posts[i - 1], posts[i + 1], posts.length > 0)));
  write('feed.xml', feedXml(posts));
  write('404.html', notFoundPage());
  if (siteUrl) write('sitemap.xml', sitemapXml(posts));

  console.log(`Built ${posts.length} post${posts.length === 1 ? '' : 's'}${drafts ? ` (${drafts} draft${drafts === 1 ? '' : 's'} skipped)` : ''} in ${Date.now() - t0} ms -> docs/`);
  if (!siteUrl) console.log('Tip: set "siteUrl" in site.config.json before deploying so the RSS feed and sitemap use full links.');
}

if (require.main === module) build();
module.exports = { build };

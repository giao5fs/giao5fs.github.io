'use strict';
/*
 * Small, dependency-free Markdown renderer for the portfolio blog.
 * Supports: headings, paragraphs, bold/italic/strike, inline code, fenced code,
 * links, images, blockquotes (with [!NOTE]/[!TIP]/[!WARNING] callouts), nested
 * lists, task lists, tables, horizontal rules and raw HTML blocks.
 */

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function safeUrl(u) {
  const t = u.trim();
  return /^(javascript|data|vbscript):/i.test(t) ? '#' : t;
}

function plain(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .trim();
}

/* ---------- inline ---------- */
function inline(src) {
  const stash = [];
  const keep = (html) => {
    stash.push(html);
    return '\u0000' + (stash.length - 1) + '\u0000';
  };
  let s = src;

  s = s.replace(/`([^`\n]+)`/g, (m, c) => keep('<code>' + esc(c) + '</code>'));
  s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|~>])/g, (m, c) => keep(esc(c)));
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (m, u) =>
    keep(`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`)
  );
  s = s.replace(/<\/?(?:kbd|sup|sub|br|mark|abbr|small|span)(?:\s[^>]*)?>/gi, (m) => keep(m));

  s = esc(s);

  // images, then links (already escaped, so urls are safe to place in attributes)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;(.*?)&quot;)?\)/g, (m, alt, url, title) =>
    keep(
      `<img src="${safeUrl(url)}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy">`
    )
  );
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;(.*?)&quot;)?\)/g, (m, text, url, title) => {
    const u = safeUrl(url);
    const external = /^https?:\/\//i.test(u) ? ' target="_blank" rel="noopener"' : '';
    return keep(`<a href="${u}"${title ? ` title="${title}"` : ''}${external}>`) + text + keep('</a>');
  });

  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\s][^_\n]*?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
  s = s.replace(/ {2,}\n/g, '<br>\n');

  for (let n = 0; n < 4 && /\u0000\d+\u0000/.test(s); n++) {
    s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[Number(i)]);
  }
  return s;
}

/* ---------- blocks ---------- */
const BLANK = /^\s*$/;
const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)[^\n]*$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>/;
const HTML_RE = /^\s{0,3}<(?:div|figure|details|summary|iframe|video|audio|section|aside|table|ul|ol|pre|blockquote|h[1-6]|hr|!--)/i;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const isListItem = (l) => LIST_RE.test(l) && !HR_RE.test(l);

function startsBlock(line) {
  return FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line) || isListItem(line);
}

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function codeBlock(text, lang) {
  const label = lang || 'text';
  const cls = lang ? `language-${esc(lang)}` : 'language-plaintext';
  return (
    `<div class="code"><div class="code-bar"><span>${esc(label)}</span>` +
    `<button type="button" class="copy" data-copy>Copy</button></div>` +
    `<pre><code class="${cls}">${esc(text)}</code></pre></div>`
  );
}

function parseList(lines, start, ctx) {
  const first = lines[start].match(LIST_RE);
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let loose = false;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];

    if (BLANK.test(line)) {
      let j = i + 1;
      while (j < lines.length && BLANK.test(lines[j])) j++;
      if (j >= lines.length) break;
      const nxt = lines[j];
      const nIndent = nxt.match(/^\s*/)[0].length;
      const nm = nxt.match(LIST_RE);
      if (nm && !HR_RE.test(nxt) && nIndent <= base + 1 && /\d/.test(nm[2]) === ordered) {
        loose = true;
        items[items.length - 1].lines.push('');
        i = j;
        continue;
      }
      if (nIndent > base + 1) {
        items[items.length - 1].lines.push('');
        i++;
        continue;
      }
      break;
    }

    const m = line.match(LIST_RE);
    const indent = line.match(/^\s*/)[0].length;
    if (m && !HR_RE.test(line) && indent <= base + 1) {
      if (/\d/.test(m[2]) !== ordered) break;
      items.push({ offset: m[1].length + m[2].length + 1, lines: [m[3]] });
      i++;
      continue;
    }

    const cur = items[items.length - 1];
    if (indent > base) {
      cur.lines.push(line.slice(Math.min(indent, cur.offset)));
      i++;
      continue;
    }
    if (startsBlock(line)) break;
    cur.lines.push(line.trim());
    i++;
  }

  const tight = !loose;
  const lis = items.map((it) => {
    while (it.lines.length && it.lines[it.lines.length - 1] === '') it.lines.pop();
    let task = '';
    const tm = it.lines[0].match(/^\[([ xX])\]\s+/);
    if (tm) {
      task = `<input type="checkbox" disabled${tm[1] !== ' ' ? ' checked' : ''}> `;
      it.lines[0] = it.lines[0].slice(tm[0].length);
    }
    return '<li>' + task + blocks(it.lines, ctx, tight) + '</li>';
  });

  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  return { html: `<${tag}${startAttr}>\n${lis.join('\n')}\n</${tag}>`, next: i };
}

function blocks(lines, ctx, tight = false) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (BLANK.test(line)) {
      i++;
      continue;
    }

    // fenced code
    let m = line.match(FENCE_RE);
    if (m) {
      const indent = m[1].length;
      const fenceChar = m[2][0];
      const fenceLen = m[2].length;
      const closeRe = new RegExp('^\\s*' + (fenceChar === '`' ? '`' : '~') + '{' + fenceLen + ',}\\s*$');
      const body = [];
      i++;
      while (i < lines.length && !closeRe.test(lines[i])) {
        const lead = lines[i].match(/^\s*/)[0].length;
        body.push(lines[i].slice(Math.min(indent, lead)));
        i++;
      }
      i++;
      out.push(codeBlock(body.join('\n'), m[3]));
      continue;
    }

    // heading
    m = line.match(HEADING_RE);
    if (m) {
      const level = m[1].length;
      const text = m[2];
      const label = plain(text);
      let id = slugify(label) || 'section';
      for (let n = 2; ctx.ids.has(id); n++) id = `${slugify(label) || 'section'}-${n}`;
      ctx.ids.add(id);
      ctx.headings.push({ level, text: label, id });
      const anchor =
        level >= 2 && level <= 3
          ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>`
          : '';
      out.push(`<h${level} id="${id}">${inline(text)}${anchor}</h${level}>`);
      i++;
      continue;
    }

    // horizontal rule
    if (HR_RE.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // blockquote / callout
    if (QUOTE_RE.test(line)) {
      const inner = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        inner.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
        i++;
      }
      const co = inner[0].match(/^\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*$/i);
      if (co) {
        const kind = co[1].toLowerCase();
        const label = kind[0].toUpperCase() + kind.slice(1);
        out.push(
          `<div class="callout ${kind}"><b>${label}</b>${blocks(inner.slice(1), ctx)}</div>`
        );
      } else {
        out.push(`<blockquote>${blocks(inner, ctx)}</blockquote>`);
      }
      continue;
    }

    // list
    if (isListItem(line)) {
      const r = parseList(lines, i, ctx);
      out.push(r.html);
      i = r.next;
      continue;
    }

    // table
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) =>
        /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : ''
      );
      i += 2;
      const rows = [];
      while (i < lines.length && !BLANK.test(lines[i]) && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const cell = (tag, text, idx) =>
        `<${tag}${aligns[idx] ? ` style="text-align:${aligns[idx]}"` : ''}>${inline(text || '')}</${tag}>`;
      out.push(
        '<div class="table-wrap"><table><thead><tr>' +
          head.map((c, n) => cell('th', c, n)).join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + head.map((_, n) => cell('td', r[n], n)).join('') + '</tr>').join('') +
          '</tbody></table></div>'
      );
      continue;
    }

    // raw html block
    if (HTML_RE.test(line)) {
      const raw = [];
      const comment = /^\s*<!--/.test(line) && !/-->/.test(line);
      while (i < lines.length) {
        raw.push(lines[i]);
        const done = comment ? /-->/.test(lines[i]) : false;
        i++;
        if (done || (!comment && (i >= lines.length || BLANK.test(lines[i])))) break;
      }
      out.push(raw.join('\n'));
      continue;
    }

    // paragraph
    const para = [];
    while (i < lines.length && !BLANK.test(lines[i])) {
      if (para.length && (startsBlock(lines[i]) || HTML_RE.test(lines[i]))) break;
      para.push(lines[i]);
      i++;
    }
    const text = inline(para.join('\n'));
    out.push(tight ? text : `<p>${text}</p>`);
  }

  return out.join('\n');
}

function render(markdown) {
  const lines = markdown.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const ctx = { ids: new Set(), headings: [] };
  const html = blocks(lines, ctx);
  return { html, headings: ctx.headings };
}

module.exports = { render, slugify, esc, plain };

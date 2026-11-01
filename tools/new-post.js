#!/usr/bin/env node
'use strict';
/*
 * Create a new post file.
 *   npm run new -- "My post title" --tags csharp,design
 *   node tools/new-post.js "My post title" --tags csharp,design
 */
const fs = require('fs');
const path = require('path');
const { slugify } = require('./markdown');

const args = process.argv.slice(2);
let tags = [];
const words = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tags' && args[i + 1]) tags = args[++i].split(',').map((t) => t.trim()).filter(Boolean);
  else words.push(args[i]);
}
const title = words.join(' ').trim();
if (!title) {
  console.error('Usage: npm run new -- "Post title" [--tags tag1,tag2]');
  process.exit(1);
}

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const slug = slugify(title) || 'post';
const dir = path.resolve(__dirname, '..', 'posts');
const file = path.join(dir, `${date}-${slug}.md`);

fs.mkdirSync(dir, { recursive: true });
if (fs.existsSync(file)) {
  console.error('Already exists: ' + path.relative(process.cwd(), file));
  process.exit(1);
}

const content = `---
title: ${title}
date: ${date}
tags: [${tags.join(', ')}]
summary: One or two sentences that show in the post list and in link previews.
draft: true
---

Write your introduction here.

## First section

Text, lists, code and images all work. See README.md for the full list.

\`\`\`csharp
Console.WriteLine("Hello, blog");
\`\`\`
`;
fs.writeFileSync(file, content);
console.log('Created ' + path.relative(process.cwd(), file));
console.log('It is a draft. Set "draft: false" (or delete that line) when it is ready, then run: npm run build');

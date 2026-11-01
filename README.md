# Giao Nguyen – Personal Site & Blog

A static website with three pages: Home (short intro and latest posts), Blog (all posts, with search and tags) and About. Posts are written in Markdown. There is no server and no database, and no packages to install. You only need [Node.js](https://nodejs.org) 18 or newer (on Windows: `winget install OpenJS.NodeJS.LTS`).

## Folder map

| Path | What it is |
| --- | --- |
| `posts/` | **Your blog posts**, one `.md` file each. Put post images in `posts/images/`. |
| `docs/` | The finished website. It is generated; do not edit it by hand. |
| `src/home.html`, `src/about.html` | Templates for the Home and About pages. Edit your intro text here. |
| `src/assets/` | `style.css` (colors, fonts, layout) and `site.js` (light/dark toggle, code copy buttons, post search). |
| `src/static/` | Files copied as-is into `docs/` (for example a `CNAME` file for a custom domain). |
| `site.config.json` | Name, description, blog intro and your site address. |
| `tools/` | The build, preview and new-post scripts. |

## Write a post

1. Create the file (fills in the header for you):

   ```bash
   npm run new -- "How I review pull requests" --tags review,teamwork
   ```

   This creates `posts/2026-11-01-how-i-review-pull-requests.md`. You can also copy any existing post.

2. Write in Markdown below the header. When it is ready, change `draft: true` to `draft: false` (or delete that line).

3. Preview and build:

   ```bash
   npm run dev      # preview at http://localhost:4000, rebuilds when you save
   npm run build    # regenerate docs/ for publishing
   ```

4. Upload the result (see "Publish" below).

### The post header

```yaml
---
title: How I review pull requests
date: 2026-11-01            # shown on the post and used for ordering
tags: [review, teamwork]
summary: One or two sentences for the post list and link previews.
draft: false                # true = hidden from the site
updated: 2026-11-10         # optional, shows "Updated ..."
toc: false                  # optional, hides the "On this page" box
slug: my-custom-url-name    # optional, otherwise taken from the file name
---
```

### What Markdown supports

Headings (`##`, `###`), **bold**, *italic*, ~~strike~~, `inline code`, links, images, lists (nested and task lists), tables, quotes, horizontal rules, and fenced code blocks with a language for syntax colors:

````markdown
```csharp
Console.WriteLine("Hello");
```
````

- Images: put the file in `posts/images/` and write `![Alt text](images/diagram.png)`.
- Callouts: start a quote with `[!NOTE]`, `[!TIP]` or `[!WARNING]` on its own line.
- Raw HTML blocks (`<div>`, `<figure>`, `<details>`...) are passed through. Leave no blank line inside them.
- Posts in Vietnamese work too.

## Publish

First set your real address in `site.config.json`, for example `"siteUrl": "https://giao.example.com"` (no trailing slash). The RSS feed and `sitemap.xml` need it for full links.

- **GitHub Pages (free):** push this folder to a GitHub repository, then go to Settings → Pages → Deploy from a branch → `main` and the `/docs` folder. Commit the rebuilt `docs/` each time you add a post.
- **Netlify / Cloudflare Pages (free):** drag the `docs` folder onto Netlify Drop, or connect the repository with build command `npm run build` and publish directory `docs`.

## Change the look or the profile

- Colors and fonts: the variables at the top of `src/assets/style.css` (light values first, then the dark values).
- Intro text: `src/home.html` and `src/about.html`. The "What I work with" chips are in `about.html`.
- Name, email, blog title and intro: `site.config.json`.
- Then run `npm run build` again.

## The two sample posts

`posts/2026-11-01-habits-that-keep-csharp-readable.md` and `posts/2026-10-28-debugging-production-issues-checklist.md` are examples (tagged `sample`) written to show what the blog can do. Delete them or replace the text with your own writing before you publish.
# portfolio

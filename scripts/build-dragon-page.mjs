// Keep the playable page and the 404 game in sync: one canonical HTML source.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function renderDragonPage(notFound) {
  const replacements = [
    ['  <meta name="robots" content="noindex">\n', ''],
    ['<title>Page not found | GISMap Online</title>', '<title>Here be dragons | GISMap Online</title>'],
    ['  <p class="kicker">404 · Uncharted territory</p>\n', ''],
    ['<a href="/examples/">See examples</a><a href="/skills/">Explore agent skills</a>', ''],
    ['<p class="intro">We couldn’t find that page. Help our dragon cross the kingdom, or return to the map.</p>', '<p class="intro">Help our dragon cross the kingdom and collect maidens, or return to the map.</p>'],
    ['  <section id="suggestions" hidden aria-labelledby="suggestions-title"><h2 id="suggestions-title">Were you looking for…</h2><ul id="suggested-pages"></ul></section>\n', ''],
    ['<script type="module" src="/js/not-found.js?v=1"></script>\n', ''],
  ];
  let page = notFound;
  for (const [oldText, newText] of replacements) {
    if (!page.includes(oldText)) throw new Error(`404 template changed; update dragon-page generator: ${oldText}`);
    page = page.replace(oldText, newText);
  }
  return page;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const source = await readFile(new URL('../404.html', import.meta.url), 'utf8');
  const target = new URL('../dragons/index.html', import.meta.url);
  const expected = renderDragonPage(source);
  if (process.argv.includes('--check')) {
    if (await readFile(target, 'utf8') !== expected) throw new Error('Dragon page is out of date; run node scripts/build-dragon-page.mjs');
    console.log('Dragon page verified.');
  } else {
    await writeFile(target, expected);
    console.log('Dragon page generated.');
  }
}

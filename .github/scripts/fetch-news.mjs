// Fetches today's headlines from a Hebrew news RSS feed and writes news.json for the dashboard
// (news sites don't allow a web page to read their feeds directly). Only the headline text and its
// time are kept. Feeds are tried in order; the first one that answers with items wins.
//
//   node fetch-news.mjs [out.json]
import { writeFile } from 'node:fs/promises';

const FEEDS = [
  { name: 'ynet', url: 'https://www.ynet.co.il/Integration/StoryRss2.xml' },
  { name: 'וואלה', url: 'https://rss.walla.co.il/feed/1?type=main' },
  { name: 'מעריב', url: 'https://www.maariv.co.il/Rss/RssChadashot' }
];
const MAX_ITEMS = 15;
const out = process.argv[2] || 'news.json';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function text(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ').trim();
}
function tag(xml, name) {
  const m = xml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
  return m ? text(m[1]) : '';
}

async function read(feed) {
  const res = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; family-dashboard/1.0)' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const xml = await res.text();
  const seen = new Set(), items = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
    const title = tag(m[0], 'title'), when = new Date(tag(m[0], 'pubDate'));
    if (!title || seen.has(title)) continue;
    seen.add(title);
    items.push({ title: title.slice(0, 200), at: isNaN(when) ? null : when.toISOString() });
  }
  if (!items.length) throw new Error('no items');
  // Newest first where the feed gives times; feeds without times keep their own order.
  if (items.every((i) => i.at)) items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { source: feed.name, items: items.slice(0, MAX_ITEMS) };
}

for (const feed of FEEDS) {
  try {
    const news = await read(feed);
    await writeFile(out, JSON.stringify(news, null, 1) + '\n');
    console.log('Wrote ' + news.items.length + ' headlines from ' + feed.name + ' to ' + out);
    process.exit(0);
  } catch (e) {
    console.error(feed.name + ' failed: ' + e.message);
  }
}
console.error('No news feed could be read; keeping the previous news.json');
process.exit(1);

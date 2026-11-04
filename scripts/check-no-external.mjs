#!/usr/bin/env node
// Fails if the built SPA references external http(s) origins a browser could load (fonts, CDNs,
// analytics). Library documentation/namespace strings that are never fetched are allow-listed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'apps/web/dist';
const ALLOWED = [
  /^https?:\/\/www\.w3\.org\//,
  /^https?:\/\/(reactjs\.org|react\.dev|reactrouter\.com|mantine\.dev|github\.com|git\.io|fb\.me)\b/,
  /^https?:\/\/(tanstack\.com|recharts\.org|i18next\.com|www\.i18next\.com|zod\.dev)\b/,
  /^https?:\/\/(localhost|127\.0\.0\.1)\b/,
];
const found = new Map();
function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|html)$/.test(f)) {
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(/https?:\/\/[a-zA-Z0-9.-]+[^\s"'`)]*/g)) {
        if (!ALLOWED.some((r) => r.test(m[0]))) found.set(m[0].slice(0, 120), p);
      }
    }
  }
}
walk(dir);
if (found.size) {
  for (const [url, file] of found) console.error(`external reference: ${url} (${file})`);
  process.exit(1);
}
console.log(`no external origins in ${dir}`);

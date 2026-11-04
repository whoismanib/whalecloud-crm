#!/usr/bin/env node
// Compares i18n keys across es-CL (reference), en and zh-CN; exits 1 on any difference.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', 'packages', 'shared', 'src', 'i18n');
const locales = ['es-CL', 'en', 'zh-CN'];

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

let failed = false;
for (const file of readdirSync(join(root, 'es-CL'))) {
  const ref = new Set(flatten(JSON.parse(readFileSync(join(root, 'es-CL', file), 'utf8'))));
  for (const loc of locales.slice(1)) {
    const keys = new Set(flatten(JSON.parse(readFileSync(join(root, loc, file), 'utf8'))));
    const missing = [...ref].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !ref.has(k));
    if (missing.length || extra.length) {
      failed = true;
      console.error(
        `${loc}/${file}: missing ${JSON.stringify(missing)} extra ${JSON.stringify(extra)}`,
      );
    }
  }
  console.log(`${file}: ${ref.size} keys`);
}
process.exit(failed ? 1 : 0);

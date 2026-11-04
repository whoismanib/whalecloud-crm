// Checks that commit subjects follow Conventional Commits (CONVENTIONS.md §7).
//   node scripts/check-commits.mjs                 # whole history
//   node scripts/check-commits.mjs <from>..<to>    # a range (CI: PR base..head)
// Merge commits and the repository's root "Initial commit" are allowed.
import { execFileSync } from 'node:child_process';

const TYPES = ['feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'build', 'ci', 'chore', 'revert'];
const RE = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9/._-]*\\))?!?: \\S.*$`);

const range = process.argv[2];
const args = ['log', '--format=%H%x1f%P%x1f%s', ...(range ? [range] : [])];
const lines = execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);

const bad = [];
for (const line of lines) {
  const [hash, parents, subject] = line.split('\x1f');
  const parentCount = parents ? parents.split(' ').length : 0;
  if (parentCount > 1 || subject.startsWith('Merge ')) continue;
  if (parentCount === 0 && subject === 'Initial commit') continue;
  if (!RE.test(subject)) bad.push(`${hash.slice(0, 7)} ${subject}`);
}

if (bad.length) {
  console.error(`Commits that do not follow Conventional Commits (${bad.length}):`);
  for (const b of bad) console.error(`  ${b}`);
  console.error(`Expected: <type>(<scope>): <summary>, type in ${TYPES.join(', ')}`);
  process.exit(1);
}
console.log(`${lines.length} commits checked: Conventional Commits OK`);

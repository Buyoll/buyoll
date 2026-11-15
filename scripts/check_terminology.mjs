import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIRS = ['src', 'server', 'public', 'tests'];
const TARGET_FILES = ['index.html', 'package.json', '.env.example'];
const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.html', '.json', '.css', '.md']);

// Prohibited terms: Host, Guest, Airbus, and buyer role references (case-insensitive)
const PATTERN = /\b(Host|Guest|Airbus|buyer)\b/i;

// Legacy migration compatibility block in server/migrations.ts is allowed solely to migrate pre-existing JSON rows
const ALLOW_LINE = (relPath, line) => {
  if (relPath === 'server/migrations.ts') {
    return line.includes('Normalize legacy') || line.includes('as any');
  }
  return false;
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (EXTS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

const files = [
  ...TARGET_DIRS.flatMap((d) => walk(path.join(ROOT, d))),
  ...TARGET_FILES.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)),
];

const violations = [];

for (const file of files) {
  const relPath = path.relative(ROOT, file).replace(/\\/g, '/');
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(PATTERN);
    if (match && !ALLOW_LINE(relPath, line)) {
      violations.push({
        file: relPath,
        line: i + 1,
        term: match[0],
        snippet: line.trim().slice(0, 120),
      });
    }
  }
}

if (violations.length > 0) {
  console.error(`Found ${violations.length} prohibited terminology occurrence(s):`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.term}] -> ${v.snippet}`);
  }
  process.exit(1);
}

console.log(`Terminology check passed (${files.length} files scanned, 0 prohibited terms).`);

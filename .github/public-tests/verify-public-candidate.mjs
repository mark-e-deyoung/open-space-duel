import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

function fail(message) {
  console.error(`candidate verification: ${message}`);
  process.exit(1);
}

function gitBlobSha1(data) {
  const header = Buffer.from(`blob ${data.length}\0`);
  return createHash('sha1').update(header).update(data).digest('hex');
}

function walk(root, dir = root, out = []) {
  for (const name of readdirSync(dir).sort()) {
    // The verifier runs before npm ci and build on a clean checkout.
    // Pre-existing generated/install trees cannot be declared in the manifest
    // under the existing policy and must not bypass its exact-file census.
    if (name === '.git') continue;
    if (name === 'node_modules' || name === 'dist') {
      fail(`pre-existing directory is not permitted: ${relative(root, join(dir, name))}`);
    }
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail(`symlink is not allowed: ${relative(root, path)}`);
    if (stat.isDirectory()) walk(root, path, out);
    else if (stat.isFile()) out.push(relative(root, path).split(sep).join('/'));
    else fail(`unsupported filesystem object: ${relative(root, path)}`);
  }
  return out;
}

const candidateRoot = resolve(process.argv[2] || 'candidate');
const manifestPath = join(candidateRoot, 'PUBLIC-PROJECTION-MANIFEST.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.schemaVersion !== 2) fail(`unsupported manifest schemaVersion ${manifest.schemaVersion}`);
if (manifest.publicRepository !== 'mark-e-deyoung/open-space-duel') {
  fail(`unexpected publicRepository ${JSON.stringify(manifest.publicRepository)}`);
}
if (!['ordinary', 'private-required'].includes(manifest.qualificationClass)) {
  fail(`unexpected qualificationClass ${JSON.stringify(manifest.qualificationClass)}`);
}
for (const [name, value] of [
  ['projectionPolicySha256', manifest.projectionPolicySha256],
  ['promotionPolicySha256', manifest.promotionPolicySha256],
]) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(`invalid ${name}`);
}
if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail('manifest contains no projected files');

const declared = new Map();
for (const item of manifest.files) {
  if (
    !item ||
    typeof item.path !== 'string' ||
    typeof item.gitBlobSha1 !== 'string' ||
    !/^[a-f0-9]{40}$/.test(item.gitBlobSha1) ||
    !Number.isInteger(item.bytes) ||
    item.bytes < 0
  ) fail('malformed manifest file entry');
  if (declared.has(item.path)) fail(`duplicate manifest path ${item.path}`);
  declared.set(item.path, item);
}

const actualPaths = walk(candidateRoot).filter((path) => path !== 'PUBLIC-PROJECTION-MANIFEST.json');
const actualSet = new Set(actualPaths);

for (const path of actualPaths) {
  if (!declared.has(path)) fail(`candidate contains undeclared file ${path}`);
}
for (const path of declared.keys()) {
  if (!actualSet.has(path)) fail(`manifest declares missing file ${path}`);
}

const forbiddenText = [
  'open-space-duel-private',
  'SemperSupra/engineering-governance-private',
  'PUBLIC_REPO_DEPLOY_KEY',
  'CAPROVER_PASSWORD',
  // Public candidates must contain neither private test instrumentation nor
  // a URL-activated test-mode bypass. Do not trust private projector alone.
  '__OSD_TEST_HOOKS__',
  'getDiagText',
  'testMode',
];
const highConfidenceSecrets = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

for (const [path, item] of declared) {
  const data = readFileSync(join(candidateRoot, path));
  if (gitBlobSha1(data) !== item.gitBlobSha1) fail(`Git blob identity mismatch for ${path}`);
  if (data.length !== item.bytes) fail(`size mismatch for ${path}`);
  // A NUL byte must not exempt a projected file from forbidden-reference
  // or ASCII-formatted secret checks. This applies to reviewed binary assets.
  const text = data.toString('utf8');
  // Raw UTF-8 checks remain mandatory. Also inspect a NUL-elided view so
  // zero-interleaved ASCII (including UTF-16-style content) cannot hide
  // restricted markers or synthetic secret patterns in a declared blob.
  // This is intentionally fail-closed even when the asset is reviewed binary.
  const scanViews = data.includes(0)
    ? [text, text.replaceAll(String.fromCharCode(0), '')]
    : [text];
  for (const view of scanViews) {
    for (const needle of forbiddenText) {
      if (view.includes(needle)) fail(`forbidden private/restricted reference in ${path}`);
    }
    for (const pattern of highConfidenceSecrets) {
      if (pattern.test(view)) fail(`high-confidence secret pattern in ${path}`);
    }
  }
}

const pkg = JSON.parse(readFileSync(join(candidateRoot, 'package.json'), 'utf8'));
if (pkg.repository?.url !== 'git+https://github.com/mark-e-deyoung/open-space-duel.git') {
  fail('package repository metadata is not publicized');
}
if (pkg.license !== 'ISC') fail(`unexpected package license ${JSON.stringify(pkg.license)}`);

// The public exporter omits private tests/ and scripts/ entirely. A published
// package may not advertise commands depending on those removed paths.
// This checks developer usability before installing or executing candidate code.
const privateOnlyScripts = new Set([
  'build:qualification',
  'test:exposure',
  'verify:production-exposure',
  'test:exposure:scanner',
  'test:exposure:preflight',
]);
for (const [name, command] of Object.entries(pkg.scripts || {})) {
  if (privateOnlyScripts.has(name)) {
    fail(`private-only npm script remains in public package: ${name}`);
  }
  if (typeof command !== 'string' ||
    /(?:^|\s)(?:node|bash|sh)\s+scripts\//.test(command) ||
    /(?:^|\s)(?:tests|scripts)\//.test(command) ||
    /--mode\s+qualification\b/.test(command)) {
    fail(`public npm script references withheld source: ${name}`);
  }
}

// Public projection defines exactly which package commands are allowed to run.
// npm ci, npm run build/lint/typecheck, and npm lifecycle hooks all execute
// package scripts. Reject undeclared hooks and command drift, not just
// references to the omitted private scripts/ and tests/ trees.
const approvedScripts = new Map([
  ['dev', 'vite'],
  ['preview', 'vite preview'],
  ['lint', 'eslint src'],
  ['typecheck', 'tsc --noEmit'],
  ['build', 'tsc --noEmit && vite build'],
]);
for (const [name, command] of Object.entries(pkg.scripts || {})) {
  if (approvedScripts.get(name) !== command) {
    fail(`unapproved npm script in public candidate: ${name}`);
  }
}

console.log(`Verified sanitized public candidate: ${declared.size} projected files`);
console.log(`Qualification class: ${manifest.qualificationClass}`);
console.log(`Projection policy SHA-256: ${manifest.projectionPolicySha256}`);
console.log(`Promotion policy SHA-256: ${manifest.promotionPolicySha256}`);

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

function fail(message) {
  console.error(`candidate verification: ${message}`);
  process.exit(1);
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function walk(root, dir = root, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name === '.git' || name === 'node_modules' || name === 'dist') continue;
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

if (manifest.schemaVersion !== 1) fail(`unsupported manifest schemaVersion ${manifest.schemaVersion}`);
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
  if (!item || typeof item.path !== 'string' || typeof item.sha256 !== 'string') fail('malformed manifest file entry');
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
];
const highConfidenceSecrets = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

for (const [path, item] of declared) {
  const data = readFileSync(join(candidateRoot, path));
  if (sha256(data) !== item.sha256) fail(`digest mismatch for ${path}`);
  if (Number.isInteger(item.bytes) && data.length !== item.bytes) fail(`size mismatch for ${path}`);
  if (data.includes(0)) continue;
  const text = data.toString('utf8');
  for (const needle of forbiddenText) {
    if (text.includes(needle)) fail(`forbidden private/restricted reference in ${path}`);
  }
  for (const pattern of highConfidenceSecrets) {
    if (pattern.test(text)) fail(`high-confidence secret pattern in ${path}`);
  }
}

const pkg = JSON.parse(readFileSync(join(candidateRoot, 'package.json'), 'utf8'));
if (pkg.repository?.url !== 'git+https://github.com/mark-e-deyoung/open-space-duel.git') {
  fail('package repository metadata is not publicized');
}
if (pkg.license !== 'ISC') fail(`unexpected package license ${JSON.stringify(pkg.license)}`);

console.log(`Verified sanitized public candidate: ${declared.size} projected files`);
console.log(`Qualification class: ${manifest.qualificationClass}`);
console.log(`Projection policy SHA-256: ${manifest.projectionPolicySha256}`);
console.log(`Promotion policy SHA-256: ${manifest.promotionPolicySha256}`);

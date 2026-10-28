import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const verifier = fileURLToPath(new URL('./verify-public-candidate.mjs', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'osd-public-verifier-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const digest = (buffer) => createHash('sha1')
  .update(Buffer.from('blob ' + buffer.length + '\0')).update(buffer).digest('hex');
const manifestDigest = '0'.repeat(64);

function fixture(label, source = 'export const ordinary = true;', scripts = {}) {
  const dir = join(scratch, label);
  mkdirSync(join(dir, 'src'), { recursive: true });
  const files = [
    ['package.json', JSON.stringify({
      name: 'osd-public-fixture', license: 'ISC', scripts,
      repository: { url: 'git+https://github.com/mark-e-deyoung/open-space-duel.git' }
    })],
    ['src/main.ts', source],
  ];
  for (const [p, data] of files) writeFileSync(join(dir, p), data);
  const manifest = {
    schemaVersion: 2,
    publicRepository: 'mark-e-deyoung/open-space-duel',
    qualificationClass: 'private-required',
    projectionPolicySha256: manifestDigest,
    promotionPolicySha256: manifestDigest,
    files: files.map(([path, content]) => {
      const value = Buffer.from(content);
      return { path, bytes: value.length, gitBlobSha1: digest(value) };
    })
  };
  writeFileSync(join(dir, 'PUBLIC-PROJECTION-MANIFEST.json'),
    JSON.stringify(manifest));
  return dir;
}
function check(dir) {
  const result = spawnSync(process.execPath, [verifier, dir],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined, result.error?.message);
  return { status: result.status, log: result.stdout + result.stderr };
}
test('minimal legitimate public candidate is accepted', () => {
  const result = check(fixture('safe'));
  assert.equal(result.status, 0, result.log);
  assert.match(result.log, /Verified sanitized public candidate/);
});
for (const [label, text] of [
  ['QA global', 'window.__OSD_TEST_HOOKS__ = {}'],
  ['privileged diagnostics', 'const getDiagText = () => "private"'],
  ['URL test bypass', 'const isTestMode = location.search.includes("testMode")'],
]) {
  test(label + ' is refused even with correct manifest checksums', () => {
    const result = check(fixture(label.replaceAll(' ', '-'), text));
    assert.equal(result.status, 1, result.log);
    assert.match(result.log, /forbidden private\/restricted reference/);
  });
}
test('unlisted source file is rejected', () => {
  const dir = fixture('unlisted');
  writeFileSync(join(dir, 'private.txt'), 'not declared');
  const result = check(dir);
  assert.equal(result.status, 1, result.log);
  assert.match(result.log, /undeclared file/);
});
test('symlink escape is rejected', () => {
  const dir = fixture('symlink');
  symlinkSync(join(scratch, 'outside'), join(dir, 'src', 'link'));
  const result = check(dir);
  assert.equal(result.status, 1, result.log);
  assert.match(result.log, /symlink is not allowed/);
});
test('manifest checksum mismatch is rejected', () => {
  const dir = fixture('tampered');
  writeFileSync(join(dir, 'src', 'main.ts'), 'changed after manifest');
  const result = check(dir);
  assert.equal(result.status, 1, result.log);
  assert.match(result.log, /blob identity mismatch/);
});

for (const [label, scripts] of [
  ['retained QA build command', { 'build:qualification': 'vite build --mode qualification' }],
  ['retained private exposure script', { 'test:exposure': 'node scripts/run-exposure-check.mjs' }],
  ['production command points to omitted script', { build: 'vite build && node scripts/verify-public-exposure.mjs' }],
  ['private tests path remains referenced', { lint: 'eslint src tests/e2e' }],
]) {
  test('private npm script dependency is refused: ' + label, () => {
    const result = check(fixture('script-' + label.replaceAll(' ', '-'),
      'export const ordinary = true;', scripts));
    assert.equal(result.status, 1, result.log);
    assert.match(result.log, /private-only npm script|public npm script references withheld source/);
  });
}
test('public package with safe build and lint scripts is accepted', () => {
  const result = check(fixture('safe-public-scripts',
    'export const ordinary = true;',
    { build: 'tsc --noEmit && vite build', lint: 'eslint src', typecheck: 'tsc --noEmit' }));
  assert.equal(result.status, 0, result.log);
});

test('NUL-bearing candidate source cannot bypass public QA-marker scan', () => {
  const content = Buffer.concat([
    Buffer.from([0, 1]),
    Buffer.from('window.__OSD_TEST_HOOKS__ = {};')
  ]);
  const result = check(fixture('nul-marker', content));
  assert.equal(result.status, 1, result.log);
  assert.match(result.log, /forbidden private\/restricted reference/);
});

test('NUL-bearing source cannot bypass synthetic token-pattern scan', () => {
  const content = Buffer.concat([
    Buffer.from([0, 1]),
    Buffer.from('ghp_' + 'Z'.repeat(20))
  ]);
  const result = check(fixture('nul-pattern', content));
  assert.equal(result.status, 1, result.log);
  assert.match(result.log, /high-confidence secret pattern/);
});

test('benign reviewed binary with NUL is accepted when manifest matches bytes', () => {
  const content = Buffer.from([0, 1, 2, 128, 255, 0, 3]);
  const result = check(fixture('nul-benign', content));
  assert.equal(result.status, 0, result.log);
  assert.match(result.log, /Verified sanitized public candidate/);
});


test('interleaved NUL forbidden QA marker is denied in projected bytes', () => {
  const marker = 'window.__OSD_TEST_HOOKS__ = {}';
  const bytes = Buffer.from(marker.split('').join('\\0') + '\\0', 'binary');
  const result = check(fixture('nul-interleaved-marker', bytes));
  assert.equal(result.status, 1, result.log);
  assert.match(result.log, /forbidden private\\/restricted reference/);
});

test('UTF-16LE-like synthetic token pattern cannot bypass scan', () => {
  const bytes = Buffer.from('ghp_' + 'Q'.repeat(20), 'utf16le');
  const result = check(fixture('utf16le-synthetic-token', bytes));
  assert.equal(result.status, 1, result.log);
  assert.match(result.log, /high-confidence secret pattern/);
});

test('NUL-bearing benign split data with no marker remains accepted', () => {
  const bytes = Buffer.from('a\\0b\\0c\\0', 'binary');
  const result = check(fixture('nul-benign-split', bytes));
  assert.equal(result.status, 0, result.log);
});

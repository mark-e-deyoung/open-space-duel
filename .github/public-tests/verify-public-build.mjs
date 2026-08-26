import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function fail(message) {
  console.error(`build verification: ${message}`);
  process.exit(1);
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

const root = resolve(process.argv[2] || 'artifact');
const expectedClass = process.argv[3] || null;
const receipt = JSON.parse(readFileSync(join(root, 'PUBLIC-BUILD-RECEIPT.json'), 'utf8'));
const bundle = readFileSync(join(root, 'osd-spa.tar.gz'));

if (receipt.schemaVersion !== 1) fail(`unsupported schemaVersion ${receipt.schemaVersion}`);
if (receipt.publicRepository !== 'mark-e-deyoung/open-space-duel') fail('unexpected publicRepository');
if (!/^[a-f0-9]{40}$/.test(receipt.publicCandidateSha || '')) fail('invalid publicCandidateSha');
if (!['ordinary', 'private-required'].includes(receipt.qualificationClass)) fail('invalid qualificationClass');
if (expectedClass && receipt.qualificationClass !== expectedClass) {
  fail(`qualification class mismatch: expected ${expectedClass}, got ${receipt.qualificationClass}`);
}
for (const name of ['publicManifestSha256', 'projectionPolicySha256', 'promotionPolicySha256', 'bundleSha256']) {
  if (!/^[a-f0-9]{64}$/.test(receipt[name] || '')) fail(`invalid ${name}`);
}
if (!Number.isInteger(receipt.workflowRunId) || receipt.workflowRunId <= 0) fail('invalid workflowRunId');
if (!Number.isInteger(receipt.workflowRunAttempt) || receipt.workflowRunAttempt <= 0) fail('invalid workflowRunAttempt');

const actualBundleSha = sha256(bundle);
if (actualBundleSha !== receipt.bundleSha256) fail(`bundle digest mismatch: ${actualBundleSha}`);

console.log(`Verified exact public build ${receipt.bundleSha256}`);
console.log(`Candidate ${receipt.publicCandidateSha} (${receipt.qualificationClass})`);

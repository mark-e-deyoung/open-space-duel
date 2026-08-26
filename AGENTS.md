# Open Space Duel — Public Repository Guardrails

This repository is the **sanitized public published-source / deployment / release plane** for Open Space Duel. It is not the normal product-development authority.

## Repository role

Normal product development, defect implementation, comprehensive validation, internal research, and value-bearing engineering work occur in the declared private development authority. This public repository receives deliberately selected public-safe candidates/releases.

Public issues and user reports may originate here, but ordinary product fixes MUST be reconciled through the private development authority before the next public projection. Do not treat the public branch history as permission to resume direct public development.

## Allowed work

Public-safe work may include:

- published game/release source and assets intended for this public candidate;
- user-facing documentation;
- public API/protocol contracts intended for interoperability;
- generic public build/deploy mechanics;
- deliberately selected ordinary smoke/unit tests;
- public provenance, checksums, SBOM/attestation, and verification material.

## Prohibited by default

Agents and contributors MUST NOT:

- implement normal product features or fixes directly in this repository;
- introduce credentials or private-read tokens;
- attempt to reconstruct or publish private evaluator/corpus/research material;
- copy private development trees and delete known-private paths as a publication strategy;
- hand-edit generated/projection content when an authoritative private projection/export process exists;
- infer release/promotion authority merely from repository write access.

Emergency public-only fixes require an explicit exception and reconciliation back into the private development authority before the next projection.

## Public/private information boundary

The public repository may contain public-required/public-trust material and approved sanitized verdicts. Specialized evaluator logic, comprehensive conformance/adversarial corpora, private failure knowledge, internal red-team/research material, agent-effectiveness knowledge, credentials, authenticated private data, and other restricted material remain private by default.

Public provenance shows what public source/workflow produced an artifact. It does not by itself establish deep correctness, security, comprehensive compatibility, or private promotion eligibility.

## Release discipline

A public candidate should originate from a constructive/default-deny projection of an immutable private candidate. Public CI must be self-sufficient from public-safe inputs and must not receive credentials capable of reading the private development/value plane.

Where private specialized validation applies, approval is bound to immutable public source/build/artifact identities. When practical, promotion should publish the exact artifact that was validated rather than rebuilding after approval.

## Historical cutover

The legacy public-development/deployment history through commit `82550b81081cc5f3232785c6a1b54dc33f62fb2b` is acknowledged as already public. Governance after that cutover treats this repository as deploy/release-only by default.

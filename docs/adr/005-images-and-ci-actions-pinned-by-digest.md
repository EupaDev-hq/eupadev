---
adr: 005
title: Images and CI actions pinned by digest
status: accepted
date: 2026-10-13
decision-makers: Ilan
supersedes:
related: [ADR-007]
check: partial
---
## Context
An image or CI action tag (`trivy:0.75.0`, `actions/checkout@v4`) is only a
name: the publisher, or whoever steals its account, can point it to
booby-trapped content without our repository changing (happened to
`tj-actions/changed-files` in March 2025). A digest (image `sha256`, commit
SHA) designates one precise content. The golden images (bases of the tools)
are rebuilt every week by the installation's forge to receive fixes, and
designated by organisation variables (`BASE_IMAGE_BUILD`, `BASE_IMAGE_RUN`,
`CI_IMAGE`); in Gitea 28.1.0, writing these variables requires being an
owner of the organisation, a right that also allows changing all its branch
protections, whereas the CI (`svc-ci`) only has read access to the code and
write access to the registry. Details:
`docs/reflexions/2026-10-13-adr-details.md`.

## Decision
Designate every image and every CI action by a content digest, never by a
tag alone, except the controlled exception of the golden images, and sign
our own images.
- **Images**: `name:tag@sha256:…` (multi-architecture index) everywhere
  (Compose, `FROM`, `docker run`, the runner's `docker://`); the tag is for
  the reader, only the digest counts.
- **Actions**: `owner/repo@<40-character SHA> # vX.Y.Z` for every `uses:`;
  exceptions: local action `./…` and `docker://…@sha256:…`.
- **Golden images, the only exception**: designated by tag
  (`base-node:build-22`), so that a fix reaches each tool at its next build
  without a commit. In exchange, the tool's build
  1. resolves the tag to a digest once, then uses only that digest;
  2. verifies its cosign signature with the installation's key, and refuses
     to build if it is missing or comes from another key;
  3. records the digest in the OCI labels `org.opencontainers.image.base.*`
     and in the SBOM of the produced image.
- **Variables in image position**: only `BASE_IMAGE_BUILD`,
  `BASE_IMAGE_RUN` and `CI_IMAGE` (closed list), whose value is the tag of a
  golden image of the installation's registry; any other is refused.
- **Signature of our images** by cosign, with the key of whoever builds
  them: EupaDev for the engine image; the client's installation for what
  its forge builds (golden images, launcher). Signature verified before any
  use; unsigned or other key = refused.

## Rejected alternatives
- Tag alone — movable without a trace in the repository.
- Signatures alone, without a digest — they prove who built, not that it is
  the reviewed content, and most public images are not signed; the two
  complement each other, hence both for our images.
- Golden images by digest, written into the variables by the CI — the same
  account publishes and writes (no added security), an owner right that
  allows weakening the gates, and no trace in the repository.
- Golden images by tag without a guard-rail — neither a verified origin,
  nor a trace of the base used.

## Consequences
- An image or action update is a reviewed diff, in the format Renovate can
  keep up to date.
- **The digest guarantees integrity, not trust**: content that was
  booby-trapped when the digest was recorded stays so (the role of Trivy and
  of the review).
- **Golden images**: two builds of the same commit can start from different
  bases (wanted, and each image says which). A broken base, or one
  booby-trapped but signed with the installation's key, spreads; an image
  uploaded without the key is refused.
- **Limit**: `CI_IMAGE` is pulled by the runner before the job, outside the
  three guard-rails; it relies on the registry's access control (only the
  CI of the main branch publishes there).
- One more cosign key per installation, in the vault; if lost, it blocks
  builds and deployments until a new signature.
- **Limit of the check**: it reads by patterns (`image:`, `FROM`, `uses:`,
  `docker run`, `docker://`); another form escapes it, and the value of a
  variable is verified at build time.

## Verification
- `.github/scripts/verify-digests.py` (tested by
  `test_verify_digests.py`, run by `image-digests.yml` on every push and
  PR) fails the CI on any image or action without a digest; it will also
  refuse an image variable outside the closed list.
- The tools' CI will resolve and verify each golden image (refusal if the
  signature is missing or foreign, proven by a kit test with an unsigned
  base), then will refuse to publish if the base's digest is missing from,
  or differs in, the labels or the SBOM.
- Deployment will verify the signature on the target machine and will refuse
  an unsigned image (deployer test).
- The lab's `verify-*` workflows prove that the images pinned by digest
  download and run.

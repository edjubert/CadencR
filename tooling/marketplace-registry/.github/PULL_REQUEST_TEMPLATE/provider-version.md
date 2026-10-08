---
name: Provider version
about: Submit immutable metadata for one provider version
---

## Identity

- Provider ID:
- Version:
- Publisher/maintainer GitHub handles:
- Source repository:
- Source commit (full SHA):
- Release tag:

## Artifacts

| Platform | Release asset URL | SHA-256 |
| -------- | ----------------- | ------- |
|          |                   |         |

## Review notes

- Native CLI prerequisite and authentication/setup documentation:
- License and provenance:
- User-visible changes:
- Dependency or privilege changes:

## Checklist

- [ ] I control or am authorized to publish the linked project and provider ID.
- [ ] The source revision and every archive are immutable and exact-versioned.
- [ ] Every checksum was calculated from the linked release asset.
- [ ] Archives contain no credentials; users authenticate through the native CLI.
- [ ] `version`, model discovery, ACP v1 runtime, and prompt-free conformance pass.
- [ ] I ran `npm test`, `npm run validate`, and `npm run build:index`.
- [ ] I understand maintainers review executable changes and may reject or revoke a version.

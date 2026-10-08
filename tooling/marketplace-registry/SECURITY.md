# Registry Security Policy

## Reporting

Before deploying this template, repository owners must replace this paragraph
with a monitored private security contact or GitHub private vulnerability
reporting instructions. Do not invent or publish an unmonitored address.

Include the provider ID/version, affected digests, source revision, impact, and
safe reproduction details. Do not attach credentials or exploit public users.

## Maintainer response

Maintainers should preserve evidence, verify artifact identity, coordinate with
the publisher, and decide independently whether to stop discovery and whether to
revoke execution through the signed blocklist. Signing-key compromise requires
the product trust-root recovery process; publishing a newly signed index alone
cannot replace a compiled trust root.

## CI trust boundary

Pull-request jobs run repository validation scripts and tests from the PR checkout;
these are untrusted code when the PR changes tooling. They receive no signing
secret or write credential, and must never download or execute provider archives. Protected
publisher jobs run from reviewed default-branch metadata, revalidate it, and
must not invoke package executables or contributor-controlled build scripts.

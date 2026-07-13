# Credential exposure response record

Last reviewed: 2026-07-13

Private redacted Gitleaks reports are stored outside Git under `$HOME/.wheelmaker/security-reports/wheelmaker/`. Do not copy report JSON, secret values, authorization headers, or reusable URLs into this repository.

## Current tree

`gitleaks dir --redact --no-banner .` completed with zero findings on 2026-07-13. No current source/config/document cleanup was required by this scan.

## Historical findings

Gitleaks scanned 2,434 commits and reported eight matches. Duplicate matches reduce to four location fingerprints, all in the deleted `wheelmaker_diag_out.log`. A private comparison found three distinct token values and no obvious test/example/fake/placeholder marker, so every value is classified as a suspected real Registry credential until its owner proves otherwise.

| Rule ID | File / commit / line | Redacted fingerprint | Classification | Provider owner | Rotation / revocation status | Verified at |
| --- | --- | --- | --- | --- | --- | --- |
| `generic-api-key` | `wheelmaker_diag_out.log`, `2c61525ae3ec`, line 6 | `2c61525a…:wheelmaker_diag_out.log:generic-api-key:6` | Suspected real | Registry operator, unconfirmed | Pending owner revocation | Not verified |
| `generic-api-key` | `wheelmaker_diag_out.log`, `2c61525ae3ec`, line 7 | `2c61525a…:wheelmaker_diag_out.log:generic-api-key:7` | Suspected real | Registry operator, unconfirmed | Pending owner revocation | Not verified |
| `generic-api-key` | `wheelmaker_diag_out.log`, `64d5b8d6b2af`, line 6 | `64d5b8d6…:wheelmaker_diag_out.log:generic-api-key:6` | Suspected real | Registry operator, unconfirmed | Pending owner revocation | Not verified |
| `generic-api-key` | `wheelmaker_diag_out.log`, `64d5b8d6b2af`, line 7 | `64d5b8d6…:wheelmaker_diag_out.log:generic-api-key:7` | Suspected real | Registry operator, unconfirmed | Pending owner revocation | Not verified |

The two commits contain equivalent historical material; the location fingerprints may refer to the same three underlying values. That does not reduce the revocation requirement.

## Owner action required

The Registry credential owner must:

1. Identify every Registry deployment that could have used a token from the historical diagnostic log.
2. Generate a new token in the protected server configuration/secret store without writing it to Git, chat, or a report.
3. Restart the Registry and update each Hub through its protected local configuration.
4. Verify old browser device sessions fail and Hubs reconnect only with the new token.
5. Revoke or otherwise make every historical value unusable.
6. Record only the owner, completion state, and verification timestamp in the table above.

Until an authorized owner completes and verifies these actions, credential response remains externally blocked even though the current tree and staged-change gates are clean. Git history rewriting is intentionally deferred to a separate maintenance window after revocation; it is not a substitute for revocation.

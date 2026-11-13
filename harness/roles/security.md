---
name: security
description: Use when the diff touches auth, logging, secrets, or trust boundaries.
tier: deep
tools: [read]
---

Return JSON findings. Include `cwe` when known. Categories: secret-exposed, pii-in-logs, boundary-violation.
Never set severity.

CI `protected-change` decides a protected change on the pull request. This file does not.

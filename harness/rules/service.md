# Service rules

- Each service owns its data. Do not reach into another service's database or internal modules.
- Prefer events over direct calls when the estate is event-driven; document exceptions in an ADR.
- The shared contracts package is the only permitted cross-service import.
- Publishes go through the contracts package publisher, never ad-hoc HTTP helpers that skip schemas.

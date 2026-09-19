# Runtime drift (OpenTelemetry)

Static boundary rules miss HTTP coupling: no import, no depcruise hit.

1. Instrument services with OpenTelemetry HTTP client/server spans.
2. Export a call graph to `harness/state/traces/calls.json`:

```json
{ "edges": [{ "from": "services/orders", "to": "services/billing", "via": "http", "inImportGraph": false }] }
```

3. Run `./verify.sh` with tier `manual` or invoke the `runtime-drift` check via a custom run.
4. Smoke without OTEL: `cd examples/two-services && node scripts/smoke-runtime-drift.js`

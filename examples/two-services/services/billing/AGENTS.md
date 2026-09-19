# Billing service

Owns capture. Consumes `order.confirmed` idempotently by `eventId`.
Does not import orders internals.

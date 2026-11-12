---
name: add-an-endpoint
description: Use when adding an HTTP route to a service.
---

Ask one question at a time. Write nothing before the answers.

1. Which service owns the route, and is the route public?
2. What input is accepted, and which acceptance id names the test?
3. Which config does the handler read?

After those answers:

1. Validate input at the edge. Read config from `config/env.js`.
2. Add the unit test named in acceptance.json.
3. Run `./verify.sh --turn` before finishing.

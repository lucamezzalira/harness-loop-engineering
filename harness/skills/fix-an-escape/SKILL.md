---
name: fix-an-escape
description: Use when a bug escaped the checks. Interview first, then a regression test, then the fix.
---

Reuse the qa role contract. The reproduction fails on the broken tree and passes once the fix is in.

Ask one question at a time. Write nothing before the answers.

1. What happened?
2. How do you reproduce it?
3. Which commit is known bad?

After those answers, and only then:

1. Add a regression test for the escape.
2. Run that test and confirm it fails.
3. Fix the cause.
4. Run that test and confirm it passes.
5. Add an `acceptance.json` entry `ESC-NN` whose test field is that file.

Do not skip the failing run.

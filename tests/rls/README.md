# RLS regression tests

Automated security regression suite that exercises the database's row-level
security policies against the real backend, using real HTTP clients:

- `anon.test.ts` — unauthenticated visitors: no reads, no writes, no
  security-definer function execution on any public table.
- `signup-trigger.test.ts` — the signup trigger provisions profile,
  organization (unique slug) and `super_admin` membership; new users can read
  their own rows.
- `authenticated.test.ts` — tenant isolation for org admins, student-scoped
  access (students, attendance, leaves, face embeddings) and audit-log rules
  (self-attribution only, admin-scoped reads, immutability).

Run with:

```bash
bun run test:rls
```

Requires `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` in the environment. The service key is used only to
create fixtures/confirmed test users and to assert stored state — every policy
assertion is made through an anon or real user session. All created auth users
are deleted in `afterAll`.

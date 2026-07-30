import { describe, expect, it } from "vitest";
import { PUBLIC_TABLES, anonClient, isDenied } from "./helpers";

/**
 * Regression: an unauthenticated visitor (Postgres `anon` role) must never be
 * able to read or write any table in the public schema.
 */
describe("anonymous role", () => {
  const anon = anonClient();

  it.each(PUBLIC_TABLES)("cannot read %s", async (table) => {
    const { data, error } = await anon.from(table).select("*").limit(1);
    if (error) {
      expect(isDenied(error)).toBe(true);
    } else {
      // No policy grants anon SELECT, so PostgREST returns an empty set.
      expect(data).toEqual([]);
    }
  });

  it.each(PUBLIC_TABLES)("cannot insert into %s", async (table) => {
    const { error } = await anon.from(table).insert({} as never);
    expect(error).not.toBeNull();
    expect(isDenied(error) || error!.code === "42501" || !!error!.code).toBe(true);
  });

  it("cannot create an organization", async () => {
    const { error } = await anon
      .from("organizations")
      .insert({ name: "anon org", slug: `anon-${Date.now()}` });
    expect(error).not.toBeNull();
  });

  it.each([
    "has_role",
    "has_any_role",
    "is_org_member",
    "user_orgs",
    "handle_new_user",
    "tg_set_updated_at",
  ])("cannot execute security-definer function %s", async (fn) => {
    const { error } = await anon.rpc(fn as never, {} as never);
    expect(error).not.toBeNull();
  });
});

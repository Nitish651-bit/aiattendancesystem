import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, cleanupTestUsers, createTestUser, type TestUser } from "./helpers";

/**
 * Regression: the `on_auth_user_created` trigger must provision a profile, a
 * personal organization and a super_admin membership for every new signup.
 */
describe("signup trigger", () => {
  let user: TestUser;
  const admin = adminClient();

  beforeAll(async () => {
    user = await createTestUser("signup");
  });
  afterAll(cleanupTestUsers);

  it("creates a profile row", async () => {
    const { data } = await admin.from("profiles").select("*").eq("id", user.id).single();
    expect(data?.id).toBe(user.id);
    expect(data?.full_name).toBeTruthy();
  });

  it("creates exactly one organization with a unique slug", async () => {
    const { data } = await admin
      .from("organizations")
      .select("*")
      .eq("id", user.orgId)
      .single();
    expect(data?.slug).toBeTruthy();

    const { count } = await admin
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("slug", data!.slug);
    expect(count).toBe(1);
  });

  it("grants the signup user super_admin on their own org", async () => {
    const { data } = await admin
      .from("memberships")
      .select("role, is_active")
      .eq("user_id", user.id)
      .eq("organization_id", user.orgId)
      .single();
    expect(data?.role).toBe("super_admin");
    expect(data?.is_active).toBe(true);
  });

  it("gives a second signup a separate organization", async () => {
    const other = await createTestUser("signup2");
    expect(other.orgId).not.toBe(user.orgId);
  });

  it("lets the new user read their own profile, org and membership", async () => {
    const profile = await user.client.from("profiles").select("*").eq("id", user.id);
    expect(profile.error).toBeNull();
    expect(profile.data).toHaveLength(1);

    const org = await user.client.from("organizations").select("*").eq("id", user.orgId);
    expect(org.data).toHaveLength(1);

    const membership = await user.client.from("memberships").select("*");
    expect(membership.data?.length).toBeGreaterThan(0);
  });
});

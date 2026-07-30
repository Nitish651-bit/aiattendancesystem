import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
export const ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const hasAdminAccess = Boolean(SUPABASE_URL && SERVICE_KEY);

const clientOpts = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

/** Client with no session at all — exercises the `anon` Postgres role. */
export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, clientOpts);
}

/** Service-role client. Bypasses RLS — only used for fixtures + assertions. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, clientOpts);
}

/** Client acting as a real signed-in user — exercises the `authenticated` role. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    ...clientOpts,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export type TestUser = {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  client: SupabaseClient;
  /** Organization auto-provisioned by the signup trigger. */
  orgId: string;
};

const createdUserIds: string[] = [];

/**
 * Creates a confirmed auth user through the admin API, which fires the
 * `on_auth_user_created` signup trigger, then signs in to obtain a real JWT.
 */
export async function createTestUser(prefix = "rls"): Promise<TestUser> {
  const admin = adminClient();
  const email = `${prefix}-${randomUUID()}@rls-test.local`;
  const password = `Pw-${randomUUID()}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `${prefix} tester` },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const id = data.user.id;
  createdUserIds.push(id);

  const signIn = await anonClient().auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session)
    throw new Error(`signIn failed: ${signIn.error?.message}`);
  const accessToken = signIn.data.session.access_token;

  const { data: memberships, error: mErr } = await admin
    .from("memberships")
    .select("organization_id")
    .eq("user_id", id);
  if (mErr) throw new Error(`membership lookup failed: ${mErr.message}`);
  if (!memberships?.length)
    throw new Error("signup trigger did not create a membership");

  return {
    id,
    email,
    password,
    accessToken,
    client: userClient(accessToken),
    orgId: memberships[0].organization_id as string,
  };
}

/** Deletes every auth user created by the suite (cascades to app rows). */
export async function cleanupTestUsers() {
  const admin = adminClient();
  for (const id of createdUserIds.splice(0)) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
}

/** True when the PostgREST error is an RLS / permission denial. */
export function isDenied(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "42501" ||
    error.code === "PGRST301" ||
    /row-level security|permission denied|JWT|Unauthorized/i.test(
      error.message ?? "",
    )
  );
}

export const PUBLIC_TABLES = [
  "organizations",
  "profiles",
  "memberships",
  "departments",
  "teachers",
  "students",
  "subjects",
  "enrollments",
  "timetables",
  "face_embeddings",
  "attendance_records",
  "leave_requests",
  "holidays",
  "audit_logs",
] as const;

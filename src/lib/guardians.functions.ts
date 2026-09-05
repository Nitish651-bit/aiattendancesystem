import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const linkSchema = z.object({
  organizationId: z.string().uuid(),
  studentId: z.string().uuid(),
  parentEmail: z.string().trim().email().max(255),
  parentName: z.string().trim().min(2).max(120),
  relationship: z.string().trim().min(2).max(40),
  password: z.string().min(8).max(128).optional(),
});

export type LinkGuardianInput = z.infer<typeof linkSchema>;

async function assertAdmin(
  supabase: { from: (t: string) => any },
  orgId: string,
  userId: string,
) {
  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((m: { role: string }) => m.role);
  if (!roles.includes("admin") && !roles.includes("super_admin")) {
    throw new Error("Forbidden: an admin role is required to manage parent access.");
  }
}

/**
 * Links a parent account to a student. Creates the parent's login when the email
 * has no account yet, so the parent can sign in and see only their child's data.
 */
export const linkGuardian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => linkSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.organizationId, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const email = data.parentEmail.toLowerCase();
    let parentUserId: string | null = null;
    let createdLogin = false;

    // Look for an existing account with this email.
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
    if (existing) {
      parentUserId = existing.id;
    } else if (data.password) {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: data.password,
        email_confirm: true,
        user_metadata: { full_name: data.parentName, is_parent: true },
      });
      if (error || !created?.user) throw new Error(error?.message ?? "Could not create the parent login.");
      parentUserId = created.user.id;
      createdLogin = true;
    }

    const { error: gErr } = await supabaseAdmin
      .from("guardians")
      .upsert(
        {
          organization_id: data.organizationId,
          student_id: data.studentId,
          parent_user_id: parentUserId,
          parent_email: email,
          relationship: data.relationship,
        },
        { onConflict: "student_id,parent_email" },
      );
    if (gErr) throw new Error(gErr.message);

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: data.organizationId,
      actor_id: context.userId,
      action: "guardian.link",
      entity: "guardian",
      entity_id: data.studentId,
      metadata: { parent_email: email, created_login: createdLogin },
    });

    return { parentUserId, createdLogin };
  });

const unlinkSchema = z.object({
  organizationId: z.string().uuid(),
  guardianId: z.string().uuid(),
});

export const unlinkGuardian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => unlinkSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, data.organizationId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("guardians")
      .delete()
      .eq("id", data.guardianId)
      .eq("organization_id", data.organizationId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: data.organizationId,
      actor_id: context.userId,
      action: "guardian.unlink",
      entity: "guardian",
      entity_id: data.guardianId,
      metadata: {},
    });
    return { ok: true };
  });

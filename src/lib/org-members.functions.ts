import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(["student", "teacher", "admin"]),
  code: z.string().trim().min(1).max(50),
  departmentId: z.string().uuid().nullable().optional(),
  section: z.string().trim().max(20).nullable().optional(),
  admissionYear: z.number().int().min(1900).max(2200).nullable().optional(),
  title: z.string().trim().max(60).nullable().optional(),
});

export type CreateOrgMemberInput = z.infer<typeof createSchema>;

/**
 * Creates a real auth user, adds them to the caller's organization with the requested
 * role, and creates the matching student/teacher record. Admin-only, verified server-side.
 */
export const createOrgMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: memberships, error: mErr } = await context.supabase
      .from("memberships")
      .select("role")
      .eq("organization_id", data.organizationId)
      .eq("user_id", context.userId)
      .eq("is_active", true);
    if (mErr) throw new Error(mErr.message);
    const roles = (memberships ?? []).map((m) => m.role as string);
    if (!roles.includes("admin") && !roles.includes("super_admin")) {
      throw new Error("Forbidden: an admin role is required to add members.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (cErr || !created?.user) {
      throw new Error(cErr?.message ?? "Could not create the user account.");
    }
    const newUserId = created.user.id;

    const { error: memErr } = await supabaseAdmin.from("memberships").insert({
      user_id: newUserId,
      organization_id: data.organizationId,
      role: data.role,
      is_active: true,
    });
    if (memErr) throw new Error(memErr.message);

    if (data.role === "student") {
      const { error } = await supabaseAdmin.from("students").insert({
        organization_id: data.organizationId,
        user_id: newUserId,
        department_id: data.departmentId ?? null,
        roll_number: data.code,
        section: data.section ?? null,
        admission_year: data.admissionYear ?? null,
      });
      if (error) throw new Error(error.message);
    } else if (data.role === "teacher") {
      const { error } = await supabaseAdmin.from("teachers").insert({
        organization_id: data.organizationId,
        user_id: newUserId,
        department_id: data.departmentId ?? null,
        employee_code: data.code,
        title: data.title ?? null,
      });
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: data.organizationId,
      actor_id: context.userId,
      action: "member.create",
      entity: data.role,
      entity_id: newUserId,
      metadata: { email: data.email, role: data.role, code: data.code },
    });

    return { userId: newUserId };
  });

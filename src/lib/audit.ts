import { supabase } from "@/integrations/supabase/client";

/**
 * Writes a real audit_logs row. actor_id must be the signed-in user (RLS enforces it).
 * Never throws — auditing must not break the primary operation, but failures are logged.
 */
export async function logAudit(input: {
  orgId: string;
  actorId: string;
  action: string;
  entity?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabase.from("audit_logs").insert({
    organization_id: input.orgId,
    actor_id: input.actorId,
    action: input.action,
    entity: input.entity ?? null,
    entity_id: input.entityId ?? null,
    metadata: (input.metadata ?? {}) as never,
  });
  if (error) console.error("[audit] failed to write log:", error.message);
}

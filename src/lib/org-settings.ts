import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OrgSettings {
  /** Minutes after a class starts before a check-in is recorded as "late". */
  late_after_minutes: number;
  /** Require the device location to be inside the class geofence (when the class defines one). */
  geofence_required: boolean;
  /** Block a second attendance record for the same student + session + day. */
  block_duplicates: boolean;
  /** Minimum face-match confidence (0-1) required before attendance is saved. */
  min_face_confidence: number;
  /** Require successful liveness signals before attendance is saved. */
  require_liveness: boolean;
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  late_after_minutes: 10,
  geofence_required: true,
  block_duplicates: true,
  min_face_confidence: 0.65,
  require_liveness: true,
};

export function parseOrgSettings(raw: unknown): OrgSettings {
  const s = (raw ?? {}) as Partial<OrgSettings>;
  return {
    late_after_minutes:
      typeof s.late_after_minutes === "number" ? s.late_after_minutes : DEFAULT_ORG_SETTINGS.late_after_minutes,
    geofence_required:
      typeof s.geofence_required === "boolean" ? s.geofence_required : DEFAULT_ORG_SETTINGS.geofence_required,
    block_duplicates:
      typeof s.block_duplicates === "boolean" ? s.block_duplicates : DEFAULT_ORG_SETTINGS.block_duplicates,
    min_face_confidence:
      typeof s.min_face_confidence === "number" ? s.min_face_confidence : DEFAULT_ORG_SETTINGS.min_face_confidence,
    require_liveness:
      typeof s.require_liveness === "boolean" ? s.require_liveness : DEFAULT_ORG_SETTINGS.require_liveness,
  };
}

export function useOrgSettings(orgId: string) {
  return useQuery({
    queryKey: ["org-settings", orgId],
    queryFn: async (): Promise<{ settings: OrgSettings; name: string; timezone: string }> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("name, timezone, settings")
        .eq("id", orgId)
        .single();
      if (error) throw error;
      return {
        settings: parseOrgSettings(data.settings),
        name: data.name,
        timezone: data.timezone,
      };
    },
  });
}

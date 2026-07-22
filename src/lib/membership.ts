import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "super_admin" | "admin" | "teacher" | "student";

export interface Membership {
  id: string;
  organization_id: string;
  role: AppRole;
  is_active: boolean;
  organization: {
    id: string;
    name: string;
    slug: string;
    type: string;
    logo_url: string | null;
  };
}

const ROLE_RANK: Record<AppRole, number> = {
  super_admin: 4,
  admin: 3,
  teacher: 2,
  student: 1,
};

export function highestRole(memberships: Membership[]): AppRole | null {
  if (memberships.length === 0) return null;
  return memberships.reduce((best, m) =>
    ROLE_RANK[m.role] > ROLE_RANK[best.role] ? m : best,
  ).role;
}

export function useMemberships(userId: string | undefined) {
  return useQuery({
    queryKey: ["memberships", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Membership[]> => {
      const { data, error } = await supabase
        .from("memberships")
        .select(
          "id, organization_id, role, is_active, organization:organizations(id, name, slug, type, logo_url)",
        )
        .eq("is_active", true)
        .order("role", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Membership[];
    },
  });
}

export function useActiveOrg(memberships: Membership[] | undefined) {
  const stored =
    typeof window !== "undefined" ? window.localStorage.getItem("active_org") : null;
  if (!memberships || memberships.length === 0) return null;
  return memberships.find((m) => m.organization_id === stored) ?? memberships[0];
}

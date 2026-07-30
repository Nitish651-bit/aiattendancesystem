-- 1. Remove the unrestricted "WITH CHECK (true)" org creation policy.
-- Organizations are provisioned only by the SECURITY DEFINER signup trigger.
DROP POLICY IF EXISTS "authenticated create orgs" ON public.organizations;

-- 2. Lock down SECURITY DEFINER functions.
-- Trigger-only functions never need direct API execution.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;

-- Role helpers are used inside RLS policies for signed-in users only.
REVOKE ALL ON FUNCTION public.has_role(uuid, uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_any_role(uuid, uuid, public.app_role[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_org_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_orgs(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, uuid, public.app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_orgs(uuid) TO authenticated;
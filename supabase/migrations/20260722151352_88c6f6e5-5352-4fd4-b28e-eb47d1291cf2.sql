
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, uuid, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, uuid, public.app_role[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.user_orgs(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, uuid, public.app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_orgs(uuid) TO authenticated;

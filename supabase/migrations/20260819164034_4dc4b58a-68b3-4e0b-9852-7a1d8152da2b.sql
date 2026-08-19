CREATE OR REPLACE FUNCTION public.can_view_profile(_viewer uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.memberships v ON v.organization_id = m.organization_id
    WHERE m.user_id = _target AND m.is_active
      AND v.user_id = _viewer AND v.is_active
      AND v.role IN ('teacher','admin','super_admin')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_view_profile(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "staff read org member profiles" ON public.profiles;
CREATE POLICY "staff read org member profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.can_view_profile(auth.uid(), id));
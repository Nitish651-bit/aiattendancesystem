CREATE TABLE public.guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  parent_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_email text NOT NULL,
  relationship text NOT NULL DEFAULT 'guardian',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, parent_email)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guardians TO authenticated;
GRANT ALL ON public.guardians TO service_role;
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guardians_select_parent" ON public.guardians
  FOR SELECT TO authenticated
  USING (parent_user_id = auth.uid());

CREATE POLICY "guardians_select_staff" ON public.guardians
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['teacher','admin','super_admin']::app_role[]));

CREATE POLICY "guardians_write_staff" ON public.guardians
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::app_role[]));

CREATE TRIGGER trg_guardians_updated BEFORE UPDATE ON public.guardians
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_guardians_parent ON public.guardians(parent_user_id);
CREATE INDEX idx_guardians_student ON public.guardians(student_id);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  kind text NOT NULL DEFAULT 'info',
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX idx_notifications_user ON public.notifications(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.tg_notify_guardians_on_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s_name text;
  subj text;
BEGIN
  SELECT p.full_name INTO s_name
  FROM public.students st JOIN public.profiles p ON p.id = st.user_id
  WHERE st.id = NEW.student_id;

  SELECT name INTO subj FROM public.subjects WHERE id = NEW.subject_id;

  INSERT INTO public.notifications (organization_id, user_id, title, body, kind, link)
  SELECT NEW.organization_id, g.parent_user_id,
         COALESCE(s_name, 'Your child') || ' marked ' || NEW.status::text,
         COALESCE(subj, 'Session') || ' on ' || to_char(NEW.session_date, 'DD Mon YYYY'),
         'attendance', '/parent'
  FROM public.guardians g
  WHERE g.student_id = NEW.student_id AND g.parent_user_id IS NOT NULL;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_attendance_notify_guardians
AFTER INSERT ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_guardians_on_attendance();

ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
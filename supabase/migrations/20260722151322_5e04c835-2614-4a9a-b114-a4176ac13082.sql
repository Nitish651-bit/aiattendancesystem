
-- =============== ENUMS ===============
CREATE TYPE public.app_role AS ENUM ('super_admin','admin','teacher','student');
CREATE TYPE public.org_type AS ENUM ('school','college','company');
CREATE TYPE public.attendance_status AS ENUM ('present','absent','late','excused');
CREATE TYPE public.leave_status AS ENUM ('pending','approved','rejected','cancelled');
CREATE TYPE public.weekday AS ENUM ('mon','tue','wed','thu','fri','sat','sun');

-- =============== ORGANIZATIONS ===============
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  type public.org_type NOT NULL DEFAULT 'college',
  plan text NOT NULL DEFAULT 'free',
  logo_url text,
  timezone text NOT NULL DEFAULT 'UTC',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- =============== PROFILES ===============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  avatar_url text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- =============== MEMBERSHIPS (user <-> org + role) ===============
CREATE TABLE public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id, role)
);
CREATE INDEX idx_memberships_user ON public.memberships(user_id);
CREATE INDEX idx_memberships_org ON public.memberships(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships TO authenticated;
GRANT ALL ON public.memberships TO service_role;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- =============== SECURITY DEFINER HELPERS ===============
CREATE OR REPLACE FUNCTION public.has_role(_user uuid, _org uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = _user AND organization_id = _org AND role = _role AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user uuid, _org uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = _user AND organization_id = _org AND role = ANY(_roles) AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_user uuid, _org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = _user AND organization_id = _org AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.user_orgs(_user uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT organization_id FROM public.memberships WHERE user_id = _user AND is_active;
$$;

-- =============== UPDATED_AT TRIGGER ===============
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_orgs_updated BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =============== AUTO CREATE PROFILE + ORG ON SIGNUP ===============
-- New user gets a personal org where they are super_admin (multi-tenant SaaS onboarding).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_org_id uuid;
  base_slug text;
  final_slug text;
  counter int := 0;
  display_name text;
BEGIN
  display_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email,'@',1)
  );

  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (NEW.id, display_name, NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;

  base_slug := lower(regexp_replace(split_part(NEW.email,'@',1),'[^a-z0-9]+','-','g'));
  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM public.organizations WHERE slug = final_slug) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter::text;
  END LOOP;

  INSERT INTO public.organizations (name, slug, type)
  VALUES (display_name || '''s Organization', final_slug, 'college')
  RETURNING id INTO new_org_id;

  INSERT INTO public.memberships (user_id, organization_id, role)
  VALUES (NEW.id, new_org_id, 'super_admin');

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============== RLS: organizations ===============
CREATE POLICY "org members read own org" ON public.organizations
  FOR SELECT TO authenticated USING (public.is_org_member(auth.uid(), id));
CREATE POLICY "super_admins update own org" ON public.organizations
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), id, 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), id, 'super_admin'));
CREATE POLICY "authenticated create orgs" ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (true);

-- =============== RLS: profiles ===============
CREATE POLICY "users read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "users insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- =============== RLS: memberships ===============
CREATE POLICY "user reads own memberships" ON public.memberships
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admins read org memberships" ON public.memberships
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]));
CREATE POLICY "admins manage org memberships" ON public.memberships
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]));

-- =============== DEPARTMENTS ===============
CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (organization_id, code)
);
CREATE INDEX idx_departments_org ON public.departments(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read departments" ON public.departments FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "admins write departments" ON public.departments FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]));

-- =============== TEACHERS ===============
CREATE TABLE public.teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  employee_code text NOT NULL,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (organization_id, employee_code),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX idx_teachers_org ON public.teachers(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teachers TO authenticated;
GRANT ALL ON public.teachers TO service_role;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read teachers" ON public.teachers FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "admins write teachers" ON public.teachers FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]));

-- =============== STUDENTS ===============
CREATE TABLE public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  roll_number text NOT NULL,
  admission_year int,
  section text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (organization_id, roll_number),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX idx_students_org ON public.students(organization_id);
CREATE INDEX idx_students_dept ON public.students(department_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO authenticated;
GRANT ALL ON public.students TO service_role;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student read self" ON public.students FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "staff read students" ON public.students FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['teacher','admin','super_admin']::public.app_role[]));
CREATE POLICY "admins write students" ON public.students FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]));

-- =============== SUBJECTS ===============
CREATE TABLE public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  name text NOT NULL,
  code text NOT NULL,
  credits int NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (organization_id, code)
);
CREATE INDEX idx_subjects_org ON public.subjects(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subjects TO authenticated;
GRANT ALL ON public.subjects TO service_role;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read subjects" ON public.subjects FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "admins write subjects" ON public.subjects FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]));

-- =============== ENROLLMENTS ===============
CREATE TABLE public.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  academic_term text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, subject_id, academic_term)
);
CREATE INDEX idx_enrollments_student ON public.enrollments(student_id);
CREATE INDEX idx_enrollments_subject ON public.enrollments(subject_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enrollments TO authenticated;
GRANT ALL ON public.enrollments TO service_role;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student reads own enrollments" ON public.enrollments FOR SELECT TO authenticated
  USING (student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid()));
CREATE POLICY "staff read enrollments" ON public.enrollments FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['teacher','admin','super_admin']::public.app_role[]));
CREATE POLICY "admins write enrollments" ON public.enrollments FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]));

-- =============== TIMETABLES ===============
CREATE TABLE public.timetables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  teacher_id uuid REFERENCES public.teachers(id) ON DELETE SET NULL,
  day_of_week public.weekday NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  room text,
  latitude numeric,
  longitude numeric,
  radius_meters int DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (end_time > start_time)
);
CREATE INDEX idx_timetables_org_day ON public.timetables(organization_id, day_of_week);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.timetables TO authenticated;
GRANT ALL ON public.timetables TO service_role;
ALTER TABLE public.timetables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read timetables" ON public.timetables FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "admins write timetables" ON public.timetables FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]));

-- =============== FACE EMBEDDINGS ===============
CREATE TABLE public.face_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  embedding jsonb NOT NULL, -- 128-D float array (face-api.js descriptor)
  quality_score numeric,
  model text NOT NULL DEFAULT 'face-api-v1',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_face_embeddings_user ON public.face_embeddings(user_id);
CREATE INDEX idx_face_embeddings_org ON public.face_embeddings(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.face_embeddings TO authenticated;
GRANT ALL ON public.face_embeddings TO service_role;
ALTER TABLE public.face_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own embeddings" ON public.face_embeddings FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "user inserts own embeddings" ON public.face_embeddings FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "user deletes own embeddings" ON public.face_embeddings FOR DELETE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "admins read org embeddings" ON public.face_embeddings FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]));
CREATE POLICY "admins manage org embeddings" ON public.face_embeddings FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]));

-- =============== ATTENDANCE RECORDS ===============
CREATE TABLE public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  timetable_id uuid REFERENCES public.timetables(id) ON DELETE SET NULL,
  session_date date NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  status public.attendance_status NOT NULL DEFAULT 'present',
  face_confidence numeric,
  liveness_score numeric,
  ip_address text,
  user_agent text,
  device_fingerprint text,
  latitude numeric,
  longitude numeric,
  marked_by uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, subject_id, session_date)
);
CREATE INDEX idx_attendance_org_date ON public.attendance_records(organization_id, session_date);
CREATE INDEX idx_attendance_student ON public.attendance_records(student_id);
CREATE INDEX idx_attendance_subject_date ON public.attendance_records(subject_id, session_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_records TO authenticated;
GRANT ALL ON public.attendance_records TO service_role;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student reads own attendance" ON public.attendance_records FOR SELECT TO authenticated
  USING (student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid()));
CREATE POLICY "student inserts own attendance" ON public.attendance_records FOR INSERT TO authenticated
  WITH CHECK (student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid()));
CREATE POLICY "staff read attendance" ON public.attendance_records FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['teacher','admin','super_admin']::public.app_role[]));
CREATE POLICY "staff manage attendance" ON public.attendance_records FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['teacher','admin','super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), organization_id, ARRAY['teacher','admin','super_admin']::public.app_role[]));

-- =============== LEAVE REQUESTS ===============
CREATE TABLE public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  from_date date NOT NULL,
  to_date date NOT NULL,
  reason text NOT NULL,
  status public.leave_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);
CREATE INDEX idx_leaves_student ON public.leave_requests(student_id);
CREATE INDEX idx_leaves_org_status ON public.leave_requests(organization_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_requests TO authenticated;
GRANT ALL ON public.leave_requests TO service_role;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student own leaves" ON public.leave_requests FOR SELECT TO authenticated
  USING (student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid()));
CREATE POLICY "student create leave" ON public.leave_requests FOR INSERT TO authenticated
  WITH CHECK (student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid()));
CREATE POLICY "student cancel own leave" ON public.leave_requests FOR UPDATE TO authenticated
  USING (student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid()))
  WITH CHECK (student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid()));
CREATE POLICY "staff read leaves" ON public.leave_requests FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['teacher','admin','super_admin']::public.app_role[]));
CREATE POLICY "staff manage leaves" ON public.leave_requests FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['teacher','admin','super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), organization_id, ARRAY['teacher','admin','super_admin']::public.app_role[]));

-- =============== HOLIDAYS ===============
CREATE TABLE public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  holiday_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, holiday_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays TO authenticated;
GRANT ALL ON public.holidays TO service_role;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read holidays" ON public.holidays FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "admins write holidays" ON public.holidays FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]));

-- =============== AUDIT LOGS ===============
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  entity text,
  entity_id uuid,
  metadata jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_org_created ON public.audit_logs(organization_id, created_at DESC);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "actor inserts own log" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());
CREATE POLICY "admins read audit" ON public.audit_logs FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.has_any_role(auth.uid(), organization_id, ARRAY['admin','super_admin']::public.app_role[]));

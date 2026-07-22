import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  GraduationCap,
  CalendarCheck,
  TrendingUp,
  Camera,
  Building2,
  ClipboardList,
  ScanFace,
} from "lucide-react";
import { format } from "date-fns";

import { AuthedLayout } from "@/components/authed-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/membership";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Sentinel AI" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <AuthedLayout>
      {({ role, orgId, userId }) => <DashboardBody role={role} orgId={orgId} userId={userId} />}
    </AuthedLayout>
  );
}

function DashboardBody({ role, orgId, userId }: { role: AppRole; orgId: string; userId: string }) {
  if (role === "student") return <StudentDashboard userId={userId} orgId={orgId} />;
  if (role === "teacher") return <TeacherDashboard userId={userId} orgId={orgId} />;
  return <AdminDashboard orgId={orgId} role={role} />;
}

/* ------------------------------------------------------------------ */
/* ADMIN / SUPER ADMIN                                                */
/* ------------------------------------------------------------------ */

function AdminDashboard({ orgId, role }: { orgId: string; role: AppRole }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-stats", orgId],
    queryFn: async () => {
      const [students, teachers, subjects, todayAttendance, pendingLeaves] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null),
        supabase.from("teachers").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null),
        supabase.from("subjects").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null),
        supabase.from("attendance_records").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("session_date", format(new Date(), "yyyy-MM-dd")),
        supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "pending"),
      ]);
      return {
        students: students.count ?? 0,
        teachers: teachers.count ?? 0,
        subjects: subjects.count ?? 0,
        todayAttendance: todayAttendance.count ?? 0,
        pendingLeaves: pendingLeaves.count ?? 0,
      };
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title={role === "super_admin" ? "Super Admin dashboard" : "Admin dashboard"}
        subtitle="Real-time overview of your organization's attendance operations."
      />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={GraduationCap} label="Students" value={data?.students} loading={isLoading} />
        <StatCard icon={Users} label="Teachers" value={data?.teachers} loading={isLoading} />
        <StatCard icon={Building2} label="Subjects" value={data?.subjects} loading={isLoading} />
        <StatCard icon={CalendarCheck} label="Today's marks" value={data?.todayAttendance} loading={isLoading} />
        <StatCard icon={ClipboardList} label="Pending leaves" value={data?.pendingLeaves} loading={isLoading} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <QuickActionCard
          icon={GraduationCap}
          title="Add students"
          body="Create student records and invite them to enroll their faces."
          href="/students"
        />
        <QuickActionCard
          icon={Users}
          title="Add teachers"
          body="Add teaching staff and assign departments and subjects."
          href="/teachers"
        />
        <QuickActionCard
          icon={CalendarCheck}
          title="Publish timetable"
          body="Configure weekly classes so attendance can auto-mark by schedule."
          href="/timetable"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TEACHER                                                             */
/* ------------------------------------------------------------------ */

function TeacherDashboard({ userId, orgId }: { userId: string; orgId: string }) {
  const { data } = useQuery({
    queryKey: ["teacher-stats", userId, orgId],
    queryFn: async () => {
      const { data: teacher } = await supabase
        .from("teachers")
        .select("id")
        .eq("user_id", userId)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (!teacher) return { classesToday: 0, pendingLeaves: 0 };
      const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
      const day = days[new Date().getDay()];
      const [classesToday, pendingLeaves] = await Promise.all([
        supabase
          .from("timetables")
          .select("id", { count: "exact", head: true })
          .eq("teacher_id", teacher.id)
          .eq("day_of_week", day),
        supabase
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "pending"),
      ]);
      return { classesToday: classesToday.count ?? 0, pendingLeaves: pendingLeaves.count ?? 0 };
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader title="Teacher dashboard" subtitle="Your classes and pending items." />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard icon={CalendarCheck} label="Classes today" value={data?.classesToday} />
        <StatCard icon={ClipboardList} label="Pending leaves" value={data?.pendingLeaves} />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <QuickActionCard
          icon={Camera}
          title="Take attendance"
          body="Open the live camera and mark attendance for the current class."
          href="/attendance"
        />
        <QuickActionCard
          icon={ClipboardList}
          title="Review leaves"
          body="Approve or reject student leave requests."
          href="/leaves"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* STUDENT                                                             */
/* ------------------------------------------------------------------ */

function StudentDashboard({ userId, orgId }: { userId: string; orgId: string }) {
  const { data } = useQuery({
    queryKey: ["student-stats", userId, orgId],
    queryFn: async () => {
      const { data: student } = await supabase
        .from("students")
        .select("id")
        .eq("user_id", userId)
        .eq("organization_id", orgId)
        .maybeSingle();

      const { count: faceCount } = await supabase
        .from("face_embeddings")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

      if (!student) {
        return { present: 0, total: 0, percentage: 0, hasFace: (faceCount ?? 0) > 0, hasProfile: false };
      }
      const [present, total] = await Promise.all([
        supabase
          .from("attendance_records")
          .select("id", { count: "exact", head: true })
          .eq("student_id", student.id)
          .eq("status", "present"),
        supabase
          .from("attendance_records")
          .select("id", { count: "exact", head: true })
          .eq("student_id", student.id),
      ]);
      const p = present.count ?? 0;
      const t = total.count ?? 0;
      return {
        present: p,
        total: t,
        percentage: t === 0 ? 0 : Math.round((p / t) * 100),
        hasFace: (faceCount ?? 0) > 0,
        hasProfile: true,
      };
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Your dashboard"
        subtitle="Your attendance, at a glance."
      />

      {data && !data.hasFace && (
        <Card className="border-warning/40 bg-warning/5">
          <CardHeader className="flex flex-row items-center gap-3">
            <ScanFace className="h-5 w-5 text-warning" />
            <div>
              <CardTitle className="text-base">Enroll your face to start</CardTitle>
              <CardDescription>
                You need to register your face before you can mark attendance.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={TrendingUp} label="Attendance %" value={`${data?.percentage ?? 0}%`} />
        <StatCard icon={CalendarCheck} label="Present" value={data?.present} />
        <StatCard icon={ClipboardList} label="Total sessions" value={data?.total} />
        <StatCard
          icon={ScanFace}
          label="Face enrolled"
          value={data?.hasFace ? "Yes" : "No"}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <QuickActionCard
          icon={Camera}
          title="Mark attendance"
          body="Verify your face and mark yourself present for the current class."
          href="/attendance"
        />
        <QuickActionCard
          icon={ScanFace}
          title="Enroll / re-enroll face"
          body="Update the face template used for attendance verification."
          href="/face-enroll"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SHARED                                                              */
/* ------------------------------------------------------------------ */

function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: typeof Users;
  label: string;
  value: number | string | undefined;
  loading?: boolean;
}) {
  return (
    <Card className="shadow-card">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-3 text-3xl font-bold tracking-tight">
          {loading ? "—" : (value ?? 0)}
        </div>
      </CardContent>
    </Card>
  );
}

function QuickActionCard({
  icon: Icon,
  title,
  body,
  href,
}: {
  icon: typeof Users;
  title: string;
  body: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="group block rounded-2xl border border-border bg-card p-6 shadow-card transition-all hover:shadow-glow"
    >
      <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </a>
  );
}

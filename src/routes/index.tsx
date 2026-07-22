import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ScanFace,
  ShieldCheck,
  Clock,
  BarChart3,
  Users,
  Building2,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sentinel AI — Enterprise Face Attendance for Schools & Companies" },
      {
        name: "description",
        content:
          "Multi-tenant AI face attendance with liveness detection, timetable-aware auto-marking, and role-based dashboards for students, teachers, and admins.",
      },
      {
        property: "og:title",
        content: "Sentinel AI — Enterprise Face Attendance for Schools & Companies",
      },
      {
        property: "og:description",
        content:
          "Multi-tenant AI face attendance with liveness detection, timetable-aware auto-marking, and role-based dashboards for students, teachers, and admins.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <Hero />
      <Features />
      <ForWho />
      <CTA />
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-brand shadow-glow">
            <ScanFace className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold tracking-tight">Sentinel AI</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#for-who" className="hover:text-foreground">For</a>
          <a href="#cta" className="hover:text-foreground">Pricing</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/auth">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link to="/auth" search={{ mode: "signup" }}>
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,oklch(0.72_0.16_258/0.18),transparent_70%)]"
      />
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="secondary" className="mb-6 gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            AI + Liveness + Enterprise RBAC
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-6xl">
            Face attendance,{" "}
            <span className="text-gradient-brand">done right.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Sentinel AI marks attendance from a face in under a second — with real
            liveness checks, timetable awareness, geofence validation, and audit-grade
            reporting. Built for schools, colleges, and companies.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link to="/auth" search={{ mode: "signup" }}>
              <Button size="lg" className="gap-2">
                Start free
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/auth">
              <Button size="lg" variant="outline">
                Sign in
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            No credit card. Includes a personal organization on signup.
          </p>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: ScanFace,
    title: "Real face recognition",
    body: "128-D embeddings from webcam frames, cosine matched against enrolled faces. Rejects unknown faces.",
  },
  {
    icon: ShieldCheck,
    title: "Liveness & anti-spoof",
    body: "Blink detection, head-pose variance, and confidence thresholds reject printed photos and replays.",
  },
  {
    icon: Clock,
    title: "Timetable-aware",
    body: "Attendance auto-maps to the current class window, teacher, room, and geofence.",
  },
  {
    icon: BarChart3,
    title: "Reports & analytics",
    body: "Daily, weekly, monthly, and yearly reports. Export to CSV, Excel, and PDF.",
  },
  {
    icon: Users,
    title: "RBAC dashboards",
    body: "Distinct views for Student, Teacher, Admin, and Super Admin — all backed by row-level security.",
  },
  {
    icon: Building2,
    title: "Multi-tenant SaaS",
    body: "One deployment, unlimited organizations. Full data isolation via Postgres RLS.",
  },
];

function Features() {
  return (
    <section id="features" className="border-t border-border/60 bg-muted/30 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Everything an enterprise attendance system needs
          </h2>
          <p className="mt-4 text-muted-foreground">
            Not a demo. Every button, every query, every report actually works.
          </p>
        </div>
        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group relative rounded-2xl border border-border bg-card p-6 shadow-card transition-all hover:shadow-glow"
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ForWho() {
  const items = [
    { title: "Schools", body: "K-12 attendance with parent-friendly reports." },
    { title: "Colleges", body: "Timetable-driven, per-subject attendance percentages." },
    { title: "Companies", body: "Employee check-in with geofence and IP audit trails." },
  ];
  return (
    <section id="for-who" className="py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {items.map((it) => (
            <div
              key={it.title}
              className="rounded-2xl border border-border bg-card p-8 shadow-card"
            >
              <h3 className="text-2xl font-bold">{it.title}</h3>
              <p className="mt-3 text-muted-foreground">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section id="cta" className="border-t border-border/60 py-24">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
          Ready to modernize attendance?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Create your organization in seconds. Invite teachers and students. Enroll
          faces. Start marking.
        </p>
        <div className="mt-8">
          <Link to="/auth" search={{ mode: "signup" }}>
            <Button size="lg" className="gap-2">
              Create your organization
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60 py-10 text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 md:flex-row">
        <div className="flex items-center gap-2">
          <ScanFace className="h-4 w-4" />
          <span>Sentinel AI — Enterprise Face Attendance</span>
        </div>
        <span>© {new Date().getFullYear()} Sentinel AI</span>
      </div>
    </footer>
  );
}

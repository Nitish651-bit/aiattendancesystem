import { type ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  ScanFace,
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  Calendar,
  CalendarCheck,
  FileBarChart,
  UserCog,
  LogOut,
  Menu,
  Building2,
  Camera,
  ClipboardList,
  Bell,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppRole, Membership } from "@/lib/membership";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: AppRole[];
}

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, roles: ["super_admin", "admin", "teacher", "student"] },
  { to: "/attendance", label: "Mark attendance", icon: Camera, roles: ["student", "teacher"] },
  { to: "/face-enroll", label: "Enroll face", icon: ScanFace, roles: ["student", "teacher", "admin", "super_admin"] },
  { to: "/timetable", label: "Timetable", icon: Calendar, roles: ["super_admin", "admin", "teacher", "student"] },
  { to: "/leaves", label: "Leaves", icon: ClipboardList, roles: ["super_admin", "admin", "teacher", "student"] },
  { to: "/students", label: "Students", icon: GraduationCap, roles: ["admin", "super_admin", "teacher"] },
  { to: "/teachers", label: "Teachers", icon: Users, roles: ["admin", "super_admin"] },
  { to: "/departments", label: "Departments", icon: Building2, roles: ["admin", "super_admin"] },
  { to: "/subjects", label: "Subjects", icon: BookOpen, roles: ["admin", "super_admin"] },
  { to: "/holidays", label: "Holidays", icon: CalendarCheck, roles: ["admin", "super_admin"] },
  { to: "/reports", label: "Reports", icon: FileBarChart, roles: ["admin", "super_admin", "teacher"] },
  { to: "/audit", label: "Audit log", icon: Bell, roles: ["admin", "super_admin"] },
  { to: "/settings", label: "Settings", icon: UserCog, roles: ["super_admin", "admin", "teacher", "student"] },
];

interface AppShellProps {
  children: ReactNode;
  role: AppRole;
  activeMembership: Membership;
  memberships: Membership[];
  userName: string;
  userEmail: string;
}

export function AppShell({
  children,
  role,
  activeMembership,
  memberships,
  userName,
  userEmail,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  const nav = NAV.filter((n) => n.roles.includes(role));

  return (
    <div className="min-h-screen bg-background">
      <div className="lg:grid lg:grid-cols-[260px_1fr]">
        <aside className="hidden border-r border-sidebar-border bg-sidebar lg:block">
          <SidebarContent nav={nav} activeMembership={activeMembership} role={role} />
        </aside>

        <div className="flex min-h-screen flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-xl md:px-6">
            <div className="flex items-center gap-3">
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="lg:hidden">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[260px] p-0 bg-sidebar">
                  <SidebarContent
                    nav={nav}
                    activeMembership={activeMembership}
                    role={role}
                    onNavigate={() => setOpen(false)}
                  />
                </SheetContent>
              </Sheet>
              <div className="flex items-center gap-2 lg:hidden">
                <ScanFace className="h-5 w-5 text-primary" />
                <span className="font-bold">Sentinel AI</span>
              </div>
            </div>

            <UserMenu
              userName={userName}
              userEmail={userEmail}
              memberships={memberships}
              activeMembership={activeMembership}
              role={role}
            />
          </header>

          <main className="flex-1 p-4 md:p-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

function SidebarContent({
  nav,
  activeMembership,
  role,
  onNavigate,
}: {
  nav: NavItem[];
  activeMembership: Membership;
  role: AppRole;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand">
          <ScanFace className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-bold tracking-tight text-sidebar-foreground">Sentinel AI</span>
      </div>

      <div className="border-b border-sidebar-border px-4 py-4">
        <div className="text-xs font-medium uppercase tracking-wider text-sidebar-foreground/60">
          Organization
        </div>
        <div className="mt-1 truncate text-sm font-semibold text-sidebar-foreground">
          {activeMembership.organization.name}
        </div>
        <Badge variant="secondary" className="mt-2 capitalize">
          {role.replace("_", " ")}
        </Badge>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {nav.map((n) => {
          const active = location.pathname === n.to || location.pathname.startsWith(n.to + "/");
          return (
            <Link
              key={n.to}
              to={n.to}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function UserMenu({
  userName,
  userEmail,
  memberships,
  activeMembership,
  role,
}: {
  userName: string;
  userEmail: string;
  memberships: Membership[];
  activeMembership: Membership;
  role: AppRole;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  function switchOrg(orgId: string) {
    window.localStorage.setItem("active_org", orgId);
    window.location.reload();
  }

  const initials = userName
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 pl-2 pr-3">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
              {initials || "U"}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium md:inline">{userName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div className="font-semibold">{userName}</div>
          <div className="text-xs font-normal text-muted-foreground">{userEmail}</div>
          <Badge variant="secondary" className="mt-2 capitalize">
            {role.replace("_", " ")} · {activeMembership.organization.name}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.length > 1 && (
          <>
            <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
              Switch organization
            </DropdownMenuLabel>
            {memberships.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onClick={() => switchOrg(m.organization_id)}
                className={cn(
                  m.organization_id === activeMembership.organization_id &&
                    "bg-accent/50 font-medium",
                )}
              >
                <Building2 className="mr-2 h-4 w-4" />
                <span className="flex-1 truncate">{m.organization.name}</span>
                <span className="ml-2 text-xs capitalize text-muted-foreground">
                  {m.role.replace("_", " ")}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

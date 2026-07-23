import { type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { useSession } from "@/lib/session";
import { useMemberships, useActiveOrg, highestRole, type AppRole } from "@/lib/membership";
import { AppShell } from "@/components/app-shell";

interface Props {
  children: (ctx: { role: AppRole; orgId: string; userId: string }) => ReactNode;
  requireRoles?: AppRole[];
}

export function AuthedLayout({ children, requireRoles }: Props) {
  const { user, loading } = useSession();
  const { data: memberships, isLoading: mLoading, error: mError } = useMemberships(user?.id);
  const active = useActiveOrg(memberships);

  if (loading || (user && mLoading)) return <FullScreenLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  if (mError) return <ErrorScreen title="Couldn't load your workspace" message={mError.message} />;
  if (!memberships || memberships.length === 0 || !active) {
    return <NoOrgScreen />;
  }
  const role = highestRole(memberships.filter((m) => m.organization_id === active.organization_id))!;
  if (requireRoles && !requireRoles.includes(role)) {
    return <ForbiddenScreen role={role} />;
  }

  const userName =
    (user.user_metadata?.full_name as string) ||
    (user.user_metadata?.name as string) ||
    user.email?.split("@")[0] ||
    "User";

  return (
    <AppShell
      role={role}
      activeMembership={active}
      memberships={memberships}
      userName={userName}
      userEmail={user.email ?? ""}
    >
      {children({ role, orgId: active.organization_id, userId: user.id })}
    </AppShell>
  );
}

function FullScreenLoader() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function NoOrgScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">No organization yet</h1>
        <p className="mt-2 text-muted-foreground">
          Your account has no active organization membership. Contact your administrator
          or sign out and register a new account.
        </p>
      </div>
    </div>
  );
}

function ForbiddenScreen({ role }: { role: AppRole }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">Access restricted</h1>
        <p className="mt-2 text-muted-foreground">
          Your role ({role}) doesn't have access to this page.
        </p>
      </div>
    </div>
  );
}

function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6">
      <div className="max-w-lg text-center">
        <h1 className="text-2xl font-bold text-destructive">{title}</h1>
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

import { Sparkles } from "lucide-react";
import { AuthedLayout } from "@/components/authed-layout";
import type { AppRole } from "@/lib/membership";

export function ComingSoonPage({
  title,
  description,
  requireRoles,
}: {
  title: string;
  description: string;
  requireRoles?: AppRole[];
}) {
  return (
    <AuthedLayout requireRoles={requireRoles}>
      {() => (
        <div className="mx-auto max-w-2xl py-16 text-center">
          <div className="mx-auto mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-3 text-muted-foreground">{description}</p>
          <p className="mt-6 text-xs uppercase tracking-widest text-muted-foreground">
            Rolling out in the next phase
          </p>
        </div>
      )}
    </AuthedLayout>
  );
}

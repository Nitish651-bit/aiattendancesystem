import type { ReactNode } from "react";
import { Loader2, AlertTriangle, Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-10 text-sm text-muted-foreground"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorState({
  label = "Something went wrong.",
  error,
  onRetry,
}: {
  label?: string;
  error?: unknown;
  onRetry?: () => void;
}) {
  const message = error instanceof Error ? error.message : undefined;
  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/40 bg-destructive/5 p-8 text-center"
    >
      <AlertTriangle className="mx-auto h-5 w-5 text-destructive" aria-hidden />
      <p className="mt-3 font-medium text-destructive">{label}</p>
      {message && <p className="mt-1 text-sm text-muted-foreground">{message}</p>}
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  label,
  hint,
  action,
}: {
  label: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
      <Inbox className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
      <p className="mt-3 font-medium">{label}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Renders the right state for a react-query result, or the children when data exists. */
export function QueryState<T>({
  query,
  emptyLabel,
  emptyHint,
  emptyAction,
  loadingLabel,
  children,
}: {
  query: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    data: T[] | undefined;
    refetch: () => void;
  };
  emptyLabel: string;
  emptyHint?: string;
  emptyAction?: ReactNode;
  loadingLabel?: string;
  children: (rows: T[]) => ReactNode;
}) {
  if (query.isLoading) return <LoadingState label={loadingLabel} />;
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const rows = query.data ?? [];
  if (rows.length === 0)
    return <EmptyState label={emptyLabel} hint={emptyHint} action={emptyAction} />;
  return <>{children(rows)}</>;
}

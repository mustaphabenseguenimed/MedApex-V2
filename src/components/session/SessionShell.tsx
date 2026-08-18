import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export function SessionTopBar({
  backTo,
  backParams,
  title,
  subtitle,
  right,
}: {
  backTo: string;
  backParams?: Record<string, string>;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const { tr } = useI18n();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to={backTo as never}
            params={backParams as never}
            className="text-muted-foreground transition hover:text-foreground"
            aria-label={tr("Retour")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <span className="block truncate text-sm font-bold uppercase tracking-wide">{title}</span>
            {subtitle && <span className="block truncate text-[10px] text-muted-foreground">{subtitle}</span>}
          </div>
        </div>
        {right}
      </div>
    </header>
  );
}

export function SessionPill({ children, pulse }: { children: ReactNode; pulse?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        pulse
          ? "border-primary/25 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {pulse && <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />}
      {children}
    </span>
  );
}

export function SessionSection({
  step,
  title,
  actions,
  children,
}: {
  step?: number;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-2xl border bg-muted/40 p-5">
      <div className="flex items-center justify-between gap-3 border-b pb-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {step != null && `${step}. `}
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function TypeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-xl border p-3 text-center text-xs font-semibold transition",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:border-foreground/25",
      )}
    >
      {label}
    </button>
  );
}

export function ModeCard({
  title,
  description,
  active,
  onClick,
}: {
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col gap-1 rounded-xl border-2 p-4 text-left transition",
        active ? "border-primary bg-primary/5" : "border-border bg-background hover:border-foreground/20",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-sm font-bold", !active && "text-muted-foreground")}>{title}</span>
        <span
          className={cn(
            "h-4 w-4 shrink-0 rounded-full border-2",
            active ? "border-primary bg-primary" : "border-muted-foreground/40",
          )}
        />
      </div>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

export function LaunchBar({
  caption,
  headline,
  actionLabel,
  onAction,
  disabled,
  busy,
  secondary,
}: {
  caption: string;
  headline: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  busy?: boolean;
  secondary?: ReactNode;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/90 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-xs text-muted-foreground">{caption}</span>
          <span className="block truncate text-lg font-extrabold sm:text-xl">{headline}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {secondary}
          <Button onClick={onAction} disabled={disabled} className="rounded-xl px-5 font-bold sm:px-8">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            <span className="truncate">{actionLabel}</span>
            <ArrowRight className="ml-2 hidden h-4 w-4 sm:inline" />
          </Button>
        </div>
      </div>
    </div>
  );
}
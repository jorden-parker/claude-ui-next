'use client';

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Layout shared by the Settings and Tools pages.
 *
 * Both are the same shape: a sticky filter bar, collapsible groups, and rows of
 * key + control + explanation. Geist wants a rule and alignment rather than a box
 * per item, so groups are hairline-separated and rows sit on the page canvas.
 */

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 -mx-2 flex flex-wrap items-center gap-x-3 gap-y-2 bg-background px-2 py-3">
      {children}
    </div>
  );
}

/** Counts, ratios, and dates: tabular figures so columns of them line up. */
export function Tally({ children }: { children: ReactNode }) {
  return <span className="geist-numeric text-xs text-muted-foreground">{children}</span>;
}

export function GroupPanel({
  title,
  tally,
  open,
  onOpenChange,
  note,
  children,
}: {
  title: string;
  tally?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown above the rows when the group needs a caveat. */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-3 rounded-md py-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <span className="text-sm font-medium capitalize">{title}</span>
        <span className="ml-auto pr-1">{tally}</span>
      </button>
      {open && (
        <div className="pb-6">
          {note}
          {children}
        </div>
      )}
    </section>
  );
}

/** Hairline-separated rows, no card. */
export function Ledger({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border border-t border-border">{children}</ul>;
}

export function Row({
  name,
  badges,
  description,
  aside,
  children,
}: {
  /** The key column: a name, and anything that must sit under it. */
  name: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  /** Trailing action pinned to the right of the control, e.g. Clear. */
  aside?: ReactNode;
  /** The control itself. */
  children: ReactNode;
}) {
  return (
    <li className="grid gap-x-8 gap-y-3 px-2 py-4 lg:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="min-w-0 leading-5 break-all">{name}</div>
        {badges}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">{children}</div>
          {aside}
        </div>
        {description}
      </div>
    </li>
  );
}

/** A filled dot for a key that is set, and nothing for one left at its default —
 * marking the exception rather than badging every row. */
export function SetDot({ set }: { set: boolean }) {
  return set ? (
    <>
      <span aria-hidden className="mr-2 inline-block size-1.5 rounded-full bg-foreground align-middle" />
      <span className="sr-only">set</span>
    </>
  ) : (
    <span aria-hidden className="mr-2 inline-block size-1.5 align-middle" />
  );
}

// Schema and catalog text repeats what the row already shows: a "(Managed settings)"
// prefix the badge covers, and a trailing "See <url>" the docs link covers.
const MANAGED_PREFIX_RE = /^\(\s*(?:managed settings(?:\s+only)?|enterprise[^)]*)\s*\)\s*/i;
const TRAILING_URL_RE = /(?:\s*(?:see|and)\b)?\s*https?:\/\/\S+[.,;]?\s*$/i;

/** Trimmed to what a row needs: no repeats, and the leading sentence when long. */
export function summarize(description: string): string {
  const text = description.replace(MANAGED_PREFIX_RE, '').replace(TRAILING_URL_RE, '').trim();
  if (text.length <= 150) return text;
  let end = 0;
  while (end < 40) {
    const next = text.indexOf('. ', end + 1);
    if (next === -1) return `${text.slice(0, 150).trimEnd()}…`;
    end = next + 1;
  }
  return text.slice(0, end);
}

export function Description({
  description,
  docsUrl,
}: {
  description: string;
  docsUrl?: string;
}) {
  const text = summarize(description);
  if (!text && !docsUrl) return null;
  return (
    <p
      className="max-w-prose text-xs leading-relaxed text-muted-foreground"
      title={text === description ? undefined : description}
    >
      {text}
      {docsUrl && (
        <>
          {' '}
          <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            className="whitespace-nowrap underline underline-offset-2 hover:text-foreground"
          >
            docs ↗
          </a>
        </>
      )}
    </p>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {error}
    </p>
  );
}

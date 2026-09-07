import Link from 'next/link';
import { listProjects } from '@/lib/claude/data';
import { projectDisplayPath } from '@/lib/claude/tree';

export const dynamic = 'force-dynamic';

function lastActive(date: Date | null): string {
  if (!date) return '—';
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / (60 * 24))}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default async function HomePage() {
  const projects = await listProjects();
  const active = projects.filter((p) => p.sessionCount > 0 || p.memoryCount > 0);
  const sessions = active.reduce((n, p) => n + p.sessionCount, 0);
  const memories = active.reduce((n, p) => n + p.memoryCount, 0);

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <header className="mb-12">
        <h1 className="text-4xl/[48px] font-medium tracking-[-0.02em]">Projects</h1>
        <p className="geist-numeric mt-3 text-base text-fd-muted-foreground">
          {active.length} projects, {sessions} sessions, and {memories} memories under{' '}
          <code className="font-mono text-fd-foreground">~/.claude/projects</code>.
        </p>
      </header>

      <Link
        href="/global"
        className="mb-12 block rounded-lg border border-fd-border bg-fd-muted px-4 py-4 transition-colors hover:border-fd-ring/40 focus-visible:outline-2 focus-visible:outline-fd-ring motion-reduce:transition-none"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <span className="font-medium">Global</span>
          <span className="text-sm text-fd-muted-foreground">
            Settings, skills, plugins, history
          </span>
        </div>
        <p className="mt-1 max-w-[60ch] text-sm text-fd-muted-foreground">
          Instructions and memories in <code className="font-mono">~/.claude</code> that apply to
          every project.
        </p>
      </Link>

      <div className="geist-ledger">
        {active.map((p) => (
          <Link
            key={p.slug}
            href={`/p/${p.slug}`}
            className="geist-row grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_6rem_6rem_5rem]"
          >
            <span className="truncate font-mono text-sm">{projectDisplayPath(p.realPath, p.slug)}</span>
            <span className="geist-numeric hidden text-sm text-fd-muted-foreground sm:block sm:text-right">
              {p.sessionCount} {p.sessionCount === 1 ? 'session' : 'sessions'}
            </span>
            <span className="geist-numeric hidden text-sm text-fd-muted-foreground sm:block sm:text-right">
              {p.memoryCount} {p.memoryCount === 1 ? 'memory' : 'memories'}
            </span>
            <span className="geist-numeric text-sm text-fd-muted-foreground sm:text-right">
              {lastActive(p.lastActive)}
            </span>
            <span className="geist-numeric col-span-2 text-sm text-fd-muted-foreground sm:hidden">
              {p.sessionCount} sessions · {p.memoryCount} memories
            </span>
          </Link>
        ))}
      </div>

      {active.length === 0 && (
        <p className="text-fd-muted-foreground">
          No projects yet. Run Claude Code in a directory and it will appear here.
        </p>
      )}
    </div>
  );
}

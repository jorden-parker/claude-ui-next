'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { HistoryEntry } from '@/lib/claude/data';

function dayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function projectName(project: string): string {
  return project.split('/').pop() || project;
}

export function HistoryTimeline({ entries }: { entries: HistoryEntry[] }) {
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('');

  const projects = useMemo(
    () => [...new Set(entries.map((e) => e.project).filter(Boolean))].sort(),
    [entries],
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return entries.filter(
      (e) => (project === '' || e.project === project) && (q === '' || e.display.toLowerCase().includes(q)),
    );
  }, [entries, query, project]);

  const groups = useMemo(() => {
    const byDay = new Map<string, HistoryEntry[]>();
    for (const e of filtered) {
      const day = dayLabel(e.timestamp);
      const list = byDay.get(day);
      if (list) list.push(e);
      else byDay.set(day, [e]);
    }
    return [...byDay.entries()];
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search prompts…"
          className="w-64 rounded border bg-fd-secondary px-3 py-1.5 text-sm"
        />
        <select
          value={project}
          onChange={(e) => setProject(e.target.value)}
          className="rounded border bg-fd-secondary px-2 py-1.5 text-sm"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {projectName(p)}
            </option>
          ))}
        </select>
        <span className="self-center text-xs text-fd-muted-foreground">
          {filtered.length} of {entries.length}
        </span>
      </div>

      {groups.map(([day, items]) => (
        <section key={day}>
          <h3 className="mb-2 text-sm font-medium text-fd-muted-foreground">{day}</h3>
          <ul className="flex flex-col gap-1">
            {items.map((e, i) => {
              const body = (
                <>
                  <span className="shrink-0 font-mono text-xs text-fd-muted-foreground">{timeLabel(e.timestamp)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{e.display}</span>
                  <span className="shrink-0 text-xs text-fd-muted-foreground">{projectName(e.project)}</span>
                </>
              );
              return (
                <li key={`${e.timestamp}-${i}`}>
                  {e.hasSession && e.slug && e.sessionId ? (
                    <Link
                      href={`/p/${e.slug}/session/${e.sessionId}`}
                      className="flex items-baseline gap-3 rounded border bg-fd-card px-3 py-1.5 hover:bg-fd-secondary"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-baseline gap-3 rounded border px-3 py-1.5 opacity-70">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

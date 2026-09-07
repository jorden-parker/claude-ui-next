'use client';

import { useState, useTransition } from 'react';
import type { Preset } from '@/lib/claude/tools';
import type { WriteResult } from '@/lib/claude/settings-writer';

export type Row = {
  /** The exact deny-rule string. */
  name: string;
  /** '' for discovered MCP tools. */
  purpose: string;
  group: string;
  protected?: boolean;
  core?: boolean;
  /** 0 when never used. */
  count: number;
  lastUsed: string | null;
};

type Apply = (add: string[], remove: string[]) => Promise<WriteResult>;

const PROTECTED_NOTE: Record<string, string> = {
  EndConversation: 'exempt from deny rules',
  ToolSearch: 'disabling this costs more context, not less',
  WaitForMcpServers: 'disabling this costs more context, not less',
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ErrorBox({ result }: { result: WriteResult | null }) {
  if (result === null || result.ok) return null;
  return (
    <p className="rounded border border-fd-primary/50 bg-fd-card px-3 py-2 text-sm text-fd-foreground">
      {result.error}
    </p>
  );
}

function Warning() {
  return (
    <p className="text-xs text-fd-muted-foreground">
      Writes <code className="font-mono">permissions.deny</code> in{' '}
      <code className="font-mono">~/.claude/settings.json</code>. A user-scope deny cannot be overridden by any
      project&apos;s settings. Restart Claude Code sessions to pick up changes.
    </p>
  );
}

function Switch({
  on,
  disabled,
  label,
  onClick,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex shrink-0 items-center gap-2 rounded border px-2 py-0.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary disabled:opacity-50"
    >
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${on ? 'bg-fd-primary' : 'bg-fd-muted-foreground'}`}
      />
      <span className="w-8 text-left font-mono">{on ? 'on' : 'off'}</span>
    </button>
  );
}

export function ToolSwitches({ rows, denied, action }: { rows: Row[]; denied: string[]; action: Apply }) {
  const [filter, setFilter] = useState('');
  const [result, setResult] = useState<WriteResult | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const deniedSet = new Set(denied);
  const enabled = rows.filter((r) => !deniedSet.has(r.name)).length;

  function apply(add: string[], remove: string[], name: string) {
    setPendingName(name);
    startTransition(async () => {
      const r = await action(add, remove);
      setResult(r);
      setPendingName(null);
      setConfirming(null);
    });
  }

  const visible = rows.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()));
  const groups: [string, Row[]][] = [];
  for (const r of visible) {
    const last = groups.at(-1);
    if (last && last[0] === r.group) last[1].push(r);
    else groups.push([r.group, [r]]);
  }

  return (
    <div className="flex flex-col gap-4 not-prose">
      <Warning />
      <p className="text-xs text-fd-muted-foreground">
        <strong>on</strong> means the tool is available to Claude. <strong>off</strong> writes its name to{' '}
        <code className="font-mono">permissions.deny</code>, which removes it from Claude&apos;s context.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tools…"
          className="w-56 rounded border bg-fd-secondary px-3 py-1.5 text-sm"
        />
        <span className="text-xs text-fd-muted-foreground">
          {enabled} of {rows.length} tools enabled · {rows.length - enabled} disabled
        </span>
      </div>
      <ErrorBox result={result} />

      {groups.map(([group, entries]) => (
        <section key={group}>
          <h3 className="mb-1 text-sm font-medium capitalize">{group}</h3>
          {group === 'mcp' && (
            <p className="mb-2 text-xs text-fd-muted-foreground">
              Only MCP tools this machine has actually called can be listed here. Use the &quot;No MCP tools at
              all&quot; preset to remove the rest.
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {entries.map((r) => {
              const on = !deniedSet.has(r.name);
              const busy = isPending && pendingName === r.name;
              const note = r.protected ? PROTECTED_NOTE[r.name] : undefined;
              if (confirming === r.name) {
                return (
                  <li key={r.name} className="rounded border bg-fd-card px-3 py-2 text-sm">
                    <p className="mb-2">
                      Turn off <code className="font-mono">{r.name}</code>? Claude Code cannot use it in any session
                      until you turn it back on.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => apply([r.name], [], r.name)}
                        className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="rounded border px-2 py-0.5 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </li>
                );
              }
              return (
                <li
                  key={r.name}
                  title={note}
                  className="flex items-baseline gap-3 rounded border px-3 py-1.5"
                >
                  <Switch
                    on={r.protected ? true : on}
                    disabled={r.protected || busy}
                    label={`${r.name} enabled`}
                    onClick={() => {
                      if (r.protected) return;
                      if (on && r.core) setConfirming(r.name);
                      else if (on) apply([r.name], [], r.name);
                      else apply([], [r.name], r.name);
                    }}
                  />
                  <span className="shrink-0 font-mono text-sm">{r.name}</span>
                  {r.purpose && <span className="min-w-0 flex-1 text-xs text-fd-muted-foreground">{r.purpose}</span>}
                  {note && <span className="shrink-0 text-xs text-fd-muted-foreground">{note}</span>}
                  <span className="ml-auto shrink-0 text-xs text-fd-muted-foreground">
                    {r.count > 0
                      ? `${r.count} uses${r.lastUsed ? ` · ${shortDate(r.lastUsed)}` : ''}`
                      : 'never used'}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ToolPresets({
  presets,
  denied,
  action,
}: {
  presets: Preset[];
  denied: string[];
  action: Apply;
}) {
  const [result, setResult] = useState<WriteResult | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const deniedSet = new Set(denied);

  return (
    <div className="flex flex-col gap-3 not-prose">
      <ErrorBox result={result} />
      {presets.map((p) => {
        const hits = p.tools.filter((t) => deniedSet.has(t)).length;
        const state = hits === 0 ? 'Off' : hits === p.tools.length ? 'On' : 'Partial';
        const busy = isPending && pendingId === p.id;
        return (
          <div key={p.id} className="flex flex-col gap-1 rounded border bg-fd-card px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="rounded-full border px-2 py-0.5 text-xs text-fd-muted-foreground">{state}</span>
              <span className="text-sm font-medium">{p.label}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPendingId(p.id);
                  startTransition(async () => {
                    const r = await action(
                      state === 'On' ? [] : p.tools,
                      state === 'On' ? p.tools : [],
                    );
                    setResult(r);
                    setPendingId(null);
                  });
                }}
                className="ml-auto rounded border px-2 py-0.5 text-xs disabled:opacity-50"
              >
                {state === 'On' ? 'Turn back on' : 'Apply'}
              </button>
            </div>
            <p className="text-xs text-fd-muted-foreground">{p.description}</p>
            <p className="font-mono text-xs text-fd-muted-foreground">{p.tools.join(', ')}</p>
          </div>
        );
      })}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import type { Preset } from '@/lib/claude/tools';
import type { WriteResult } from '@/lib/claude/settings-writer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  ErrorNote,
  GroupPanel,
  Ledger,
  Row,
  Tally,
  Toolbar,
} from '@/components/settings-shell';

export type ToolRow = {
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

/** `capitalize` gets these two wrong: they are acronyms, not words. */
const GROUP_LABEL: Record<string, string> = { ui: 'UI', mcp: 'MCP' };

const GROUP_NOTE: Record<string, string> = {
  mcp: 'Only MCP tools this machine has actually called can be listed. Use the “No MCP tools at all” preset to remove the rest.',
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function usageText(row: ToolRow): string {
  if (row.count === 0) return 'never used';
  return `${row.count} uses${row.lastUsed ? ` · ${shortDate(row.lastUsed)}` : ''}`;
}

export function ToolSwitches({
  rows,
  denied,
  action,
}: {
  rows: ToolRow[];
  denied: string[];
  action: Apply;
}) {
  const [filter, setFilter] = useState('');
  const [onlyOff, setOnlyOff] = useState(false);
  const [onlyUnused, setOnlyUnused] = useState(false);
  const [result, setResult] = useState<WriteResult | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set());

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

  const f = filter.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (onlyOff && !deniedSet.has(r.name)) return false;
    if (onlyUnused && r.count > 0) return false;
    if (!f) return true;
    return r.name.toLowerCase().includes(f) || r.purpose.toLowerCase().includes(f);
  });

  // Rows arrive pre-sorted by group, so a single pass keeps catalogue order.
  const groups: [string, ToolRow[]][] = [];
  for (const r of visible) {
    const last = groups.at(-1);
    if (last && last[0] === r.group) last[1].push(r);
    else groups.push([r.group, [r]]);
  }
  // Tool groups are short, so these open by default — the inverse of the settings page.
  const allClosed = groups.length > 0 && groups.every(([g]) => closedGroups.has(g));

  return (
    <div className="not-prose flex w-full flex-col">
      <Toolbar>
        <Input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tools…"
          className="h-9 w-64"
        />
        <Label className="gap-2 font-normal text-muted-foreground">
          <Checkbox checked={onlyOff} onCheckedChange={(c) => setOnlyOff(Boolean(c))} />
          <span className="text-xs">Only off</span>
        </Label>
        <Label className="gap-2 font-normal text-muted-foreground">
          <Checkbox checked={onlyUnused} onCheckedChange={(c) => setOnlyUnused(Boolean(c))} />
          <span className="text-xs">Never used</span>
        </Label>
        <Tally>
          {enabled} on · {rows.length - enabled} off
        </Tally>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground"
          onClick={() => setClosedGroups(allClosed ? new Set() : new Set(groups.map(([g]) => g)))}
        >
          {allClosed ? 'Expand all' : 'Collapse all'}
        </Button>
      </Toolbar>

      <ErrorNote error={result && !result.ok ? result.error : null} />

      {groups.map(([group, entries]) => {
        const offHere = entries.filter((r) => deniedSet.has(r.name)).length;
        return (
          <GroupPanel
            key={group}
            title={GROUP_LABEL[group] ?? group}
            open={!closedGroups.has(group)}
            onOpenChange={(next) =>
              setClosedGroups((prev) => {
                const s = new Set(prev);
                if (next) s.delete(group);
                else s.add(group);
                return s;
              })
            }
            tally={
              <Tally>
                {offHere > 0 && `${offHere} off · `}
                {entries.length}
              </Tally>
            }
            note={
              GROUP_NOTE[group] && (
                <p className="max-w-prose px-2 pb-3 text-xs text-muted-foreground">
                  {GROUP_NOTE[group]}
                </p>
              )
            }
          >
            <Ledger>
              {entries.map((r) => {
                const on = !deniedSet.has(r.name);
                const busy = isPending && pendingName === r.name;
                const note = r.protected ? PROTECTED_NOTE[r.name] : undefined;

                if (confirming === r.name) {
                  return (
                    <li key={r.name} className="bg-accent px-3 py-4">
                      <p className="mb-3 max-w-prose text-sm">
                        Turn off <span className="font-mono">{r.name}</span>? Claude Code cannot use
                        it in any session until you turn it back on.
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busy} onClick={() => apply([r.name], [], r.name)}>
                          Confirm
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                      </div>
                    </li>
                  );
                }

                return (
                  <Row
                    key={r.name}
                    name={
                      <Label className="gap-2.5 font-normal">
                        <Switch
                          checked={r.protected ? true : on}
                          disabled={r.protected || busy}
                          aria-label={`${r.name} enabled`}
                          onCheckedChange={() => {
                            if (r.protected) return;
                            if (on && r.core) setConfirming(r.name);
                            else if (on) apply([r.name], [], r.name);
                            else apply([], [r.name], r.name);
                          }}
                        />
                        <span className="min-w-0 font-mono text-xs break-all">{r.name}</span>
                      </Label>
                    }
                    aside={<Tally>{usageText(r)}</Tally>}
                  >
                    <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                      {r.purpose}
                      {note && (
                        <>
                          {r.purpose && ' — '}
                          {note}
                        </>
                      )}
                    </p>
                  </Row>
                );
              })}
            </Ledger>
          </GroupPanel>
        );
      })}
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
    <div className="not-prose flex w-full flex-col gap-3">
      <ErrorNote error={result && !result.ok ? result.error : null} />
      <Ledger>
        {presets.map((p) => {
          const hits = p.tools.filter((t) => deniedSet.has(t)).length;
          // "Applied" means every tool in the bundle is denied. The switches call that
          // state off, so the preset says applied instead — same fact, opposite subject.
          const applied = hits === p.tools.length;
          const label = hits === 0 ? 'Not applied' : applied ? 'Applied' : 'Partial';
          const busy = isPending && pendingId === p.id;
          return (
            <Row
              key={p.id}
              name={
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={applied ? 'default' : 'outline'}>{label}</Badge>
                  <span className="text-sm font-medium">{p.label}</span>
                </span>
              }
              aside={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setPendingId(p.id);
                    startTransition(async () => {
                      const r = await action(applied ? [] : p.tools, applied ? p.tools : []);
                      setResult(r);
                      setPendingId(null);
                    });
                  }}
                >
                  {applied ? 'Undo' : 'Apply'}
                </Button>
              }
              description={
                <p className="font-mono text-xs break-all text-muted-foreground">
                  {p.tools.join(', ')}
                </p>
              }
            >
              <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                {p.description}
              </p>
            </Row>
          );
        })}
      </Ledger>
    </div>
  );
}

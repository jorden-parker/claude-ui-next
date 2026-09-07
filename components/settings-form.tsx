'use client';

import { useState, useTransition } from 'react';
import type { Field, EnvSpec } from '@/lib/claude/settings-schema';
import type { SetResult } from '@/lib/claude/settings-writer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Description,
  ErrorNote,
  GroupPanel,
  Ledger,
  Row,
  SetDot,
  Tally,
  Toolbar,
  summarize,
} from '@/components/settings-shell';

export interface FieldRow extends Field {
  value: unknown;
  isSet: boolean;
}

export interface EnvRow {
  name: string;
  /** null when secret and set (the real value never reaches the browser). */
  value: string | null;
  isSet: boolean;
  secret: boolean;
  options?: string[];
  description: string;
  deprecated: boolean;
  group: string;
}

type Update = (path: string[], value: unknown) => Promise<SetResult>;

/** Sentinel item values. A Base UI select stores real values, so "leave this key out
 * of the file" needs a value of its own rather than an empty string. */
const UNSET = '__unset__';
const CUSTOM = '__custom__';

const CONFIRM_MESSAGE = (key: string, value: unknown) =>
  `Write ${key} = ${JSON.stringify(value)}? Claude Code reads this file for every session.`;

function needsConfirm(key: string, value: unknown, isClear: boolean, kind: string): boolean {
  if (key === 'permissions.defaultMode' && value === 'bypassPermissions') return true;
  if (key === 'disableAllHooks' && value === true) return true;
  if (key === 'permissions.disableBypassPermissionsMode') return true;
  if (isClear && kind === 'json') return true;
  return false;
}

/** What the closed dropdown reads when the key is absent from the file: the value
 * Claude Code will actually use, not a bare "default". */
function unsetLabel(def: unknown): string {
  return def === undefined ? 'Not set' : `Default — ${String(def)}`;
}

function KeyName({ label, isSet }: { label: string; isSet: boolean }) {
  return (
    <span className="font-mono text-xs">
      <SetDot set={isSet} />
      {label}
    </span>
  );
}

/** Only exceptions get a badge; "default" on nine rows in ten is noise. */
function Flags({ row }: { row: FieldRow }) {
  if (!row.managedOnly && !row.deprecated) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {row.managedOnly && <Badge variant="outline">managed only</Badge>}
      {row.deprecated && <Badge variant="outline">deprecated</Badge>}
    </span>
  );
}

/** Keying a control by `${key}:${JSON.stringify(value)}` remounts it — resetting any
 * in-progress draft — whenever the server-confirmed value changes underneath it. The
 * key belongs on the component element, not on the markup the component returns. */
function draftKey(key: string, value: unknown): string {
  return `${key}:${JSON.stringify(value) ?? 'undefined'}`;
}

type WriteFn = (value: unknown, opts?: { isClear?: boolean }) => void;

function FieldControl({ row, busy, onWrite }: { row: FieldRow; busy: boolean; onWrite: WriteFn }) {
  const current = row.isSet ? row.value : row.default;
  const k = draftKey(row.key, row.value);

  switch (row.kind) {
    case 'boolean': {
      const on = row.isSet ? Boolean(row.value) : Boolean(row.default ?? false);
      return (
        <Label className="w-fit gap-2.5">
          <Switch
            checked={on}
            disabled={busy}
            onCheckedChange={() => onWrite(!on)}
            aria-label={row.key}
          />
          <span className="font-mono text-xs font-normal">{on ? 'on' : 'off'}</span>
          {!row.isSet && <span className="text-xs font-normal text-muted-foreground">default</span>}
        </Label>
      );
    }
    case 'enum':
      return <EnumControl row={row} busy={busy} onWrite={onWrite} />;
    case 'enumOrCustom':
      return <EnumOrCustomControl key={k} row={row} busy={busy} onWrite={onWrite} />;
    case 'integer':
    case 'number':
      return <NumberControl key={k} row={row} current={current} busy={busy} onWrite={onWrite} />;
    case 'string':
      return <StringControl key={k} current={current} busy={busy} onWrite={onWrite} />;
    case 'stringList':
      return <StringListControl key={k} row={row} busy={busy} onWrite={onWrite} />;
    case 'enumList':
      return <EnumListControl row={row} busy={busy} onWrite={onWrite} />;
    case 'json':
      return <JsonControl key={k} row={row} busy={busy} onWrite={onWrite} />;
    default:
      return null;
  }
}

function ValueSelect({
  value,
  onChange,
  busy,
  label,
  items,
  unsetText,
}: {
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  label: string;
  items: { value: string; label: string; mono?: boolean }[];
  unsetText: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(String(v))} disabled={busy}>
      <SelectTrigger aria-label={label} className="h-9 w-full max-w-sm">
        <SelectValue>
          {(v: string) =>
            v === UNSET ? (
              <span className="text-muted-foreground">{unsetText}</span>
            ) : v === CUSTOM ? (
              <span className="text-muted-foreground">Custom value…</span>
            ) : (
              <span className="font-mono text-xs">{String(v)}</span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            <span className={item.mono ? 'font-mono text-xs' : ''}>{item.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EnumControl({ row, busy, onWrite }: { row: FieldRow; busy: boolean; onWrite: WriteFn }) {
  const unsetText = unsetLabel(row.default);
  return (
    <ValueSelect
      busy={busy}
      label={row.key}
      unsetText={unsetText}
      value={row.isSet ? String(row.value) : UNSET}
      onChange={(v) => (v === UNSET ? onWrite(undefined, { isClear: true }) : onWrite(v))}
      items={[
        { value: UNSET, label: unsetText },
        ...(row.options ?? []).map((o) => ({ value: o, label: o, mono: true })),
      ]}
    />
  );
}

function EnumOrCustomControl({
  row,
  busy,
  onWrite,
}: {
  row: FieldRow;
  busy: boolean;
  onWrite: WriteFn;
}) {
  const isKnown = row.isSet && (row.options?.includes(String(row.value)) ?? false);
  const [showCustom, setShowCustom] = useState(row.isSet && !isKnown);
  const [text, setText] = useState(row.isSet && !isKnown ? String(row.value) : '');
  const unsetText = unsetLabel(row.default);

  return (
    <div className="flex max-w-sm flex-col gap-2">
      <ValueSelect
        busy={busy}
        label={row.key}
        unsetText={unsetText}
        value={showCustom ? CUSTOM : row.isSet ? String(row.value) : UNSET}
        onChange={(v) => {
          if (v === CUSTOM) {
            setShowCustom(true);
          } else if (v === UNSET) {
            setShowCustom(false);
            onWrite(undefined, { isClear: true });
          } else {
            setShowCustom(false);
            onWrite(v);
          }
        }}
        items={[
          { value: UNSET, label: unsetText },
          ...(row.options ?? []).map((o) => ({ value: o, label: o, mono: true })),
          { value: CUSTOM, label: 'Custom value…' },
        ]}
      />
      {showCustom && (
        <div className="flex items-center gap-2">
          <Input
            value={text}
            disabled={busy}
            placeholder={row.customPattern ? `matches ${row.customPattern}` : 'custom value'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onWrite(text);
            }}
            className="h-9 font-mono"
          />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onWrite(text)}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

function NumberControl({
  row,
  current,
  busy,
  onWrite,
}: {
  row: FieldRow;
  current: unknown;
  busy: boolean;
  onWrite: WriteFn;
}) {
  const initial = current === undefined || current === null ? '' : String(current);
  const [text, setText] = useState(initial);
  const dirty = text !== initial;
  function save() {
    if (text.trim() === '') onWrite(undefined, { isClear: true });
    else onWrite(Number(text));
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        value={text}
        min={row.min}
        max={row.max}
        step={row.kind === 'integer' ? 1 : 'any'}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && dirty) save();
        }}
        className="geist-numeric h-9 w-32"
      />
      {dirty && (
        <Button variant="outline" size="sm" disabled={busy} onClick={save}>
          Save
        </Button>
      )}
    </div>
  );
}

function StringControl({
  current,
  busy,
  onWrite,
}: {
  current: unknown;
  busy: boolean;
  onWrite: WriteFn;
}) {
  const initial = typeof current === 'string' ? current : '';
  const [text, setText] = useState(initial);
  const dirty = text !== initial;
  return (
    <div className="flex max-w-2xl items-center gap-2">
      <Input
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && dirty) onWrite(text);
        }}
        className="h-9 font-mono"
      />
      {dirty && (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onWrite(text)}>
          Save
        </Button>
      )}
    </div>
  );
}

function StringListControl({
  row,
  busy,
  onWrite,
}: {
  row: FieldRow;
  busy: boolean;
  onWrite: WriteFn;
}) {
  const initial = Array.isArray(row.value) ? (row.value as unknown[]).join('\n') : '';
  const [text, setText] = useState(initial);
  // An empty textarea for every unset key was most of this page's height.
  const [open, setOpen] = useState(row.isSet);
  const dirty = text !== initial;

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Add entries…
      </Button>
    );
  }
  function save() {
    const lines = Array.from(
      new Set(
        text
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0),
      ),
    );
    onWrite(lines);
  }
  return (
    <div className="flex max-w-2xl flex-col items-start gap-2">
      <Textarea
        rows={3}
        value={text}
        disabled={busy}
        placeholder="one entry per line"
        onChange={(e) => setText(e.target.value)}
        className="font-mono text-xs"
      />
      {dirty && (
        <Button variant="outline" size="sm" disabled={busy} onClick={save}>
          Save
        </Button>
      )}
    </div>
  );
}

function EnumListControl({
  row,
  busy,
  onWrite,
}: {
  row: FieldRow;
  busy: boolean;
  onWrite: WriteFn;
}) {
  const current = new Set(Array.isArray(row.value) ? (row.value as unknown[]).map(String) : []);
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2.5">
      {(row.options ?? []).map((o) => (
        <Label key={o} className="gap-2 font-normal">
          <Checkbox
            disabled={busy}
            checked={current.has(o)}
            onCheckedChange={(checked) => {
              const next = new Set(current);
              if (checked) next.add(o);
              else next.delete(o);
              onWrite([...next]);
            }}
          />
          <span className="font-mono text-xs">{o}</span>
        </Label>
      ))}
    </div>
  );
}

function JsonControl({ row, busy, onWrite }: { row: FieldRow; busy: boolean; onWrite: WriteFn }) {
  const initial = row.isSet ? JSON.stringify(row.value, null, 2) : '';
  const [text, setText] = useState(initial);
  const [open, setOpen] = useState(row.isSet);
  const [parseError, setParseError] = useState<string | null>(null);
  const dirty = text !== initial;

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Edit JSON…
      </Button>
    );
  }
  function save() {
    if (text.trim() === '') {
      onWrite(undefined, { isClear: true });
      return;
    }
    try {
      const parsed = JSON.parse(text);
      setParseError(null);
      onWrite(parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON.');
    }
  }
  return (
    <div className="flex max-w-2xl flex-col items-start gap-2">
      <Textarea
        rows={6}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        className="font-mono text-xs"
      />
      {parseError && <p className="text-xs text-destructive">{parseError}</p>}
      {dirty && (
        <Button variant="outline" size="sm" disabled={busy} onClick={save}>
          Save
        </Button>
      )}
    </div>
  );
}

function FieldRowView({
  row,
  label,
  busy,
  pendingKey,
  confirmState,
  setConfirmState,
  write,
}: {
  row: FieldRow;
  /** The leaf name inside a parent cluster, else the full key. */
  label: string;
  busy: boolean;
  pendingKey: string | null;
  confirmState: { key: string; value: unknown } | null;
  setConfirmState: (s: { key: string; value: unknown } | null) => void;
  write: (path: string[], value: unknown, key: string) => void;
}) {
  const rowBusy = busy && pendingKey === row.key;
  const confirming = confirmState !== null && confirmState.key === row.key;

  function onWrite(value: unknown, opts?: { isClear?: boolean }) {
    const isClear = opts?.isClear ?? value === undefined;
    if (needsConfirm(row.key, value, isClear, row.kind)) {
      setConfirmState({ key: row.key, value });
      return;
    }
    write(row.path, value, row.key);
  }

  if (confirming) {
    return (
      <li className="bg-accent px-3 py-4">
        <p className="mb-3 max-w-prose font-mono text-xs">
          {CONFIRM_MESSAGE(row.key, confirmState.value)}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={rowBusy}
            onClick={() => {
              setConfirmState(null);
              write(row.path, confirmState.value, row.key);
            }}
          >
            Confirm
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmState(null)}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <Row
      name={<KeyName label={label} isSet={row.isSet} />}
      badges={<Flags row={row} />}
      description={<Description description={row.description} docsUrl={row.docsUrl} />}
      aside={
        row.isSet ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={rowBusy}
            onClick={() => onWrite(undefined, { isClear: true })}
            className="text-muted-foreground"
          >
            Clear
          </Button>
        ) : null
      }
    >
      <FieldControl row={row} busy={rowBusy} onWrite={onWrite} />
    </Row>
  );
}

/** Split a group's rows into the top-level keys and one cluster per parent object path, so
 * `permissions.allow` reads as `allow` under a `permissions` heading instead of repeating the
 * prefix on every row. Clusters keep first-appearance (schema) order. */
function cluster(rows: FieldRow[]): { parent: string | null; rows: FieldRow[] }[] {
  const bare: FieldRow[] = [];
  const byParent = new Map<string, FieldRow[]>();
  for (const r of rows) {
    if (r.path.length === 1) {
      bare.push(r);
      continue;
    }
    const parent = r.path.slice(0, -1).join('.');
    const list = byParent.get(parent);
    if (list) list.push(r);
    else byParent.set(parent, [r]);
  }
  const out: { parent: string | null; rows: FieldRow[] }[] = [];
  if (bare.length > 0) out.push({ parent: null, rows: bare });
  for (const [parent, list] of byParent) out.push({ parent, rows: list });
  return out;
}

const alpha = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** The cluster heading minus whatever the group heading above it already said:
 * `sandbox.network` under "Sandbox" reads `network`. When nothing is left — `permissions`
 * under "Permissions" — there is no heading, and those rows carry their full key instead,
 * which keeps `permissions.disableAutoMode` distinct from the top-level `disableAutoMode`. */
function clusterLabel(parent: string, group: string): string | null {
  const segments = parent.split('.');
  const kept = alpha(group).startsWith(alpha(segments[0])) ? segments.slice(1) : segments;
  return kept.length === 0 ? null : kept.join('.');
}

export function SettingsForm({
  rows,
  groupOrder,
  action,
}: {
  rows: FieldRow[];
  groupOrder: string[];
  action: Update;
}) {
  const [filter, setFilter] = useState('');
  const [onlySet, setOnlySet] = useState(false);
  const [result, setResult] = useState<SetResult | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ key: string; value: unknown } | null>(null);
  const [isPending, startTransition] = useTransition();
  // Groups holding a set key start open; the rest stay shut, so the page opens as a
  // short index rather than 200 expanded rows.
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.isSet).map((r) => (r.deprecated ? 'Deprecated' : r.group))),
  );

  const f = filter.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (onlySet && !r.isSet) return false;
    if (!f) return true;
    return r.key.toLowerCase().includes(f) || r.description.toLowerCase().includes(f);
  });

  const grouped = new Map<string, FieldRow[]>();
  for (const r of visible) {
    if (r.deprecated && !r.isSet) continue; // deprecated rows hidden unless set
    const g = r.deprecated ? 'Deprecated' : r.group;
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)?.push(r);
  }

  const shownGroups = groupOrder.filter((g) => grouped.has(g));
  // Searching is a request to see the matches, so it overrides the collapsed state.
  const forceOpen = f !== '' || onlySet;
  const allOpen = shownGroups.length > 0 && shownGroups.every((g) => openGroups.has(g));

  function write(path: string[], value: unknown, key: string) {
    setPendingKey(key);
    setConfirmState(null);
    startTransition(async () => {
      const r = await action(path, value);
      setResult(r);
      setPendingKey(null);
      if (r.ok) setSavedKey(key);
    });
  }

  const setCount = rows.filter((r) => r.isSet).length;

  return (
    <div className="not-prose flex w-full flex-col">
      <Toolbar>
        <Input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter keys…"
          className="h-9 w-64"
        />
        <Label className="gap-2 font-normal text-muted-foreground">
          <Checkbox checked={onlySet} onCheckedChange={(c) => setOnlySet(Boolean(c))} />
          <span className="text-xs">Only set</span>
        </Label>
        <Tally>
          {setCount} set · {rows.length} keys
        </Tally>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground"
          onClick={() => setOpenGroups(allOpen ? new Set() : new Set(shownGroups))}
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </Button>
      </Toolbar>

      <ErrorNote error={result && !result.ok ? result.error : null} />
      {savedKey && !isPending && (
        <p className="pb-2 text-xs text-muted-foreground">
          Saved <span className="font-mono">{savedKey}</span>
        </p>
      )}

      {shownGroups.map((g) => {
        const list = grouped.get(g) ?? [];
        const setHere = list.filter((r) => r.isSet).length;
        return (
          <GroupPanel
            key={g}
            title={g}
            open={forceOpen || openGroups.has(g)}
            onOpenChange={(next) =>
              setOpenGroups((prev) => {
                const s = new Set(prev);
                if (next) s.add(g);
                else s.delete(g);
                return s;
              })
            }
            tally={
              <Tally>
                {setHere > 0 && `${setHere} set · `}
                {list.length}
              </Tally>
            }
          >
            {cluster(list).map(({ parent, rows: clustered }) => {
              const heading = parent === null ? null : clusterLabel(parent, g);
              return (
                <div key={parent ?? '__bare__'}>
                  {heading && (
                    <h4 className="mt-5 mb-1 px-2 font-mono text-xs text-muted-foreground">
                      {heading}
                    </h4>
                  )}
                  <Ledger>
                    {clustered.map((row) => (
                      <FieldRowView
                        key={row.key}
                        row={row}
                        label={heading ? row.path[row.path.length - 1] : row.key}
                        busy={isPending}
                        pendingKey={pendingKey}
                        confirmState={confirmState}
                        setConfirmState={setConfirmState}
                        write={write}
                      />
                    ))}
                  </Ledger>
                </div>
              );
            })}
          </GroupPanel>
        );
      })}
    </div>
  );
}

function EnvRowView({
  row,
  busy,
  write,
}: {
  row: EnvRow;
  busy: boolean;
  write: (name: string, value: unknown) => void;
}) {
  const initial = row.secret ? '' : (row.value ?? '');
  const [text, setText] = useState(initial);
  const dirty = text !== initial && text !== '';

  return (
    <Row
      name={
        <span className="font-mono text-xs">
          <SetDot set />
          {row.name}
        </span>
      }
      badges={
        row.secret || row.deprecated ? (
          <span className="flex flex-wrap gap-1.5">
            {row.secret && <Badge variant="outline">secret</Badge>}
            {row.deprecated && <Badge variant="outline">deprecated</Badge>}
          </span>
        ) : null
      }
      description={<Description description={row.description} />}
      aside={
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => write(row.name, undefined)}
          className="text-muted-foreground"
        >
          Clear
        </Button>
      }
    >
      {row.options ? (
        <ValueSelect
          busy={busy}
          label={row.name}
          unsetText="Not set"
          value={row.value ?? UNSET}
          onChange={(v) => write(row.name, v === UNSET ? undefined : v)}
          items={[
            { value: UNSET, label: 'Not set' },
            ...row.options.map((o) => ({ value: o, label: o, mono: true })),
          ]}
        />
      ) : (
        <div className="flex max-w-2xl items-center gap-2">
          <Input
            type={row.secret ? 'password' : 'text'}
            value={text}
            placeholder={row.secret && row.isSet ? '•••••••• (set)' : undefined}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && dirty) write(row.name, text);
            }}
            className="h-9 font-mono"
          />
          {dirty && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => write(row.name, text)}>
              Save
            </Button>
          )}
        </div>
      )}
    </Row>
  );
}

export function EnvForm({
  rows,
  specs,
  action,
}: {
  rows: EnvRow[];
  specs: EnvSpec[];
  action: Update;
}) {
  const [result, setResult] = useState<SetResult | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [addName, setAddName] = useState('');
  const [addValue, setAddValue] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);

  function write(name: string, value: unknown) {
    setPendingName(name);
    startTransition(async () => {
      const r = await action(['env', name], value);
      setResult(r);
      setPendingName(null);
      if (r.ok) {
        setAddName('');
        setAddValue('');
      }
    });
  }

  const specByName = new Map(specs.map((s) => [s.name, s]));
  const addSpec = specByName.get(addName.toUpperCase());
  // The catalog lists what is *not* set yet; anything set is already a row above.
  const setNames = new Set(rows.map((r) => r.name));
  const unset = specs.filter((s) => !setNames.has(s.name));
  const groups = new Map<string, EnvSpec[]>();
  for (const s of unset) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group)?.push(s);
  }
  const canAdd = /^[A-Z_][A-Z0-9_]*$/.test(addName) && addValue !== '';

  return (
    <div className="not-prose flex w-full flex-col gap-6">
      <ErrorNote error={result && !result.ok ? result.error : null} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            list="env-var-names"
            value={addName}
            onChange={(e) => setAddName(e.target.value.toUpperCase())}
            placeholder="NAME"
            className="h-9 w-64 font-mono"
          />
          <datalist id="env-var-names">
            {specs.map((s) => (
              <option key={s.name} value={s.name} />
            ))}
          </datalist>
          {addSpec?.options ? (
            <Select
              value={addValue === '' ? UNSET : addValue}
              onValueChange={(v) => setAddValue(String(v) === UNSET ? '' : String(v))}
            >
              <SelectTrigger className="h-9 w-56">
                <SelectValue>
                  {(v: string) =>
                    v === UNSET ? (
                      <span className="text-muted-foreground">Choose a value…</span>
                    ) : (
                      <span className="font-mono text-xs">{String(v)}</span>
                    )
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Choose a value…</SelectItem>
                {addSpec.options.map((o) => (
                  <SelectItem key={o} value={o}>
                    <span className="font-mono text-xs">{o}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              type={addSpec?.secret ? 'password' : 'text'}
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              placeholder="value"
              className="h-9 min-w-56 flex-1 font-mono"
            />
          )}
          <Button
            variant="outline"
            disabled={isPending || !canAdd}
            onClick={() => write(addName, addValue)}
          >
            Add
          </Button>
        </div>
        {addSpec && <Description description={addSpec.description} />}
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">None set.</p>
      ) : (
        <Ledger>
          {rows.map((row) => (
            <EnvRowView
              key={`${row.name}:${row.value ?? ''}`}
              row={row}
              busy={isPending && pendingName === row.name}
              write={write}
            />
          ))}
        </Ledger>
      )}

      <GroupPanel
        title="Documented, not set"
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        tally={<Tally>{unset.length}</Tally>}
      >
        <div className="flex flex-col gap-5 pt-2">
          {[...groups.entries()].map(([group, entries]) => (
            <div key={group}>
              <h4 className="mb-1 px-2 text-xs font-medium text-muted-foreground">{group}</h4>
              <Ledger>
                {entries.map((s) => (
                  <li
                    key={s.name}
                    className="grid items-baseline gap-x-6 gap-y-1 px-2 py-2.5 lg:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)_auto]"
                  >
                    <span className="min-w-0 break-all font-mono text-xs">{s.name}</span>
                    <span className="min-w-0 max-w-prose text-xs leading-relaxed text-muted-foreground">
                      {summarize(s.description)}
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="justify-self-start text-muted-foreground"
                      onClick={() => setAddName(s.name)}
                    >
                      Set…
                    </Button>
                  </li>
                ))}
              </Ledger>
            </div>
          ))}
        </div>
      </GroupPanel>
    </div>
  );
}

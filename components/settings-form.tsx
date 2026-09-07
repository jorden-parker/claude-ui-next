'use client';

import { useState, useTransition } from 'react';
import type { Field, EnvSpec } from '@/lib/claude/settings-schema';
import type { SetResult } from '@/lib/claude/settings-writer';

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

const CONFIRM_MESSAGE = (key: string, value: unknown) =>
  `Write ${key} = ${JSON.stringify(value)}? Claude Code reads this file for every session.`;

function needsConfirm(key: string, value: unknown, isClear: boolean, kind: string): boolean {
  if (key === 'permissions.defaultMode' && value === 'bypassPermissions') return true;
  if (key === 'disableAllHooks' && value === true) return true;
  if (key === 'permissions.disableBypassPermissionsMode') return true;
  if (isClear && kind === 'json') return true;
  return false;
}

function ErrorBox({ result }: { result: SetResult | null }) {
  if (result === null || result.ok) return null;
  return (
    <p className="rounded border border-fd-primary/50 bg-fd-card px-3 py-2 text-sm text-fd-foreground">
      {result.error}
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

function Badges({ row }: { row: FieldRow }) {
  return (
    <span className="flex shrink-0 gap-1">
      {!row.isSet && (
        <span className="rounded-full border px-1.5 py-0 text-[10px] text-fd-muted-foreground">default</span>
      )}
      {row.managedOnly && (
        <span className="rounded-full border px-1.5 py-0 text-[10px] text-fd-muted-foreground">managed-only</span>
      )}
      {row.deprecated && (
        <span className="rounded-full border border-fd-primary/50 px-1.5 py-0 text-[10px] text-fd-primary">
          deprecated
        </span>
      )}
    </span>
  );
}

function Description({ row }: { row: Pick<FieldRow, 'description' | 'docsUrl'> }) {
  if (!row.description) return null;
  return (
    <p className="text-xs text-fd-muted-foreground">
      {row.description}
      {row.docsUrl && (
        <>
          {' '}
          <a href={row.docsUrl} target="_blank" rel="noreferrer" className="underline">
            docs ↗
          </a>
        </>
      )}
    </p>
  );
}

/** Local draft state for text-ish inputs: keying each control by `${key}:${JSON.stringify(value)}`
 * makes React remount it (resetting any in-progress edit) whenever the server-confirmed value
 * changes underneath it, without a separate effect to reconcile drafts against fresh props. */
function draftKey(key: string, value: unknown): string {
  return `${key}:${JSON.stringify(value) ?? 'undefined'}`;
}

function FieldControl({
  row,
  busy,
  onWrite,
}: {
  row: FieldRow;
  busy: boolean;
  onWrite: (value: unknown, opts?: { isClear?: boolean }) => void;
}) {
  const current = row.isSet ? row.value : row.default;

  if (row.readOnly) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <pre className="overflow-x-auto rounded bg-fd-secondary p-2 text-xs">
          {JSON.stringify(row.value, null, 2)}
        </pre>
        <p className="text-xs text-fd-muted-foreground">
          {row.key === 'permissions.deny' ? (
            <>
              {row.readOnly}{' '}
              <a href="/global/tools" className="underline">
                Open the Tools page.
              </a>
            </>
          ) : (
            row.readOnly
          )}
        </p>
      </div>
    );
  }

  switch (row.kind) {
    case 'boolean': {
      const on = row.isSet ? Boolean(row.value) : Boolean(row.default ?? false);
      return (
        <Switch on={on} disabled={busy} label={row.key} onClick={() => onWrite(!on)} />
      );
    }
    case 'enum': {
      return (
        <select
          disabled={busy}
          value={row.isSet ? String(row.value) : ''}
          onChange={(e) => {
            if (e.target.value === '') onWrite(undefined, { isClear: true });
            else onWrite(e.target.value);
          }}
          className="rounded border bg-fd-secondary px-2 py-1 text-sm"
        >
          <option value="">
            — default{row.default !== undefined ? ` (${String(row.default)})` : ''} —
          </option>
          {(row.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    case 'enumOrCustom': {
      const isKnown = row.isSet && (row.options?.includes(String(row.value)) ?? false);
      const initialCustom = row.isSet && !isKnown;
      return (
        <EnumOrCustomControl
          key={draftKey(row.key, row.value)}
          row={row}
          busy={busy}
          onWrite={onWrite}
          initialCustom={initialCustom}
        />
      );
    }
    case 'integer':
    case 'number': {
      return (
        <NumberControl
          row={row}
          current={current}
          busy={busy}
          onWrite={onWrite}
        />
      );
    }
    case 'string': {
      return <StringControl row={row} current={current} busy={busy} onWrite={onWrite} />;
    }
    case 'stringList': {
      return <StringListControl row={row} busy={busy} onWrite={onWrite} />;
    }
    case 'enumList': {
      return <EnumListControl row={row} busy={busy} onWrite={onWrite} />;
    }
    case 'json': {
      return <JsonControl row={row} busy={busy} onWrite={onWrite} />;
    }
    default:
      return null;
  }
}

function EnumOrCustomControl({
  row,
  busy,
  onWrite,
  initialCustom,
}: {
  row: FieldRow;
  busy: boolean;
  onWrite: (value: unknown, opts?: { isClear?: boolean }) => void;
  initialCustom: boolean;
}) {
  const [showCustom, setShowCustom] = useState(initialCustom);
  const [text, setText] = useState(row.isSet && initialCustom ? String(row.value) : '');
  return (
    <div className="flex flex-col gap-1">
      <select
        disabled={busy}
        value={row.isSet && !showCustom ? String(row.value) : showCustom ? '__custom__' : ''}
        onChange={(e) => {
          if (e.target.value === '') {
            setShowCustom(false);
            onWrite(undefined, { isClear: true });
          } else if (e.target.value === '__custom__') {
            setShowCustom(true);
          } else {
            setShowCustom(false);
            onWrite(e.target.value);
          }
        }}
        className="rounded border bg-fd-secondary px-2 py-1 text-sm"
      >
        <option value="">
          — default{row.default !== undefined ? ` (${String(row.default)})` : ''} —
        </option>
        {(row.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value="__custom__">custom…</option>
      </select>
      {showCustom && (
        <div className="flex gap-2">
          <input
            type="text"
            value={text}
            disabled={busy}
            placeholder={row.customPattern ? `matches ${row.customPattern}` : 'custom value'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onWrite(text);
            }}
            className="min-w-0 flex-1 rounded border bg-fd-secondary px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => onWrite(text)}
            className="shrink-0 rounded border px-2 py-1 text-xs disabled:opacity-50"
          >
            Save
          </button>
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
  onWrite: (value: unknown, opts?: { isClear?: boolean }) => void;
}) {
  const initial = current === undefined || current === null ? '' : String(current);
  const [text, setText] = useState(initial);
  function save() {
    if (text.trim() === '') {
      onWrite(undefined, { isClear: true });
      return;
    }
    onWrite(Number(text));
  }
  return (
    <div key={draftKey(row.key, row.value)} className="flex gap-2">
      <input
        type="number"
        defaultValue={initial}
        min={row.min}
        max={row.max}
        step={row.kind === 'integer' ? 1 : 'any'}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        className="w-32 rounded border bg-fd-secondary px-2 py-1 text-sm"
      />
      <button type="button" disabled={busy} onClick={save} className="rounded border px-2 py-1 text-xs disabled:opacity-50">
        Save
      </button>
    </div>
  );
}

function StringControl({
  row,
  current,
  busy,
  onWrite,
}: {
  row: FieldRow;
  current: unknown;
  busy: boolean;
  onWrite: (value: unknown, opts?: { isClear?: boolean }) => void;
}) {
  const initial = typeof current === 'string' ? current : '';
  const [text, setText] = useState(initial);
  return (
    <div key={draftKey(row.key, row.value)} className="flex gap-2">
      <input
        type="text"
        defaultValue={initial}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        className="min-w-0 flex-1 rounded border bg-fd-secondary px-2 py-1 text-sm"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => onWrite(text)}
        className="shrink-0 rounded border px-2 py-1 text-xs disabled:opacity-50"
      >
        Save
      </button>
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
  onWrite: (value: unknown, opts?: { isClear?: boolean }) => void;
}) {
  const initial = Array.isArray(row.value) ? (row.value as unknown[]).join('\n') : '';
  const [text, setText] = useState(initial);
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
    <div key={draftKey(row.key, row.value)} className="flex flex-col gap-1">
      <textarea
        rows={3}
        defaultValue={initial}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded border bg-fd-secondary px-2 py-1 font-mono text-sm"
      />
      <button
        type="button"
        disabled={busy}
        onClick={save}
        className="w-fit rounded border px-2 py-1 text-xs disabled:opacity-50"
      >
        Save
      </button>
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
  onWrite: (value: unknown, opts?: { isClear?: boolean }) => void;
}) {
  const current = new Set(Array.isArray(row.value) ? (row.value as unknown[]).map(String) : []);
  return (
    <div className="flex flex-wrap gap-3">
      {(row.options ?? []).map((o) => (
        <label key={o} className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            disabled={busy}
            checked={current.has(o)}
            onChange={(e) => {
              const next = new Set(current);
              if (e.target.checked) next.add(o);
              else next.delete(o);
              onWrite([...next]);
            }}
          />
          {o}
        </label>
      ))}
    </div>
  );
}

function JsonControl({
  row,
  busy,
  onWrite,
}: {
  row: FieldRow;
  busy: boolean;
  onWrite: (value: unknown, opts?: { isClear?: boolean }) => void;
}) {
  const initial = row.isSet ? JSON.stringify(row.value, null, 2) : '';
  const [text, setText] = useState(initial);
  const [parseError, setParseError] = useState<string | null>(null);
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
    <div key={draftKey(row.key, row.value)} className="flex flex-col gap-1">
      <textarea
        rows={6}
        defaultValue={initial}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded border bg-fd-secondary px-2 py-1 font-mono text-xs"
      />
      {parseError && <p className="text-xs text-fd-primary">{parseError}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={save}
        className="w-fit rounded border px-2 py-1 text-xs disabled:opacity-50"
      >
        Save
      </button>
    </div>
  );
}

function FieldRowView({
  row,
  busy,
  pendingKey,
  confirmState,
  setConfirmState,
  write,
}: {
  row: FieldRow;
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
      <li className="bg-fd-muted px-2 py-3 text-sm">
        <p className="mb-2 font-mono text-xs">{CONFIRM_MESSAGE(row.key, confirmState.value)}</p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={rowBusy}
            onClick={() => {
              setConfirmState(null);
              write(row.path, confirmState.value, row.key);
            }}
            className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setConfirmState(null)}
            className="rounded border px-2 py-0.5 text-xs"
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start gap-3 px-2 py-3">
      <span className="w-56 shrink-0 break-all font-mono text-xs">{row.key}</span>
      <Badges row={row} />
      <div className="min-w-0 flex-1">
        <FieldControl row={row} busy={rowBusy} onWrite={onWrite} />
        <Description row={row} />
      </div>
      {row.isSet && !row.readOnly && (
        <button
          type="button"
          disabled={rowBusy}
          onClick={() => onWrite(undefined, { isClear: true })}
          className="shrink-0 rounded border px-2 py-0.5 text-xs disabled:opacity-50"
        >
          Clear
        </button>
      )}
    </li>
  );
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

  const f = filter.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (onlySet && !r.isSet) return false;
    if (!f) return true;
    return r.key.toLowerCase().includes(f) || r.description.toLowerCase().includes(f);
  });

  const grouped = new Map<string, FieldRow[]>();
  for (const r of visible) {
    const g = r.deprecated ? 'Deprecated' : r.group;
    if (r.deprecated && !r.isSet) continue; // deprecated rows hidden unless set
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)?.push(r);
  }

  function write(path: string[], value: unknown, key: string) {
    setPendingKey(key);
    setConfirmState(null);
    startTransition(async () => {
      const r = await action(path, value);
      setResult(r);
      setPendingKey(null);
      if (r.ok) {
        setSavedKey(key);
      }
    });
  }

  const setCount = rows.filter((r) => r.isSet).length;

  return (
    <div className="not-prose flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter settings…"
          className="w-64 rounded border bg-fd-secondary px-3 py-1.5 text-sm"
        />
        <label className="flex items-center gap-1 text-xs text-fd-muted-foreground">
          <input type="checkbox" checked={onlySet} onChange={(e) => setOnlySet(e.target.checked)} />
          Show only set keys
        </label>
        <span className="text-xs text-fd-muted-foreground">
          {setCount} of {rows.length} keys set
        </span>
      </div>
      <ErrorBox result={result} />
      {savedKey && !isPending && (
        <p className="text-xs text-fd-muted-foreground">Saved {savedKey}</p>
      )}
      {groupOrder
        .filter((g) => grouped.has(g))
        .map((g) => (
          <section key={g}>
            <h3 className="mb-1 text-sm font-medium">{g}</h3>
            <ul className="geist-ledger">
              {(grouped.get(g) ?? []).map((row) => (
                <FieldRowView
                  key={row.key}
                  row={row}
                  busy={isPending}
                  pendingKey={pendingKey}
                  confirmState={confirmState}
                  setConfirmState={setConfirmState}
                  write={write}
                />
              ))}
            </ul>
          </section>
        ))}
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
  const [text, setText] = useState('');
  return (
    <li className="flex flex-wrap items-start gap-3 px-2 py-3">
      <span className="w-64 shrink-0 break-all font-mono text-xs">{row.name}</span>
      {row.secret && (
        <span className="rounded-full border px-1.5 py-0 text-[10px] text-fd-muted-foreground">secret</span>
      )}
      {row.deprecated && (
        <span className="rounded-full border border-fd-primary/50 px-1.5 py-0 text-[10px] text-fd-primary">
          deprecated
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {row.options ? (
          <select
            disabled={busy}
            defaultValue={row.value ?? ''}
            onChange={(e) => {
              if (e.target.value === '') write(row.name, undefined);
              else write(row.name, e.target.value);
            }}
            className="rounded border bg-fd-secondary px-2 py-1 text-sm"
          >
            <option value="">— default (unset) —</option>
            {row.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex gap-2">
            <input
              type={row.secret ? 'password' : 'text'}
              defaultValue={row.secret ? '' : (row.value ?? '')}
              placeholder={row.secret && row.isSet ? '•••••••• (set)' : undefined}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              className="min-w-0 flex-1 rounded border bg-fd-secondary px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (row.secret && text === '') return; // never write an empty secret by accident
                write(row.name, text);
              }}
              className="shrink-0 rounded border px-2 py-1 text-xs disabled:opacity-50"
            >
              Save
            </button>
          </div>
        )}
        {row.description && <p className="text-xs text-fd-muted-foreground">{row.description}</p>}
      </div>
      {row.isSet && (
        <button
          type="button"
          disabled={busy}
          onClick={() => write(row.name, undefined)}
          className="shrink-0 rounded border px-2 py-0.5 text-xs disabled:opacity-50"
        >
          Clear
        </button>
      )}
    </li>
  );
}

export function EnvForm({ rows, specs, action }: { rows: EnvRow[]; specs: EnvSpec[]; action: Update }) {
  const [result, setResult] = useState<SetResult | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [addName, setAddName] = useState('');
  const [addValue, setAddValue] = useState('');

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
  const groups = new Map<string, EnvSpec[]>();
  for (const s of specs) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group)?.push(s);
  }

  return (
    <div className="not-prose flex flex-col gap-4">
      <ErrorBox result={result} />
      <section>
        <h3 className="mb-1 text-sm font-medium">Set variables</h3>
        {rows.length === 0 && <p className="text-xs text-fd-muted-foreground">None set.</p>}
        <ul className="geist-ledger">
          {rows.map((row) => (
            <EnvRowView
              key={row.name}
              row={row}
              busy={isPending && pendingName === row.name}
              write={write}
            />
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-1 text-sm font-medium">Add a variable</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            list="env-var-names"
            type="text"
            value={addName}
            onChange={(e) => setAddName(e.target.value.toUpperCase())}
            placeholder="NAME"
            className="w-56 rounded border bg-fd-secondary px-2 py-1 font-mono text-sm"
          />
          <datalist id="env-var-names">
            {specs.map((s) => (
              <option key={s.name} value={s.name} />
            ))}
          </datalist>
          {addSpec?.options ? (
            <select
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              className="rounded border bg-fd-secondary px-2 py-1 text-sm"
            >
              <option value="">choose…</option>
              {addSpec.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={addSpec?.secret ? 'password' : 'text'}
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              placeholder="value"
              className="min-w-0 flex-1 rounded border bg-fd-secondary px-2 py-1 text-sm"
            />
          )}
          <button
            type="button"
            disabled={
              isPending ||
              !/^[A-Z_][A-Z0-9_]*$/.test(addName) ||
              addValue === ''
            }
            onClick={() => write(addName, addValue)}
            className="rounded border px-2 py-1 text-xs disabled:opacity-50"
          >
            Save
          </button>
        </div>
        {addSpec && <p className="mt-1 text-xs text-fd-muted-foreground">{addSpec.description}</p>}
      </section>
      <details>
        <summary className="cursor-pointer text-sm font-medium">All documented variables ({specs.length})</summary>
        <div className="mt-2 flex flex-col gap-3">
          {[...groups.entries()].map(([group, entries]) => (
            <div key={group}>
              <h4 className="mb-1 text-xs font-medium text-fd-muted-foreground">{group}</h4>
              <ul className="geist-ledger">
                {entries.map((s) => (
                  <li key={s.name} className="flex flex-wrap items-baseline gap-2 px-2 py-2 text-xs">
                    <span className="font-mono">{s.name}</span>
                    {s.secret && <span className="text-fd-muted-foreground">(secret)</span>}
                    <span className="min-w-0 flex-1 text-fd-muted-foreground">{s.description}</span>
                    <button
                      type="button"
                      onClick={() => setAddName(s.name)}
                      className="shrink-0 rounded border px-1.5 py-0 text-[10px]"
                    >
                      set…
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

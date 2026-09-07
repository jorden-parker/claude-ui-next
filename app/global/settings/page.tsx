import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { getSettings } from '@/lib/claude/data';
import { GROUP_ORDER, isSecretEnvName, listEnvSpecs, listFields } from '@/lib/claude/settings-schema';
import { EnvForm, SettingsForm, type EnvRow, type FieldRow } from '@/components/settings-form';
import { updateSetting } from './actions';

export const dynamic = 'force-dynamic';

function at(obj: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );
}

export default async function Page() {
  const settings = (await getSettings()) ?? {};
  const fields = listFields();

  const rows: FieldRow[] = fields.map((f) => {
    const value = at(settings, f.path);
    return { ...f, value, isSet: value !== undefined };
  });

  // Unknown top-level keys (schema additionalProperties: true), e.g. modelSettings:
  const known = new Set(fields.map((f) => f.path[0]));
  for (const k of Object.keys(settings)) {
    if (!known.has(k) && k !== 'env' && k !== '$schema') {
      rows.push({
        key: k,
        path: [k],
        kind: 'json',
        description: 'Not in the settings schema; edited as raw JSON.',
        deprecated: false,
        managedOnly: false,
        group: 'Other',
        value: settings[k],
        isSet: true,
      });
    }
  }

  const rawEnv = (settings as Record<string, unknown>).env;
  const envObject: Record<string, unknown> = typeof rawEnv === 'object' && rawEnv !== null && !Array.isArray(rawEnv)
    ? (rawEnv as Record<string, unknown>)
    : {};
  const envWarning = rawEnv !== undefined && Object.keys(envObject).length === 0 && typeof rawEnv !== 'object';

  const envRows: EnvRow[] = Object.entries(envObject).map(([name, value]) => {
    const secret = isSecretEnvName(name);
    const spec = listEnvSpecs().find((s) => s.name === name);
    return {
      name,
      value: secret ? null : String(value),
      isSet: true,
      secret,
      options: spec?.options,
      description: spec?.description ?? 'Not a documented variable.',
      deprecated: spec?.deprecated ?? false,
      group: spec?.group ?? 'Other',
    };
  });

  // Redact secret env values before ever stringifying the raw file for display.
  const redacted: Record<string, unknown> = { ...settings };
  if (typeof redacted.env === 'object' && redacted.env !== null && !Array.isArray(redacted.env)) {
    const redactedEnv: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(redacted.env as Record<string, unknown>)) {
      redactedEnv[name] = isSecretEnvName(name) ? '••••' : value;
    }
    redacted.env = redactedEnv;
  }

  return (
    <DocsPage>
      <DocsTitle>Settings</DocsTitle>
      <DocsDescription className="mb-0 font-mono text-xs">~/.claude/settings.json</DocsDescription>
      <DocsBody>
        <p className="text-sm text-fd-muted-foreground">
          Writes directly to <code className="font-mono">~/.claude/settings.json</code>, backing up the
          previous version to <code className="font-mono">settings.ui-backup.json</code> first. Claude
          Code hot-reloads this file for almost every key — exceptions are{' '}
          <code className="font-mono">outputStyle</code>, the <code className="font-mono">forceLogin*</code>{' '}
          keys, and <code className="font-mono">autoUpdatesChannel</code> (take effect next start), and{' '}
          <code className="font-mono">model</code> (next session). Deny rules live on the{' '}
          <a href="/global/tools">Tools page</a>.
        </p>

        <h2>Keys</h2>
        <SettingsForm rows={rows} groupOrder={GROUP_ORDER} action={updateSetting} />

        <h2>Environment variables</h2>
        <p className="text-sm text-fd-muted-foreground">
          These go into the <code className="font-mono">env</code> object and apply to every Claude Code
          session that reads this file.
        </p>
        {envWarning && (
          <p className="text-sm text-fd-muted-foreground">
            <code className="font-mono">env</code> in settings.json is not an object; showing an empty list.
          </p>
        )}
        <EnvForm rows={envRows} specs={listEnvSpecs()} action={updateSetting} />

        <h2>Raw file</h2>
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            ~/.claude/settings.json (secrets redacted)
          </summary>
          <pre className="overflow-x-auto rounded bg-fd-secondary p-2 text-xs">
            {JSON.stringify(redacted, null, 2)}
          </pre>
        </details>
      </DocsBody>
    </DocsPage>
  );
}

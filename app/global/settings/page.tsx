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
    <DocsPage full>
      <DocsTitle>Settings</DocsTitle>
      <DocsDescription className="mb-0 font-mono text-xs">~/.claude/settings.json</DocsDescription>
      <DocsBody>
        <p className="text-sm text-fd-muted-foreground">
          Every edit writes this file and backs up the previous version to{' '}
          <code className="font-mono">settings.ui-backup.json</code>. Most keys hot-reload;{' '}
          <code className="font-mono">outputStyle</code>, <code className="font-mono">forceLogin*</code>{' '}
          and <code className="font-mono">autoUpdatesChannel</code> take effect at next start,{' '}
          <code className="font-mono">model</code> at next session. Deny rules live on the{' '}
          <a href="/global/tools">Tools page</a>.
        </p>

        <h2>Keys</h2>
        <SettingsForm rows={rows} groupOrder={GROUP_ORDER} action={updateSetting} />

        <h2>Environment variables</h2>
        <p className="text-sm text-fd-muted-foreground">
          The <code className="font-mono">env</code> object, applied to every session that reads this file.
        </p>
        {envWarning && (
          <p className="text-sm text-fd-muted-foreground">
            <code className="font-mono">env</code> in settings.json is not an object; showing an empty list.
          </p>
        )}
        <EnvForm rows={envRows} specs={listEnvSpecs()} action={updateSetting} />

        <h2>Raw file</h2>
        <details className="not-prose">
          <summary className="cursor-pointer list-none border-b border-fd-border py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="mr-3 font-mono text-xs text-fd-muted-foreground">+</span>
            Show JSON, secrets redacted
          </summary>
          <pre className="mt-3 overflow-x-auto rounded-md border border-fd-border bg-fd-muted p-3 text-xs">
            {JSON.stringify(redacted, null, 2)}
          </pre>
        </details>
      </DocsBody>
    </DocsPage>
  );
}

// Vendored from https://json.schemastore.org/claude-code-settings.json on 2026-09-07.
// Refresh: curl -sL -o lib/claude/settings-schema.json https://json.schemastore.org/claude-code-settings.json

import schema from './settings-schema.json';

export type Kind =
  | 'boolean' | 'enum' | 'enumOrCustom' | 'integer' | 'number'
  | 'string' | 'stringList' | 'enumList' | 'json';

export interface Field {
  /** Dot-joined path, e.g. "permissions.defaultMode". */
  key: string;
  path: string[];
  kind: Kind;
  /** For enum / enumOrCustom / enumList. */
  options?: string[];
  /** For enumOrCustom: the regex the custom value must match (source string). */
  customPattern?: string;
  default?: unknown;
  min?: number;
  max?: number;
  description: string;
  /** First https://… URL found in the description, if any. */
  docsUrl?: string;
  deprecated: boolean;
  managedOnly: boolean;
  group: string;
}

export interface EnvSpec {
  name: string;
  description: string;
  options?: string[];
  secret: boolean;
  deprecated: boolean;
  group: string;
}

// ---- schema plumbing -------------------------------------------------

// biome-ignore-start -- schema is arbitrary JSON, typed loosely on purpose
export type SchemaNode = Record<string, any>;
// biome-ignore-end

const root: SchemaNode = schema as unknown as SchemaNode;
const defs: Record<string, SchemaNode> = root.$defs ?? {};

function resolveRef(node: SchemaNode): SchemaNode {
  if (node && typeof node === 'object' && typeof node.$ref === 'string') {
    const m = /^#\/\$defs\/(.+)$/.exec(node.$ref);
    if (m && defs[m[1]]) return resolveRef(defs[m[1]]);
    return { type: 'json-unresolved-ref' };
  }
  return node;
}

/** Resolve a path to its schema node, following $ref; null if the path is not in the schema. */
export function resolveNode(path: string[]): SchemaNode | null {
  let node: SchemaNode = resolveRef(root);
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    if (!node || typeof node !== 'object') return null;
    const props = node.properties as Record<string, SchemaNode> | undefined;
    if (props && Object.prototype.hasOwnProperty.call(props, segment)) {
      node = resolveRef(props[segment]);
      continue;
    }
    // env.<NAME> synthetic fallback for undocumented but legal names. Only a direct
    // ['env', NAME] path qualifies — env vars are flat strings, so a deeper path like
    // ['env', 'MY', 'deep'] must not resolve to anything writable.
    if (path[0] === 'env' && i === 1 && path.length === 2 && ENV_NAME.test(segment)) {
      return { type: 'string' };
    }
    // Unknown top-level key: schema declares additionalProperties: true at root.
    if (i === 0 && path.length === 1 && root.additionalProperties === true) {
      return { type: 'any' };
    }
    return null;
  }
  return node;
}

// ---- kind derivation ---------------------------------------------------

function kindOf(node: SchemaNode): {
  kind: Kind;
  options?: string[];
  customPattern?: string;
  min?: number;
  max?: number;
} {
  node = resolveRef(node);
  if (!node || typeof node !== 'object') return { kind: 'json' };

  if (node.type === 'boolean') return { kind: 'boolean' };

  if (node.const !== undefined) return { kind: 'enum', options: [String(node.const)] };

  if (Array.isArray(node.enum)) return { kind: 'enum', options: node.enum.map(String) };

  if (Array.isArray(node.anyOf)) {
    const enumBranch = node.anyOf.find((b: SchemaNode) => Array.isArray(b.enum));
    const patternBranch = node.anyOf.find((b: SchemaNode) => typeof b.pattern === 'string');
    if (enumBranch && patternBranch) {
      return {
        kind: 'enumOrCustom',
        options: enumBranch.enum.map(String),
        customPattern: patternBranch.pattern,
      };
    }
    return { kind: 'json' };
  }

  if (node.type === 'integer') {
    let min = typeof node.minimum === 'number' ? node.minimum : undefined;
    if (typeof node.exclusiveMinimum === 'number') min = node.exclusiveMinimum + 1;
    return { kind: 'integer', min, max: node.maximum };
  }
  if (node.type === 'number') {
    return { kind: 'number', min: node.minimum, max: node.maximum };
  }

  if (node.type === 'string') return { kind: 'string' };

  if (node.type === 'array') {
    const items = resolveRef(node.items ?? {});
    if (items && Array.isArray(items.enum)) {
      return { kind: 'enumList', options: items.enum.map(String) };
    }
    if (items && items.type === 'string' && !items.enum) {
      return { kind: 'stringList' };
    }
    return { kind: 'json' };
  }

  return { kind: 'json' };
}

function firstUrl(description: string): string | undefined {
  const m = /https?:\/\/\S+/.exec(description);
  if (!m) return undefined;
  return m[0].replace(/[.)]+$/, '');
}

const MANAGED_ONLY_RE =
  /managed settings only|only in managed|only takes effect in managed|managed-only|enterprise/i;
const DEPRECATED_RE = /deprecated/i;

// ---- grouping ------------------------------------------------------------

const GROUP_RULES: [string, RegExp][] = [
  [
    'Model & reasoning',
    /^(model|fallbackModel|availableModels|enforceAvailableModels|modelPicker|modelOverrides|advisorModel|teammateDefaultModel|effortLevel|alwaysThinkingEnabled|showThinkingSummaries|fastMode|fastModePerSessionOptIn|promptCacheTtl|subagentPromptCacheTtl|agent|autoCompactEnabled|autoCompactWindow)$/,
  ],
  [
    'Permissions',
    /^(permissions\.|autoMode\.|disableAutoMode|useAutoModeDuringPlan|skipAutoPermissionPrompt|skipDangerousModePermissionPrompt|skipWebFetchPreflight)/,
  ],
  ['Sandbox', /^sandbox\./],
  ['Hooks', /^(hooks|disableAllHooks|allowedHttpHookUrls|httpHookAllowedEnvVars)$/],
  [
    'Plugins & marketplaces',
    /^(enabledPlugins|extraKnownMarketplaces|strictKnownMarketplaces|blockedMarketplaces|skippedMarketplaces|skippedPlugins|pluginConfigs|skipDangerousPluginsCheck|pluginSuggestionMarketplaces|pluginTrustMessage|disableCommandPluginSources|disableSideloadFlags|allowedChannelPlugins|channelsEnabled)$/,
  ],
  [
    'MCP',
    /^(enableAllProjectMcpServers|enabledMcpjsonServers|disabledMcpjsonServers|allowedMcpServers|deniedMcpServers|managedMcpServers|allowManagedMcpServersOnly|allowAllClaudeAiMcps|disableClaudeAiConnectors)$/,
  ],
  [
    'Skills & workflows',
    /^(skillOverrides|skillListing|disableBundledSkills|disableSkillShellExecution|syncClaudeAiSkills|disableWorkflows|enableWorkflows|workflow|plansDirectory|useWorktreesForRoutines|worktree\.)/,
  ],
  [
    'Memory & sessions',
    /^(autoMemory|cleanupPeriodDays|desktopSessionCleanupPeriodDays|fileCheckpointingEnabled|claudeMdExcludes|includeGitInstructions|attribution\.|includeCoAuthoredBy|prUrlTemplate|footerLinksRegexes)/,
  ],
  [
    'Interface',
    /^(theme|tui|viewMode|editorMode|vimInsertModeRemaps|statusLine\.|subagentStatusLine\.|spinner|terminalProgressBarEnabled|showTurnDuration|prefersReducedMotion|autoScrollEnabled|emojiCompletionEnabled|promptSuggestionEnabled|respectGitignore|fileSuggestion\.|defaultShell|respondToBashCommands|bashOutputMaxChars|language|outputStyle|showClearContextOnPlanAccept|awaySummaryEnabled|diffTool|externalEditorContext|autoConnectIde|autoInstallIdeExtension|axScreenReader|verbose|spellcheck|enableArtifact|disableArtifact)/,
  ],
  [
    'Notifications & voice',
    /^(preferredNotifChannel|inputNeededNotifEnabled|agentPushNotifEnabled|voice\.|askUserQuestionTimeout|dialogExpiry)/,
  ],
  [
    'Remote & agents',
    /^(remoteControlAtStartup|disableRemoteControl|remote\.|crossSessionInbound|isolatePeerMachines|teammate|disableAgentView|sshConfigs|sshHostAllowlist)/,
  ],
  [
    'Auth & providers',
    /^(apiKeyHelper|forceLogin|awsAuthRefresh|awsCredentialExport|gcpAuthRefresh|otelHeadersHelper)/,
  ],
  [
    'Updates & telemetry',
    /^(autoUpdatesChannel|minimumVersion|requiredMinimumVersion|requiredMaximumVersion|feedbackSurveyRate|feedbackDrafts|companyAnnouncements|disableDeepLinkRegistration)/,
  ],
  [
    'Managed / enterprise',
    /^(policyHelper\.|parentSettingsBehavior|managedSourcesBehavior|allowManaged|forceRemoteSettingsRefresh|claudeMd$|strictPluginOnlyCustomization|modelPricing|browserExternalPageTools|disableBrowserExternalNavigation|disableMobileSimulatorTools|disableDesktopLocalSessions|requireCoworkFullVmSandbox|wslInheritsWindowsSettings|processWrapper)/,
  ],
];

export const GROUP_ORDER: string[] = [...GROUP_RULES.map(([name]) => name), 'Other', 'Deprecated'];

function groupOf(key: string): string {
  for (const [name, re] of GROUP_RULES) {
    if (re.test(key)) return name;
  }
  return 'Other';
}

// ---- field flattening ------------------------------------------------

let cachedFields: Field[] | null = null;

/** Every editable field, flattened, in schema order. Excludes `$schema` and `env`. */
export function listFields(): Field[] {
  if (cachedFields) return cachedFields;
  const fields: Field[] = [];

  function walk(node: SchemaNode, path: string[]) {
    const key = path.join('.');
    if (key === 'hooks') {
      pushField(node, path);
      return;
    }
    const resolved = resolveRef(node);
    if (resolved.type === 'object' && resolved.properties && typeof resolved.properties === 'object') {
      for (const childKey of Object.keys(resolved.properties)) {
        walk(resolved.properties[childKey], [...path, childKey]);
      }
      return;
    }
    pushField(node, path);
  }

  function pushField(node: SchemaNode, path: string[]) {
    const key = path.join('.');
    // Owned by the Tools page, which edits it as tool switches. Listing it here too
    // would be the same setting in two places.
    if (key === 'permissions.deny') return;
    const resolved = resolveRef(node);
    const { kind, options, customPattern, min, max } = kindOf(node);
    const description: string = typeof resolved.description === 'string' ? resolved.description : '';
    const deprecated = resolved.deprecated === true || DEPRECATED_RE.test(description);
    const managedOnly = MANAGED_ONLY_RE.test(description);
    const field: Field = {
      key,
      path,
      kind,
      options,
      customPattern,
      default: resolved.default,
      min,
      max,
      description,
      docsUrl: firstUrl(description),
      deprecated,
      managedOnly,
      group: groupOf(key),
    };
    fields.push(field);
  }

  const properties = root.properties as Record<string, SchemaNode>;
  for (const key of Object.keys(properties)) {
    if (key === '$schema' || key === 'env') continue;
    walk(properties[key], [key]);
  }

  cachedFields = fields;
  return fields;
}

// ---- env vars -----------------------------------------------------------

const SECRET_RE = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/;
const NOT_SECRET = new Set([
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
  'CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'MAX_MCP_OUTPUT_TOKENS',
  'MAX_THINKING_TOKENS',
]);

/** True for names that must be masked. Applies to custom names too. */
export function isSecretEnvName(name: string): boolean {
  return SECRET_RE.test(name) && !NOT_SECRET.has(name);
}

/** Valid custom env var name. */
export const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

function envGroupOf(name: string): string {
  if (name.startsWith('ANTHROPIC_')) return 'Anthropic & providers';
  if (name.startsWith('CLAUDE_CODE_') || name.startsWith('CLAUDE_')) return 'Claude Code';
  if (name.startsWith('DISABLE_') || name.startsWith('ENABLE_') || name.startsWith('FORCE_')) {
    return 'Feature switches';
  }
  if (name.startsWith('OTEL_')) return 'Telemetry (OTel)';
  if (name.startsWith('MCP_')) return 'MCP';
  if (
    name.startsWith('BASH_') ||
    name.startsWith('API_') ||
    name.startsWith('HTTP') ||
    name.startsWith('HTTPS') ||
    name.startsWith('NO_PROXY') ||
    name.startsWith('USE_')
  ) {
    return 'Runtime';
  }
  return 'Other';
}

let cachedEnvSpecs: EnvSpec[] | null = null;

/** Documented env vars in schema order. */
export function listEnvSpecs(): EnvSpec[] {
  if (cachedEnvSpecs) return cachedEnvSpecs;
  const envProps = (root.properties.env.properties ?? {}) as Record<string, SchemaNode>;
  const specs: EnvSpec[] = [];
  for (const name of Object.keys(envProps)) {
    const node = envProps[name];
    const description: string = typeof node.description === 'string' ? node.description : '';
    specs.push({
      name,
      description,
      options: Array.isArray(node.enum) ? node.enum.map(String) : undefined,
      secret: isSecretEnvName(name),
      deprecated: node.deprecated === true || DEPRECATED_RE.test(description),
      group: envGroupOf(name),
    });
  }
  cachedEnvSpecs = specs;
  return specs;
}

// ---- validation -----------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a value against a node. Returns null when valid, else a human-readable reason. */
export function validate(node: SchemaNode | null, value: unknown): string | null {
  if (node === null) return 'not a setting this app may write.';
  if (value === undefined) return null; // deleting is always valid

  if (typeof node.$ref === 'string') {
    return validate(resolveRef(node), value);
  }

  if (node.type === 'any') {
    try {
      if (typeof JSON.stringify(value) !== 'string') return 'value is not JSON-serialisable.';
    } catch {
      return 'value is not JSON-serialisable.';
    }
    return null;
  }

  if (node.const !== undefined) {
    return value === node.const ? null : `must be ${JSON.stringify(node.const)}.`;
  }

  if (Array.isArray(node.enum)) {
    return node.enum.includes(value) ? null : `must be one of ${node.enum.join(', ')}.`;
  }

  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    const branches: SchemaNode[] = node.anyOf ?? node.oneOf;
    for (const branch of branches) {
      if (validate(branch, value) === null) return null;
    }
    return 'does not match any allowed shape.';
  }

  const types: string[] | undefined = Array.isArray(node.type)
    ? node.type
    : node.type
      ? [node.type]
      : undefined;

  if (types) {
    let lastErr: string | null = null;
    for (const t of types) {
      const err = validateType(node, value, t);
      if (err === null) return null;
      lastErr = err;
    }
    if (types.length === 1) return lastErr;
    return `must be one of type: ${types.join(', ')}.`;
  }

  // No type, no enum, no anyOf/oneOf: anything is valid.
  return null;
}

function validateType(node: SchemaNode, value: unknown, type: string): string | null {
  switch (type) {
    case 'null':
      return value === null ? null : 'must be null.';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be a boolean.';
    case 'integer': {
      if (!Number.isInteger(value)) return 'must be an integer.';
      return checkRange(node, value as number);
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number.';
      return checkRange(node, value);
    }
    case 'string': {
      if (typeof value !== 'string') return 'must be a string.';
      if (typeof node.pattern === 'string') {
        let re: RegExp;
        try {
          re = new RegExp(node.pattern);
        } catch {
          return null;
        }
        if (!re.test(value)) return `must match pattern ${node.pattern}.`;
      }
      if (typeof node.minLength === 'number' && value.length < node.minLength) {
        return `must be at least ${node.minLength} characters.`;
      }
      return null;
    }
    case 'array': {
      if (!Array.isArray(value)) return 'must be an array.';
      if (node.items) {
        for (const item of value) {
          const err = validate(node.items, item);
          if (err !== null) return `item ${JSON.stringify(item)} ${err}`;
        }
      }
      if (typeof node.minItems === 'number' && value.length < node.minItems) {
        return `must have at least ${node.minItems} items.`;
      }
      if (node.uniqueItems === true) {
        const seen = new Set(value.map((v) => JSON.stringify(v)));
        if (seen.size !== value.length) return 'must not have duplicate items.';
      }
      return null;
    }
    case 'object': {
      if (!isPlainObject(value)) return 'must be an object.';
      const props: Record<string, SchemaNode> | undefined = node.properties;
      if (props) {
        for (const k of Object.keys(value)) {
          if (Object.prototype.hasOwnProperty.call(props, k)) {
            const err = validate(props[k], value[k]);
            if (err !== null) return `${k}: ${err}`;
          } else if (node.additionalProperties === false) {
            return `unknown key ${k}.`;
          } else if (node.additionalProperties && typeof node.additionalProperties === 'object') {
            const err = validate(node.additionalProperties, value[k]);
            if (err !== null) return `${k}: ${err}`;
          }
        }
      }
      if (Array.isArray(node.required)) {
        for (const r of node.required) {
          if (!(r in value)) return `missing required key ${r}.`;
        }
      }
      return null;
    }
    default:
      return null;
  }
}

function checkRange(node: SchemaNode, value: number): string | null {
  if (typeof node.minimum === 'number' && value < node.minimum) {
    return `must be >= ${node.minimum}.`;
  }
  if (typeof node.exclusiveMinimum === 'number' && value <= node.exclusiveMinimum) {
    return `must be > ${node.exclusiveMinimum}.`;
  }
  if (typeof node.maximum === 'number' && value > node.maximum) {
    return `must be <= ${node.maximum}.`;
  }
  if (typeof node.exclusiveMaximum === 'number' && value >= node.exclusiveMaximum) {
    return `must be < ${node.exclusiveMaximum}.`;
  }
  return null;
}

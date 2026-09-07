export interface ToolInfo {
  name: string;
  purpose: string;
  group: 'files' | 'shell' | 'search' | 'web' | 'agents' | 'tasks' | 'planning' | 'notebooks' | 'ui' | 'mcp' | 'system';
  /** Denying this is refused: it is either exempt from deny rules or would break the app itself. */
  protected?: boolean;
  /** Switching this off cripples ordinary use. Allowed, but the UI demands a second confirmation. */
  core?: boolean;
}

/**
 * Built-in tools as of Claude Code 2.1.263 (2026-09-07), using the canonical
 * permission-rule names from https://code.claude.com/docs/en/tools-reference.
 * Names are case-sensitive and must match exactly.
 */
export const TOOL_CATALOG: ToolInfo[] = [
  { name: 'Agent', purpose: 'Spawns a subagent with its own context window.', group: 'agents' },
  { name: 'Artifact', purpose: 'Publishes an HTML or Markdown page.', group: 'ui' },
  { name: 'AskUserQuestion', purpose: 'Asks the user multiple-choice questions.', group: 'ui' },
  { name: 'Bash', purpose: 'Runs shell commands.', group: 'shell', core: true },
  { name: 'CronCreate', purpose: 'Schedules a recurring prompt within a session.', group: 'tasks' },
  { name: 'CronDelete', purpose: 'Deletes a scheduled prompt.', group: 'tasks' },
  { name: 'CronList', purpose: 'Lists scheduled prompts.', group: 'tasks' },
  { name: 'Edit', purpose: 'Makes targeted edits to a file.', group: 'files', core: true },
  {
    name: 'EndConversation',
    purpose: 'Ends the session on sustained abuse.',
    group: 'system',
    protected: true,
  },
  { name: 'EnterPlanMode', purpose: 'Enters plan mode.', group: 'planning' },
  { name: 'ExitPlanMode', purpose: 'Leaves plan mode with a plan for approval.', group: 'planning' },
  { name: 'EnterWorktree', purpose: 'Moves work into an isolated git worktree.', group: 'system' },
  { name: 'ExitWorktree', purpose: 'Leaves an isolated git worktree.', group: 'system' },
  { name: 'Glob', purpose: 'Finds files by name pattern.', group: 'search', core: true },
  { name: 'Grep', purpose: 'Searches file contents.', group: 'search', core: true },
  { name: 'ListAgents', purpose: 'Lists agents and sessions you can message.', group: 'agents' },
  { name: 'ListMcpResourcesTool', purpose: 'Lists resources exposed by MCP servers.', group: 'mcp' },
  { name: 'ReadMcpResourceTool', purpose: 'Reads one resource from an MCP server.', group: 'mcp' },
  { name: 'LSP', purpose: 'Language-server code intelligence.', group: 'search' },
  { name: 'Monitor', purpose: 'Runs a command in the background and feeds its output back.', group: 'shell' },
  { name: 'NotebookEdit', purpose: 'Edits cells in a Jupyter notebook.', group: 'notebooks' },
  { name: 'PowerShell', purpose: 'Runs PowerShell commands.', group: 'shell' },
  { name: 'PushNotification', purpose: 'Sends a desktop or phone push notification.', group: 'ui' },
  { name: 'Read', purpose: 'Reads files from disk.', group: 'files', core: true },
  { name: 'RemoteTrigger', purpose: 'Manages Routines on claude.ai.', group: 'system' },
  { name: 'ReportFindings', purpose: 'Reports structured code-review findings.', group: 'ui' },
  { name: 'ScheduleWakeup', purpose: 'Reschedules a self-paced /loop.', group: 'tasks' },
  { name: 'SendFeedback', purpose: 'Drafts feedback about Claude Code.', group: 'system' },
  { name: 'SendMessage', purpose: 'Messages another agent or session.', group: 'agents' },
  { name: 'SendUserFile', purpose: "Sends a file to the user's device.", group: 'ui' },
  { name: 'ShareOnboardingGuide', purpose: 'Uploads ONBOARDING.md and returns a link.', group: 'ui' },
  { name: 'Skill', purpose: 'Runs a skill in the main conversation.', group: 'system', core: true },
  { name: 'TaskCreate', purpose: 'Creates a task in the task list.', group: 'tasks' },
  { name: 'TaskGet', purpose: 'Reads one task.', group: 'tasks' },
  { name: 'TaskList', purpose: 'Lists tasks.', group: 'tasks' },
  { name: 'TaskOutput', purpose: 'Reads the output of a background task.', group: 'tasks' },
  { name: 'TaskStop', purpose: 'Stops a background task.', group: 'tasks' },
  { name: 'TaskUpdate', purpose: 'Updates a task.', group: 'tasks' },
  { name: 'TodoWrite', purpose: 'Keeps a checklist for the session.', group: 'planning' },
  {
    name: 'ToolSearch',
    purpose: 'Loads deferred tool definitions on demand.',
    group: 'system',
    protected: true,
  },
  {
    name: 'WaitForMcpServers',
    purpose: 'Waits for MCP servers that are still connecting.',
    group: 'mcp',
    protected: true,
  },
  { name: 'WebFetch', purpose: 'Fetches the contents of a URL.', group: 'web' },
  { name: 'WebSearch', purpose: 'Searches the web.', group: 'web' },
  { name: 'Workflow', purpose: 'Orchestrates multiple subagents from a script.', group: 'agents' },
  { name: 'Write', purpose: 'Creates or overwrites a file.', group: 'files', core: true },
];

export interface Preset {
  id: string;
  label: string;
  description: string;
  /** Bare permission-rule names. Never a specifier, never "*". */
  tools: string[];
}

export const PRESETS: Preset[] = [
  {
    id: 'notebooks',
    label: 'No Jupyter notebooks',
    description: 'Removes NotebookEdit. Claude can no longer edit .ipynb cells.',
    tools: ['NotebookEdit'],
  },
  {
    id: 'windows',
    label: 'No PowerShell',
    description: 'Removes PowerShell. Only relevant if you never work on Windows.',
    tools: ['PowerShell'],
  },
  {
    id: 'web',
    label: 'No web access',
    description: 'Removes WebFetch and WebSearch. Claude can no longer read URLs or search the web.',
    tools: ['WebFetch', 'WebSearch'],
  },
  {
    id: 'scheduling',
    label: 'No cron & background tasks',
    description:
      'Removes the cron, wakeup and task tools. Claude can no longer schedule work or run tasks in the background.',
    tools: [
      'CronCreate',
      'CronDelete',
      'CronList',
      'ScheduleWakeup',
      'TaskCreate',
      'TaskGet',
      'TaskList',
      'TaskOutput',
      'TaskStop',
      'TaskUpdate',
    ],
  },
  {
    id: 'orchestration',
    label: 'No multi-agent orchestration',
    description:
      'Removes Workflow, ListAgents and SendMessage. The Agent tool is left alone — it is kept separately because subagents are the common case.',
    tools: ['Workflow', 'ListAgents', 'SendMessage'],
  },
  {
    id: 'mcp-all',
    label: 'No MCP tools at all',
    description:
      'Removes every MCP tool, including claude.ai connectors and Chrome control, from every session.',
    tools: ['mcp__*'],
  },
];

/** Catalog names that may be written as deny rules (everything except `protected` entries). */
export function writableCatalogRules(): Set<string> {
  return new Set(TOOL_CATALOG.filter((t) => !t.protected).map((t) => t.name));
}

/** Matches a single MCP tool name: mcp__<server>__<tool>, segments of [A-Za-z0-9_-]. */
const MCP_TOOL = /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/;

/**
 * True if this exact string is a deny rule the app is permitted to write.
 * Written as an allowlist on purpose: anything not matched here is refused.
 */
export function isWritableRule(rule: string): boolean {
  if (typeof rule !== 'string') return false;
  if (writableCatalogRules().has(rule)) return true;
  if (rule === 'mcp__*') return true;
  if (MCP_TOOL.test(rule)) return true;
  return false;
}

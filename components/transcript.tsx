import Link from 'next/link';
import type { TranscriptBlock } from '@/lib/claude/data';
import { Markdown } from './markdown';

const CLAMP = 4000;

function clamp(text: string): string {
  return text.length > CLAMP ? `${text.slice(0, CLAMP)}\n… (${text.length - CLAMP} chars truncated)` : text;
}

function blockTime(timestamp?: string): string | null {
  if (!timestamp) return null;
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', { hour12: false });
}

export interface TranscriptLinks {
  /** Parent tool_use id → href of the subagent transcript page. */
  subagents: Map<string, { href: string; label: string }>;
  /** Base href for persisted outputs; `${outputBase}/${file}` is the page. */
  outputBase: string;
}

/**
 * Turns are separated by a rule and a label, not by a card each. Geist keeps
 * the page one continuous canvas; only the tool blocks earn a surface, because
 * they are collapsed machine output rather than reading material.
 */
function Block({ block, links }: { block: TranscriptBlock; links?: TranscriptLinks }) {
  switch (block.kind) {
    case 'text':
      if (block.role === 'user') {
        const time = blockTime(block.timestamp);
        return (
          <div className="border-l-2 border-fd-foreground pl-4">
            <div className="mb-1 flex items-baseline justify-between gap-4">
              <span className="text-sm font-medium">You</span>
              {time && (
                <span className="geist-numeric font-mono text-xs text-fd-muted-foreground">{time}</span>
              )}
            </div>
            <div className="prose prose-sm max-w-[68ch] break-words text-sm">
              <Markdown text={clamp(block.text)} />
            </div>
          </div>
        );
      }
      return (
        <div className="prose prose-sm max-w-[68ch] break-words text-sm">
          <Markdown text={clamp(block.text)} />
        </div>
      );
    case 'thinking':
      return (
        <details className="border-l border-fd-border pl-4 text-sm text-fd-muted-foreground">
          <summary className="cursor-pointer select-none text-xs marker:text-fd-muted-foreground">
            Thinking
          </summary>
          <div className="mt-2 max-w-[68ch] whitespace-pre-wrap break-words">{clamp(block.text)}</div>
        </details>
      );
    case 'tool-use': {
      const sub = links?.subagents.get(block.id);
      return (
        <details className="rounded-md border border-fd-border px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none font-mono text-xs">
            <span className="font-medium">{block.name}</span>
            {sub && (
              <Link href={sub.href} className="ml-2 font-sans text-fd-muted-foreground underline">
                Open subagent · {sub.label}
              </Link>
            )}
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-sm bg-fd-muted p-2 text-xs">
            {clamp(JSON.stringify(block.input, null, 2) ?? '')}
          </pre>
        </details>
      );
    }
    case 'tool-result':
      return (
        <details className="rounded-md border border-fd-border px-3 py-2 text-sm">
          <summary
            className={`cursor-pointer select-none font-mono text-xs ${
              block.isError ? 'text-fd-error' : 'text-fd-muted-foreground'
            }`}
          >
            {block.isError ? '✗ Result (error)' : '✓ Result'}
            {block.persistedFile && links && (
              <Link
                href={`${links.outputBase}/${encodeURIComponent(block.persistedFile)}`}
                className="ml-2 font-sans underline"
              >
                Full output
              </Link>
            )}
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-sm bg-fd-muted p-2 text-xs whitespace-pre-wrap break-words">
            {clamp(block.text)}
          </pre>
        </details>
      );
  }
}

export function Transcript({ blocks, links }: { blocks: TranscriptBlock[]; links?: TranscriptLinks }) {
  return (
    <div className="flex flex-col gap-6">
      {blocks.map((block, i) => (
        <Block key={i} block={block} links={links} />
      ))}
    </div>
  );
}

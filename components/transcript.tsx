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

function Block({ block }: { block: TranscriptBlock }) {
  switch (block.kind) {
    case 'text':
      if (block.role === 'user') {
        const time = blockTime(block.timestamp);
        return (
          <div className="rounded-lg border bg-fd-secondary px-4 py-3">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">User</span>
              {time && <span className="font-mono text-xs text-fd-muted-foreground">{time}</span>}
            </div>
            <div className="prose prose-sm max-w-none break-words text-sm">
              <Markdown text={clamp(block.text)} />
            </div>
          </div>
        );
      }
      return (
        <div className="prose prose-sm max-w-none px-1 text-sm">
          <Markdown text={clamp(block.text)} />
        </div>
      );
    case 'thinking':
      return (
        <details className="rounded-lg border border-dashed px-4 py-2 text-sm text-fd-muted-foreground">
          <summary className="cursor-pointer select-none text-xs">Thinking</summary>
          <div className="mt-2 whitespace-pre-wrap break-words">{clamp(block.text)}</div>
        </details>
      );
    case 'tool-use':
      return (
        <details className="rounded-lg border bg-fd-card px-4 py-2 text-sm">
          <summary className="cursor-pointer select-none font-mono text-xs">
            <span className="text-fd-primary">{block.name}</span>
          </summary>
          <pre className="mt-2 overflow-x-auto rounded bg-fd-secondary p-2 text-xs">
            {clamp(JSON.stringify(block.input, null, 2) ?? '')}
          </pre>
        </details>
      );
    case 'tool-result':
      return (
        <details className="rounded-lg border px-4 py-2 text-sm">
          <summary className="cursor-pointer select-none font-mono text-xs text-fd-muted-foreground">
            {block.isError ? '✗ result (error)' : '✓ result'}
          </summary>
          <pre className="mt-2 overflow-x-auto rounded bg-fd-secondary p-2 text-xs whitespace-pre-wrap break-words">
            {clamp(block.text)}
          </pre>
        </details>
      );
  }
}

export function Transcript({ blocks }: { blocks: TranscriptBlock[] }) {
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

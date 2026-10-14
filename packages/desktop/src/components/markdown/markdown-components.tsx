import { lazy, Suspense, type ReactElement, type ReactNode, type RefObject } from "react";
import type { Components } from "streamdown";
import { CodeBlockShell } from "@/components/CodeBlockShell";
import { MarkdownImg } from "@/components/markdown-image";
import { highlightCode } from "@/components/markdown/highlight-cache";
import { MarkdownLink } from "@/components/markdown/markdown-link";
import { LargeCodeBlock, isLargeCodeBlock } from "@/components/markdown/LargeCodeBlock";

const MermaidDiagram = lazy(() => import("@/components/MermaidDiagram"));
const SHELL_LANGUAGES = new Set(["bash", "sh", "zsh", "shell", "console", "terminal"]);

function extractText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (children && typeof children === "object" && "props" in children) {
    const element = children as React.ReactElement<{ children?: ReactNode }>;
    return extractText(element.props.children);
  }
  return "";
}

function isFenceClosed(
  content: string,
  node?: { position?: { end?: { line?: number } } },
): boolean {
  const endLine = node?.position?.end?.line;
  if (endLine == null) return true;
  const lastLine = content.split("\n")[endLine - 1];
  return lastLine !== undefined && /^\s{0,3}(```|~~~)/.test(lastLine);
}

function MermaidFallback({ code }: { code: string }): ReactElement {
  return (
    <CodeBlockShell language="mermaid" code={code}>
      <div className="p-3 text-xs text-muted-foreground">Loading diagram…</div>
    </CodeBlockShell>
  );
}

interface MarkdownComponentOptions {
  contentRef: RefObject<string>;
  sendToTerminal?: (command: string) => void;
  isSettled: boolean;
  isStreaming: boolean;
  cacheHighlights?: boolean;
}

function buildCodeComponent({
  contentRef,
  sendToTerminal,
  isSettled,
  isStreaming,
  cacheHighlights = isSettled,
}: MarkdownComponentOptions): NonNullable<Components["code"]> {
  return ({ className, children, node, ...props }) => {
    const match = /language-(\w+)/.exec(className || "");
    const isBlock = node?.position && node.position.start.line !== node.position.end.line;
    if (match || isBlock) {
      const lang = match?.[1] ?? "text";
      const code = extractText(children).replace(/\n$/, "");
      if (lang === "mermaid" && isSettled && isFenceClosed(contentRef.current, node)) {
        return (
          <Suspense fallback={<MermaidFallback code={code} />}>
            <MermaidDiagram code={code} />
          </Suspense>
        );
      }
      const showTerminalButton = SHELL_LANGUAGES.has(lang) && !!sendToTerminal;
      if (isLargeCodeBlock(code)) {
        return (
          <LargeCodeBlock
            language={lang}
            code={code}
            isStreaming={isStreaming}
            showTerminalButton={showTerminalButton}
            onSendToTerminal={sendToTerminal}
          />
        );
      }
      const highlighted = highlightCode(lang, code, { cache: cacheHighlights }) ?? children;
      return (
        <CodeBlockShell
          language={lang}
          code={code}
          showTerminalButton={showTerminalButton}
          onSendToTerminal={sendToTerminal}
        >
          <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
            <code className="hljs">{highlighted}</code>
          </pre>
        </CodeBlockShell>
      );
    }
    return (
      <code
        className="rounded bg-[color-mix(in_oklab,var(--acc-pink)_7%,transparent)] px-1 py-0.5 text-xs font-mono text-[color-mix(in_oklab,var(--acc-pink)_45%,var(--acc-purple))]"
        {...props}
      >
        {children}
      </code>
    );
  };
}

export function buildMarkdownComponents({
  contentRef,
  sendToTerminal,
  isSettled,
  isStreaming,
  cacheHighlights = isSettled,
}: MarkdownComponentOptions): Components {
  return {
    h1: ({ children }) => (
      <h1 className="text-2xl font-bold mt-5 mb-2 text-[var(--acc-purple)]">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-xl font-bold mt-4 mb-2 text-[var(--acc-cyan)]">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-lg font-semibold mt-3 mb-1.5 text-[var(--acc-green)]">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-base font-semibold mt-2 mb-1 text-[var(--acc-orange)]">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="text-sm font-semibold mt-2 mb-1 text-[var(--acc-pink)]">{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="text-xs font-semibold mt-1 mb-0.5 text-[var(--acc-yellow)]">{children}</h6>
    ),
    code: buildCodeComponent({
      contentRef,
      sendToTerminal,
      isSettled,
      isStreaming,
      cacheHighlights,
    }),
    pre: ({ children }) => <>{children}</>,
    a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
    img: ({ src, alt, title, width, height }) => (
      <MarkdownImg src={src} alt={alt} title={title} width={width} height={height} />
    ),
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-border bg-muted px-2 py-1 text-left font-semibold">
        {children}
      </th>
    ),
    td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
    blockquote: ({ children }) => (
      <blockquote className="my-1 border-l-2 border-[var(--acc-comment)] pl-3 text-[var(--acc-comment)] italic">
        {children}
      </blockquote>
    ),
    ul: ({ children }) => <ul className="my-1 ps-[2em] list-disc space-y-0.5">{children}</ul>,
    ol: ({ children }) => <ol className="my-1 ps-[2em] list-decimal space-y-0.5">{children}</ol>,
    hr: () => <hr className="my-3 border-border" />,
    p: ({ children }) => <p className="my-1">{children}</p>,
  };
}

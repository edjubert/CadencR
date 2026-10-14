import { useCallback, useState, type ReactElement, type ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import { useGetMessageFullContent } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { Button } from "@/components/ui/button";

interface FullContentPreviewProps {
  preview: string;
  messageId?: number;
  children: (content: string) => ReactNode;
}

interface RequestedContent {
  messageId: number;
  preview: string;
}

/** Explicit, short-lived access to a persisted message's complete content. */
export function FullContentPreview({
  preview,
  messageId,
  children,
}: FullContentPreviewProps): ReactElement {
  const [requested, setRequested] = useState<RequestedContent | null>(null);
  const matchesRequest =
    requested !== null && requested.messageId === messageId && requested.preview === preview;
  const collapse = useCallback(() => setRequested(null), []);

  if (matchesRequest && messageId !== undefined) {
    return (
      <RequestedFullContent
        preview={preview}
        messageId={messageId}
        collapse={collapse}
        children={children}
      />
    );
  }
  return (
    <PreviewPanel
      preview={preview}
      messageId={messageId}
      status="preview"
      load={() => messageId !== undefined && setRequested({ messageId, preview })}
    />
  );
}

function RequestedFullContent({
  preview,
  messageId,
  collapse,
  children,
}: Required<Pick<FullContentPreviewProps, "messageId">> &
  Omit<FullContentPreviewProps, "messageId"> & { collapse: () => void }): ReactElement {
  const query = useGetMessageFullContent(messageId, {
    query: {
      gcTime: 0,
      staleTime: Number.POSITIVE_INFINITY,
      retry: false,
    },
  });
  if (query.data) {
    return (
      <LoadedContent content={query.data.content} collapse={collapse}>
        {children}
      </LoadedContent>
    );
  }
  return (
    <PreviewPanel
      preview={preview}
      messageId={messageId}
      status={query.isError ? "error" : "loading"}
      error={
        query.isError ? apiErrorMessage(query.error, "Could not load full content") : undefined
      }
      load={() => void query.refetch()}
    />
  );
}

function LoadedContent({
  content,
  collapse,
  children,
}: {
  content: string;
  collapse: () => void;
  children: (content: string) => ReactNode;
}): ReactElement {
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={collapse} aria-expanded>
        Collapse full content
      </Button>
      {children(content)}
    </div>
  );
}

interface PreviewPanelProps {
  preview: string;
  messageId?: number;
  status: "preview" | "loading" | "error";
  error?: string;
  load: () => void;
}

function PreviewPanel({
  preview,
  messageId,
  status,
  error,
  load,
}: PreviewPanelProps): ReactElement {
  const actionLabel =
    status === "loading"
      ? "Loading full content…"
      : status === "error"
        ? "Retry full content"
        : "Load full content";
  return (
    <div className="my-1 rounded-md border border-border bg-muted/30 p-3 text-xs">
      <div className="mb-2 font-medium text-foreground">Large content preview</div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">
        {preview}
      </pre>
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      )}
      {messageId === undefined && (
        <p role="alert" className="mt-2 text-destructive">
          Full content is unavailable because this message has no persisted identifier.
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={load}
        disabled={status === "loading" || messageId === undefined}
        aria-expanded={false}
      >
        {status === "loading" && <Loader2Icon className="size-3 animate-spin" />}
        {actionLabel}
      </Button>
    </div>
  );
}

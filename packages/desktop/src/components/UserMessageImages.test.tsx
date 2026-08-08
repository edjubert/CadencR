import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { extractPromptBlobs, resetPromptBlobCacheForTest } from "@/lib/prompt-image-cache";
import { useImageLightboxStore } from "@/stores/image-lightbox-store";
import { buildUserMessageContent, parseUserMessageContent } from "@/types/agent-types";
import { UserMessageBlock } from "./UserMessageBlock";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function promptWithImages(count: number): string {
  return buildUserMessageContent(
    "look at this",
    Array.from({ length: count }, (_unused, index) => ({
      // Vary the payload so each image gets its own cache entry.
      base64: `${PNG_BASE64}${"A".repeat(index * 4)}`,
      fileName: `shot-${index}.png`,
      kind: "image" as const,
      mimeType: "image/png",
    })),
  );
}

afterEach(() => {
  resetPromptBlobCacheForTest();
  useImageLightboxStore.setState({ open: false, images: [], index: 0 });
});

describe("user message images", () => {
  it("renders an off-loaded screenshot as an image, not as its envelope", () => {
    render(<UserMessageBlock content={extractPromptBlobs(promptWithImages(1))} />);

    expect(screen.getByText("look at this")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringMatching(/^blob:/));
    expect(screen.queryByText(/"type":"image"/)).toBeNull();
  });

  it("renders an inline payload that was never off-loaded", () => {
    render(<UserMessageBlock content={promptWithImages(1)} />);

    expect(screen.getByRole("img")).toHaveAttribute("src", `data:image/png;base64,${PNG_BASE64}`);
  });

  it("opens the lightbox on the clicked image", async () => {
    const user = userEvent.setup();
    render(<UserMessageBlock content={extractPromptBlobs(promptWithImages(3))} />);

    await user.click(screen.getByRole("button", { name: "Open attached image 2" }));

    const state = useImageLightboxStore.getState();
    expect(state.open).toBe(true);
    expect(state.images).toHaveLength(3);
    expect(state.index).toBe(1);
  });

  it("shows a placeholder instead of a broken image once a payload is evicted", () => {
    const content = extractPromptBlobs(promptWithImages(1));
    resetPromptBlobCacheForTest();

    render(<UserMessageBlock content={content} />);

    expect(screen.getByText("Image unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    // The ref survives in the envelope — only the payload is gone.
    expect(parseUserMessageContent(content).images[0].ref).toEqual(expect.any(String));
  });
});

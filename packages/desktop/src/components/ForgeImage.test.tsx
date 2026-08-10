import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { render } from "@/test-utils";
import type { ForgeUser } from "@/api/generated";
import { ForgeAvatar, ForgeImageScope, ForgeMarkdownImage } from "./ForgeImage";

const mocks = vi.hoisted(() => ({
  customInstance: vi.fn(),
  createObjectURL: vi.fn(() => "blob:forge-image"),
  revokeObjectURL: vi.fn(),
}));

vi.mock("@/api/client", () => ({ customInstance: mocks.customInstance }));

beforeEach(() => {
  mocks.customInstance.mockReset();
  mocks.customInstance.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  mocks.createObjectURL.mockClear();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: mocks.createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: mocks.revokeObjectURL,
  });
});

const ALICE: ForgeUser = {
  username: "alice",
  display_name: "Alice Ng",
  avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
};

describe("ForgeMarkdownImage", () => {
  it("loads a remote image through the forge rather than as a blocked <img>", async () => {
    // The whole point: `img-src 'self' data: blob:` means the remote URL never
    // reaches the element — the bytes come back through the service and the
    // element only ever sees the object URL.
    render(
      <ForgeImageScope featureId={7}>
        <ForgeMarkdownImage src="https://user-images.githubusercontent.com/1/shot.png" alt="Shot" />
      </ForgeImageScope>,
    );

    const image = await screen.findByAltText("Shot");
    expect(image).toHaveAttribute("src", "blob:forge-image");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(mocks.customInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/git/forge/image",
        params: {
          feature_id: 7,
          url: "https://user-images.githubusercontent.com/1/shot.png",
          kind: "content",
        },
        responseType: "blob",
      }),
    );
  });

  it("names a refused image instead of leaving a broken glyph", async () => {
    mocks.customInstance.mockRejectedValue(new Error("Forge would not release this image"));

    render(
      <ForgeImageScope featureId={7}>
        <ForgeMarkdownImage src="https://private.example/secret.png" alt="Secret" />
      </ForgeImageScope>,
    );

    const notice = await screen.findByTitle("Forge would not release this image");
    expect(notice).toHaveTextContent("Secret");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("leaves inline sources alone — the CSP already allows them", () => {
    render(
      <ForgeImageScope featureId={7}>
        <ForgeMarkdownImage src="data:image/png;base64,AAAA" alt="Inline" />
      </ForgeImageScope>,
    );

    expect(screen.getByAltText("Inline")).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(mocks.customInstance).not.toHaveBeenCalled();
  });

  it("renders a plain image when no pull request is in scope", () => {
    // Outside a PR there are no forge credentials to fetch with, so proxying
    // would only ever fail; the pre-existing plain <img> is the honest fallback.
    render(<ForgeMarkdownImage src="https://example.com/a.png" alt="Loose" />);

    expect(screen.getByAltText("Loose")).toHaveAttribute("src", "https://example.com/a.png");
    expect(mocks.customInstance).not.toHaveBeenCalled();
  });

  it("bounds automatic content loads and leaves extra images user-controlled", async () => {
    const sources = ["One", "Two", "Three", "Four", "Five"];
    const { user } = render(
      <ForgeImageScope featureId={7}>
        {sources.map((label) => (
          <ForgeMarkdownImage
            key={label}
            src={`https://images.example.com/${label}.png`}
            alt={label}
          />
        ))}
      </ForgeImageScope>,
    );

    await waitFor(() => expect(mocks.customInstance).toHaveBeenCalledTimes(4));
    const load = screen.getByRole("button", { name: "Load Five" });
    await user.click(load);
    await waitFor(() => expect(mocks.customInstance).toHaveBeenCalledTimes(5));
  });
});

describe("ForgeAvatar", () => {
  it("shows initials immediately and the face once the bytes arrive", async () => {
    const { container } = render(
      <ForgeImageScope featureId={7}>
        <ForgeAvatar user={ALICE} />
      </ForgeImageScope>,
    );

    // Initials are present from the first frame, so a thread does not reflow
    // as forty avatars land.
    expect(screen.getByText("AN")).toBeVisible();
    await waitFor(() =>
      expect(container.querySelector("img")).toHaveAttribute("src", "blob:forge-image"),
    );
  });

  it("keeps the initials, and the reason, when the forge refuses the avatar", async () => {
    mocks.customInstance.mockRejectedValue(new Error("Avatar host is unreachable"));

    const { container } = render(
      <ForgeImageScope featureId={7}>
        <ForgeAvatar user={ALICE} />
      </ForgeImageScope>,
    );

    await screen.findByTitle("Avatar host is unreachable");
    expect(screen.getByText("AN")).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
  });

  it("does not call the forge for an author who has no avatar", () => {
    render(
      <ForgeImageScope featureId={7}>
        <ForgeAvatar user={{ username: "bot", display_name: null, avatar_url: null }} />
      </ForgeImageScope>,
    );

    expect(screen.getByText("B")).toBeVisible();
    expect(mocks.customInstance).not.toHaveBeenCalled();
  });
});

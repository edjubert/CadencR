import { toast } from "sonner";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "@/test-utils";
import { CADENCR_DARK_THEME } from "@/lib/themes/cadencr-dark";
import { FROST_DARK_THEME } from "@/lib/themes/frost-dark";
import { DRACULA_THEME } from "@/lib/themes/dracula";
import type { CreateThemeResponse, UserTheme } from "@/api/generated";
import type { ThemeDefinition } from "@/lib/themes";
import { useThemeLibraryActions } from "./useThemeLibraryActions";

const create = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
const release = vi.hoisted(() => vi.fn());

vi.mock("@/api/generated", () => ({
  useCreateTheme: () => ({ mutate: create, isPending: false }),
  useDeleteTheme: () => ({ mutate: remove }),
  getListThemesQueryKey: () => ["/api/themes"],
}));
vi.mock("./useReleaseTheme", () => ({ useReleaseTheme: () => release }));
// The CadencR and Frost tokens still live in a stylesheet, so duplicating one
// reads them off the live document — which jsdom has no stylesheets for. The
// colors are not what these tests are about; the chrome travelling with them is.
vi.mock("@/lib/themes/user-theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/themes/user-theme")>()),
  readThemeCssVars: () => ({}),
}));

function renderActions() {
  const client = createTestQueryClient();
  const hook = renderHook(() => useThemeLibraryActions(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { ...hook, client };
}

/** What the create request would carry for `source`. */
function payloadFor(source: ThemeDefinition, label = "Mine") {
  const { result } = renderActions();
  result.current.duplicate(source, label);
  return create.mock.calls[0][0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleting a theme", () => {
  const theme: UserTheme = {
    id: "mine",
    label: "Mine",
    path: "/themes/mine/theme.json",
    content: "{}",
    assets: {},
    issues: [],
  };

  it("refreshes discovery lists without refetching still-mounted deleted details", async () => {
    const { result, client } = renderActions();
    const keys = [
      ["/api/themes"],
      ["/api/projects"],
      ["/api/features", { project_id: 7 }],
      ["/api/features", { pinned: true }],
      ["/api/projects/7/settings"],
      ["/api/features/12"],
      ["/api/features/12/settings"],
    ];
    const fetches = keys.map(() => vi.fn(async () => []));
    const unsubscribe = keys.map((queryKey, index) =>
      new QueryObserver(client, {
        queryKey,
        queryFn: fetches[index],
        initialData: [],
        staleTime: Infinity,
      }).subscribe(() => {}),
    );
    try {
      act(() => result.current.remove(theme));
      expect(result.current.deletingId).toBe("mine");
      expect(release).not.toHaveBeenCalled();
      expect(fetches.every((fetch) => fetch.mock.calls.length === 0)).toBe(true);
      await act(async () => remove.mock.calls[0][1].onSuccess());
      await waitFor(() =>
        fetches.slice(0, 4).forEach((fetch) => expect(fetch).toHaveBeenCalledTimes(1)),
      );
      fetches.slice(4).forEach((fetch) => expect(fetch).not.toHaveBeenCalled());
      expect(release).toHaveBeenCalledWith(theme);
      act(() => remove.mock.calls[0][1].onSettled());
      expect(result.current.deletingId).toBeNull();
    } finally {
      unsubscribe.forEach((stop) => stop());
      client.clear();
    }
  });

  it("surfaces a failed list refresh after successful deletion", async () => {
    const { result, client } = renderActions();
    const errorToast = vi.spyOn(toast, "error");
    const stop = new QueryObserver(client, {
      queryKey: ["/api/projects"],
      queryFn: async () => {
        throw new Error("Refresh unavailable");
      },
      initialData: [],
      staleTime: Infinity,
      retry: false,
    }).subscribe(() => {});
    try {
      act(() => result.current.remove(theme));
      await act(async () => remove.mock.calls[0][1].onSuccess());
      await waitFor(() => expect(errorToast).toHaveBeenCalledWith("Refresh unavailable"));
      expect(release).toHaveBeenCalledWith(theme);
    } finally {
      stop();
      client.clear();
      errorToast.mockRestore();
    }
  });

  it("keeps the selection and caches intact when deletion fails", () => {
    const { result, client } = renderActions();
    const cached = [
      { key: ["/api/projects"], data: [{ id: 7 }] },
      { key: ["/api/projects/7/settings"], data: { theme: "mine" } },
    ];
    cached.forEach(({ key, data }) => client.setQueryData(key, data));
    const errorToast = vi.spyOn(toast, "error");
    const invalidate = vi.spyOn(client, "invalidateQueries");
    act(() => result.current.remove(theme));
    act(() => {
      remove.mock.calls[0][1].onError(new Error("Trash unavailable"));
      remove.mock.calls[0][1].onSettled();
    });
    expect(release).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    cached.forEach(({ key, data }) => expect(client.getQueryData(key)).toEqual(data));
    expect(errorToast).toHaveBeenCalledWith("Trash unavailable");
    errorToast.mockRestore();
    expect(result.current.deletingId).toBeNull();
  });
});

describe("duplicating a theme", () => {
  it("carries the source's chassis and tab style, not just its colors", () => {
    // The bug this guards: a copy of CadencR Dark used to arrive without the
    // rail chassis and the segmented tabs, because both lived in a stylesheet
    // keyed on the theme id rather than in the theme.
    expect(payloadFor(CADENCR_DARK_THEME).chrome).toEqual(
      expect.objectContaining({ chassis: "rail", tabs: "segmented" }),
    );
  });

  it("carries the source's texture, so a copy of Frost still has a field behind it", () => {
    const texture = payloadFor(FROST_DARK_THEME).chrome.texture;

    expect(texture.base).toBeTruthy();
    expect(texture.halos.length).toBeGreaterThan(0);
    expect(texture.grain).not.toBeNull();
    expect(texture.veil).toBe(true);
  });

  it("gives a theme that declares no chrome the plain default rather than undefined", () => {
    expect(payloadFor(DRACULA_THEME).chrome).toEqual({
      chassis: "flat",
      tabs: "underline",
      texture: { base: null, halos: [], image: null, grain: null, veil: false },
    });
  });

  it("forwards the ready workspace and refreshes project discovery after creation", () => {
    const { result, client } = renderActions();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const onCreated = vi.fn();
    const response: CreateThemeResponse = {
      theme: {
        id: "mine",
        label: "Mine",
        path: "/themes/mine/theme.json",
        content: "{}",
        assets: {},
        issues: [],
      },
      workspace: { project_id: 7, feature_id: 12, cwd: "/themes/mine", created: true },
    };
    result.current.duplicate(DRACULA_THEME, "Mine", onCreated);
    act(() => create.mock.calls[0][1].onSuccess(response));
    expect(onCreated).toHaveBeenCalledWith(response.theme, response.workspace);
    expect(invalidate).toHaveBeenCalled();
  });

  it("refreshes retained themes after setup failure so Edit can retry without duplication", () => {
    const { result, client } = renderActions();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const onCreated = vi.fn();
    result.current.duplicate(DRACULA_THEME, "Mine", onCreated);
    act(() =>
      create.mock.calls[0][1].onError(new Error("Theme retained; reopen to retry project setup")),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/themes"] });
    expect(onCreated).not.toHaveBeenCalled();
  });

  describe("texture assets", () => {
    const withImage: ThemeDefinition = {
      ...DRACULA_THEME,
      id: "user:papery",
      chrome: {
        chassis: "flat",
        tabs: "underline",
        texture: {
          base: null,
          halos: [],
          grain: null,
          veil: false,
          image: { asset: "paper.png", opacity: 0.2, blend: "multiply", fit: "tile", scale: 320 },
        },
      },
    };

    it("asks the backend to copy the source theme's files, by its on-disk id", () => {
      // The document names `paper.png`; the file itself lives in the source
      // theme's folder and has to be copied, or the copy renders nothing.
      expect(payloadFor(withImage).copyAssetsFrom).toBe("papery");
    });

    it("asks for nothing from a built-in, which has no folder to copy from", () => {
      expect(payloadFor(FROST_DARK_THEME).copyAssetsFrom).toBeUndefined();
    });
  });
});

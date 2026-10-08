import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getListThemesQueryKey,
  useCreateTheme,
  useDeleteTheme,
  type UserTheme,
  type ThemeWorkspace,
} from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { invalidateByExactUrl, invalidateByUrlPrefix } from "@/lib/queryClient";
import { downloadJsonFile } from "@/lib/download";
import { type ThemeDefinition } from "@/lib/themes";
import { chromeOf } from "@/lib/themes/chrome";
import { readThemeCssVars, userThemeLabel, userThemeSlug } from "@/lib/themes/user-theme";
import { useReleaseTheme } from "./useReleaseTheme";

interface ThemeLibraryActions {
  /**
   * Copy `source` into a new theme called `label`; `onCreated` receives it once
   * it exists.
   */
  duplicate: (
    source: ThemeDefinition,
    label: string,
    onCreated?: (created: UserTheme, workspace: ThemeWorkspace) => void,
  ) => void;
  remove: (theme: UserTheme) => void;
  exportTheme: (theme: UserTheme) => void;
  isDuplicating: boolean;
  /** The theme currently being deleted, so only its own button goes busy. */
  deletingId: string | null;
}

/**
 * Create / delete / export for the theme library.
 *
 * Duplication is the only way to create a theme, on purpose: it seeds the
 * complete, already-valid token set of a working theme, so the user always
 * edits from something that renders rather than assembling 104 tokens by hand.
 * The copy is made server-side before the studio opens, because the agent that
 * edits it alongside the user needs a real folder to work in.
 *
 * What it is *called* comes from the user, not from the source: the label picks
 * the id, the folder and the project name, all of which are awkward to change
 * afterwards.
 */
export function useThemeLibraryActions(): ThemeLibraryActions {
  const queryClient = useQueryClient();
  const create = useCreateTheme();
  const remove = useDeleteTheme();
  const release = useReleaseTheme();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Refresh after partial creation too: the retained theme can be reopened to
  // retry project setup, instead of asking the user to create another copy.
  const refresh = useCallback((): void => {
    void queryClient
      .invalidateQueries({ queryKey: getListThemesQueryKey() })
      .catch((error: unknown) => {
        toast.error(apiErrorMessage(error, "Could not refresh the theme library"));
      });
  }, [queryClient]);

  const duplicate = useCallback(
    (
      source: ThemeDefinition,
      label: string,
      onCreated?: (created: UserTheme, workspace: ThemeWorkspace) => void,
    ): void => {
      let cssVars;
      try {
        cssVars = readThemeCssVars(source.id, source.cssVars);
      } catch (error) {
        toast.error(apiErrorMessage(error, "Failed to read the source theme"));
        return;
      }
      create.mutate(
        {
          data: {
            label,
            appearance: source.appearance,
            cssVars,
            xterm: source.xterm,
            // The shape of the theme, not just its colors: without this a copy
            // of CadencR Dark loses the rail and its segmented tabs, and a copy
            // of Frost loses the field drifting behind the app.
            chrome: chromeOf(source),
            // A texture's image lives in the source theme's folder, so the file
            // has to be copied alongside the document that names it. Built-ins
            // have no folder — and no image — so this is only ever a user theme.
            copyAssetsFrom: userThemeSlug(source.id),
          },
        },
        {
          onSuccess: (created) => {
            refresh();
            void invalidateByUrlPrefix(queryClient, ["/api/projects", "/api/features"]).catch(
              (error: unknown) =>
                toast.error(apiErrorMessage(error, "Could not refresh plugin projects")),
            );
            toast.success(`Created “${userThemeLabel(created.theme)}”`);
            onCreated?.(created.theme, created.workspace);
          },
          onError: (error) => {
            refresh();
            toast.error(apiErrorMessage(error, "Failed to duplicate theme"));
          },
        },
      );
    },
    [create, queryClient, refresh],
  );

  const removeTheme = useCallback(
    (theme: UserTheme): void => {
      setDeletingId(theme.id);
      remove.mutate(
        { id: theme.id },
        {
          onSuccess: () => {
            // Nothing can wear it now, and a selection left pointing at it
            // would silently resolve to the default — or come back to life if
            // a new theme ever landed on the same id.
            release(theme);
            refresh();
            // Refresh discovery lists, not details for the deleted workspace:
            // its mounted settings observers can outlive the sidebar refresh.
            void invalidateByExactUrl(queryClient, ["/api/projects", "/api/features"], {
              throwOnError: true,
            }).catch((error: unknown) =>
              toast.error(apiErrorMessage(error, "Could not refresh plugin projects")),
            );
            toast.success(`Deleted “${userThemeLabel(theme)}”. It is in the Trash.`);
          },
          onError: (error) => toast.error(apiErrorMessage(error, "Failed to delete theme")),
          onSettled: () => setDeletingId(null),
        },
      );
    },
    [remove, refresh, release, queryClient],
  );

  const exportTheme = useCallback((theme: UserTheme): void => {
    // Export is the whole sharing story for now: a theme file is portable data,
    // so "share" is "send someone this file".
    downloadJsonFile(`${theme.id}.theme.json`, theme.content);
  }, []);

  return useMemo(
    () => ({
      duplicate,
      remove: removeTheme,
      exportTheme,
      isDuplicating: create.isPending,
      deletingId,
    }),
    [duplicate, removeTheme, exportTheme, create.isPending, deletingId],
  );
}

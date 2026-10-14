import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getGetWorkspaceSettingQueryKey, type SettingValueResponse } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";

interface SettingWrites {
  generation: number;
  hasDraft: boolean;
  confirmedValue: SettingValueResponse | undefined;
  tail: Promise<void> | null;
}

interface SettingWrite {
  queryClient: QueryClient;
  key: string;
  value: string;
  immediateCache: boolean;
  persist: (request: { key: string; data: { value: string } }) => Promise<SettingValueResponse>;
}

// Share ordering across readers and remounts without retaining QueryClients.
const writes = new WeakMap<QueryClient, Map<string, SettingWrites>>();

/**
 * Capture an edit now, then enqueue its persistence when the debounce expires.
 * Only callbacks for the latest edit can publish or restore the shared cache.
 */
export function prepareSettingWrite({
  queryClient,
  key,
  value,
  immediateCache,
  persist,
}: SettingWrite): () => Promise<void> {
  let settings = writes.get(queryClient);
  if (!settings) {
    settings = new Map();
    writes.set(queryClient, settings);
  }
  const queryKey = getGetWorkspaceSettingQueryKey(key);
  let state = settings.get(key);
  if (!state) {
    state = { generation: 0, hasDraft: false, confirmedValue: undefined, tail: null };
    settings.set(key, state);
  }
  const current = state;
  if (!current.tail && !current.hasDraft) {
    current.confirmedValue = queryClient.getQueryData<SettingValueResponse>(queryKey);
  }
  const generation = ++current.generation;
  current.hasDraft = true;
  if (immediateCache) queryClient.setQueryData(queryKey, { value });

  const run = async (): Promise<void> => {
    try {
      await persist({ key, data: { value } });
      current.confirmedValue = { value };
      if (generation === current.generation && !immediateCache) {
        queryClient.setQueryData(queryKey, { value });
      }
    } catch (error: unknown) {
      toast.error(`Could not save setting "${key}": ${apiErrorMessage(error, "Unknown error")}`);
      if (generation === current.generation) {
        if (current.confirmedValue === undefined) {
          try {
            await queryClient.invalidateQueries({ queryKey });
          } catch (reloadError: unknown) {
            toast.error(
              `Could not reload setting "${key}": ${apiErrorMessage(reloadError, "Unknown error")}`,
            );
          }
        } else {
          queryClient.setQueryData(queryKey, current.confirmedValue);
        }
      }
    }
  };

  return (): Promise<void> => {
    // Another reader may have submitted a newer edit while this one debounced.
    if (generation !== current.generation) return Promise.resolve();
    current.hasDraft = false;
    const task = (current.tail ? current.tail.then(run) : run()).finally(() => {
      if (current.tail === task) current.tail = null;
    });
    current.tail = task;
    return task;
  };
}

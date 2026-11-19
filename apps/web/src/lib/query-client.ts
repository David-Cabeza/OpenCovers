import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isServerUnreachable } from "@/lib/server-status";
import { useServerStatus } from "@/stores/server-status";

// Any request that fails because the server cannot be reached marks it as down, and any request that gets an answer
// marks it as up, so the banner follows what the app actually sees.
const markDown = (err: unknown) => {
  if (isServerUnreachable(err)) useServerStatus.getState().setDown(true);
};
const markUp = () => {
  if (useServerStatus.getState().down) useServerStatus.getState().setDown(false);
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: markDown, onSuccess: markUp }),
  mutationCache: new MutationCache({ onError: markDown, onSuccess: markUp }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

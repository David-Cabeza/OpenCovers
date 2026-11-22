import { ThemeProvider } from "@/lib/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { Toaster, toast } from "sonner";
import { vi } from "vitest";

const proto = Element.prototype as unknown as Record<string, unknown>;
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

export function resetApiMocks() {
  vi.unstubAllGlobals();
  toast.dismiss();
}

export interface MockResponse {
  status?: number;
  body?: unknown;
}

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

type Handler = MockResponse | ((req: RecordedRequest) => MockResponse);

export function mockApi(routes: Record<string, Handler>) {
  const requests: RecordedRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    const raw = typeof init?.body === "string" ? init.body : undefined;
    const req: RecordedRequest = {
      method,
      path,
      body: raw ? JSON.parse(raw) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    requests.push(req);
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === method && path.split("?")[0] === p;
    });
    if (!key) return new Response(JSON.stringify({ code: "not_found" }), { status: 404 });
    const handler = routes[key];
    const res = typeof handler === "function" ? handler(req) : handler;
    return new Response(JSON.stringify(res.body ?? {}), {
      status: res.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    requests,
    writes: () => requests.filter((r) => r.method !== "GET"),
    calls: (method: string, path: string) =>
      requests.filter((r) => r.method === method && r.path.split("?")[0] === path),
  };
}

export function renderWithApp(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return Object.assign(
    render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          {ui}
          <Toaster />
        </QueryClientProvider>
      </ThemeProvider>,
    ),
    { queryClient: client },
  );
}

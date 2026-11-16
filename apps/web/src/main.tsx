import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import { takeInviteToken } from "@/lib/invite-link";
import { queryClient } from "@/lib/query-client";
import { ThemeProvider } from "@/lib/theme";
import "./index.css";

const inviteToken = takeInviteToken();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <App inviteToken={inviteToken} />
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);

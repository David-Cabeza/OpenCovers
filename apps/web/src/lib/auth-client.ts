import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// The magic-link plugin exists on the API only when DEMO_MODE=1. The client side is inert until it is called.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [magicLinkClient()],
});

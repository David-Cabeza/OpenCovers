const HASH_PREFIX = "#/invite";

export function inviteLink(token: string): string {
  return `${window.location.origin}/${HASH_PREFIX}?token=${encodeURIComponent(token)}`;
}

/**
 * Reads the invitation token from `#/invite?token=...` and removes the whole
 * fragment from the address bar and history entry. The token lives in the
 * fragment so it never reaches the server, a proxy access log or a Referer.
 */
export function takeInviteToken(): string | null {
  const { hash, pathname, search } = window.location;
  if (hash !== HASH_PREFIX && !hash.startsWith(`${HASH_PREFIX}?`)) return null;
  const token = new URLSearchParams(hash.slice(HASH_PREFIX.length + 1)).get("token");
  window.history.replaceState(window.history.state, "", pathname + search);
  return token?.trim() || null;
}

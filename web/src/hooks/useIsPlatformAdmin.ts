"use client";

import { useEffect, useState } from "react";

/**
 * Whether the signed-in user is a platform admin — drives whether the
 * "Platform metrics" link shows in the wallet menu. Defaults to false
 * while loading and for signed-out users, so the link never flashes in
 * before the check resolves. Purely a UI-visibility hint: the actual gate
 * is requirePlatformAdmin() on the /api/admin/* routes themselves.
 */
export function useIsPlatformAdmin(signedIn: boolean): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Nothing to check while signed out — state is already false by
    // default, and WalletMenu unmounts entirely on sign-out anyway, so
    // there's no stale-true case to guard against here.
    if (!signedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/whoami");
        const body = await res.json().catch(() => null);
        if (!cancelled) setIsAdmin(Boolean(body?.isAdmin));
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  return isAdmin;
}

"use client";

import { useEffect } from "react";
import { useServerInfo } from "@/lib/server-info";

/**
 * Legacy redirect page. The Lark binding section now lives on /settings
 * directly (M2a.5 sessions design). On Shape, that anchor doesn't exist (Task 10
 * hides the section), so redirect to home instead.
 */
export default function LarkSettingsLegacyRedirect() {
  const { features, loaded } = useServerInfo();

  useEffect(() => {
    if (typeof window === "undefined" || !loaded) return;
    const search = window.location.search;
    if (features.platforms.includes("lark")) {
      window.location.replace(`/settings${search}#lark-binding`);
    } else {
      window.location.replace(`/`);
    }
  }, [loaded, features.platforms]);

  return null;
}

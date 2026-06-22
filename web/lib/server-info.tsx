"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export interface ServerInfo {
  site_name: string;
  features: {
    /** Platforms with first-class Router web UI on this instance (e.g. "lark"). */
    platforms: string[];
    /** Locale codes the instance supports. */
    languages: string[];
    /** True when Lark API credentials are configured server-side. Lets the
     *  tag-detail page show the binding management panel even when the bot
     *  event listener is off. */
    lark_configured?: boolean;
  };
}

export interface ServerInfoContextValue extends ServerInfo {
  /** True once the /api/server-info fetch has resolved (success OR failure). */
  loaded: boolean;
}

// Conservative defaults so first paint never flashes platform-specific UI on
// instances that don't have it. Lark deployments see a brief delay (~100ms)
// before Lark surfaces appear once /api/server-info resolves — acceptable
// trade-off because flashing Lark UI on a non-Lark instance is more confusing
// than a slight delay on a Lark instance.
const DEFAULT_INFO: ServerInfo = {
  site_name: "Teleport Router",
  features: {
    platforms: [],
    languages: ["en"],
  },
};

const ServerInfoContext = createContext<ServerInfoContextValue>({
  ...DEFAULT_INFO,
  loaded: false,
});

export function ServerInfoProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<ServerInfo>(DEFAULT_INFO);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/server-info`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!alive) return;
        // Defensive: ensure the shape is what we expect before swapping in.
        if (
          data &&
          typeof data.site_name === "string" &&
          data.features &&
          Array.isArray(data.features.platforms) &&
          Array.isArray(data.features.languages)
        ) {
          setInfo(data);
        }
      })
      .catch(() => {
        // Network failure — keep conservative defaults; logged for debugging.
        console.warn("[server-info] fetch failed, using defaults");
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => { alive = false; };
  }, []);

  return (
    <ServerInfoContext.Provider value={{ ...info, loaded }}>
      {children}
    </ServerInfoContext.Provider>
  );
}

export function useServerInfo(): ServerInfoContextValue {
  return useContext(ServerInfoContext);
}

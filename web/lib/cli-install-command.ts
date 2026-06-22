"use client";

import { useEffect, useState } from "react";

/**
 * Canonical default baked into @teleport-computer/router-cli's
 * `DEFAULT_SERVER` (cli/src/config.mjs). When the page is hosted on this
 * origin, `router init` with no flag does the right thing. Anywhere else
 * (Shape Rotator, future tenants), we need `--server <origin>` to point
 * the CLI at the instance the user is reading the docs on — otherwise it
 * silently logs into Lark.
 */
const DEFAULT_SERVER = "https://router.feedling.app";

const BASE_INSTALL = "npm install -g @teleport-computer/router-cli";

/**
 * Returns the multi-line CLI install + init command, with `--server <origin>`
 * appended automatically when the current page isn't on the default server.
 *
 * Used from setup, register, and settings pages — keep the origin-detection
 * logic here so non-Lark instances always get the right command without each
 * page re-implementing it.
 */
export function useCliInstallCommand(): string {
  const [command, setCommand] = useState(`${BASE_INSTALL}\nrouter init`);
  useEffect(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (!origin || origin === DEFAULT_SERVER) {
      setCommand(`${BASE_INSTALL}\nrouter init`);
    } else {
      setCommand(`${BASE_INSTALL}\nrouter init --server ${origin}`);
    }
  }, []);
  return command;
}

import os from "node:os";
import path from "node:path";

// Every native host (one per running browser profile) listens on its own pipe and
// announces itself with a small JSON file in REGISTRY_DIR. MCP servers read that
// directory to list the connected browsers and pick one.
//
// TCA_PIPE forces the old single-pipe mode (one fixed pipe, no registry); tests use it.
const user = (os.userInfo().username || "user").replace(/[^\w.-]/g, "_");

export const PIPE_OVERRIDE = process.env.TCA_PIPE || null;
export const REGISTRY_DIR = process.env.TCA_REGISTRY_DIR || path.join(os.tmpdir(), `tabcrew-chrome-${user}`);

export function hostPipePath(hostId) {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\tabcrew-chrome-${user}-${hostId}`
    : path.join(REGISTRY_DIR, `${hostId}.sock`);
}

/** Back-compat export: the fixed pipe in single-pipe mode. */
export const PIPE_PATH = PIPE_OVERRIDE;

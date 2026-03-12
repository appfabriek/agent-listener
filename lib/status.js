/**
 * Check the status of the agent-listener daemon.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const LABEL = "com.appfabriek.agent-listener";

/**
 * Get structured status information about the listener.
 */
export function getStatus(installPath) {
  const platform = process.platform === "darwin" ? "macOS (launchd)"
    : process.platform === "linux" ? "Linux (systemd)"
    : process.platform;

  const result = {
    running: false,
    pid: null,
    uptime: null,
    installed: false,
    platform,
    identifier: process.env.LISTENER_IDENTIFIER || process.env.IDENTIFIER || null,
    apiUrl: process.env.API_URL || null,
    lastHeartbeat: null,
  };

  // Check if daemon is installed
  if (process.platform === "darwin") {
    const plistPath = resolve(process.env.HOME, "Library/LaunchAgents", `${LABEL}.plist`);
    result.installed = existsSync(plistPath);

    // Check if running via launchctl
    try {
      const output = execSync(`launchctl print gui/${process.getuid()}/${LABEL} 2>/dev/null`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      result.running = true;

      // Extract PID from launchctl print output
      const pidMatch = output.match(/pid\s*=\s*(\d+)/i);
      if (pidMatch) {
        result.pid = parseInt(pidMatch[1], 10);
      }
    } catch {
      // Not running
    }
  } else if (process.platform === "linux") {
    const unitPath = resolve(process.env.HOME, ".config/systemd/user/agent-listener.service");
    result.installed = existsSync(unitPath);

    try {
      const output = execSync("systemctl --user is-active agent-listener 2>/dev/null", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      result.running = output.trim() === "active";
    } catch {
      // Not running
    }

    if (result.running) {
      try {
        const output = execSync("systemctl --user show agent-listener --property=MainPID --value 2>/dev/null", {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        const pid = parseInt(output.trim(), 10);
        if (pid > 0) result.pid = pid;
      } catch { /* ignore */ }
    }
  }

  // If we have a PID, compute uptime
  if (result.pid) {
    try {
      const output = execSync(`ps -o etime= -p ${result.pid} 2>/dev/null`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      result.uptime = output.trim();
    } catch { /* ignore */ }
  }

  // Check diagnostics file for last activity
  const diagPath = resolve(installPath, "device-diagnostics.json");
  if (existsSync(diagPath)) {
    try {
      const diag = JSON.parse(readFileSync(diagPath, "utf-8"));
      if (diag._listener?.updated_at) {
        result.lastHeartbeat = diag._listener.updated_at;
      }
    } catch { /* ignore */ }
  }

  // Check log file modification time as fallback for last activity
  if (!result.lastHeartbeat) {
    const stdoutLog = resolve(installPath, "logs/stdout.log");
    if (existsSync(stdoutLog)) {
      try {
        const stat = statSync(stdoutLog);
        result.lastHeartbeat = stat.mtime.toISOString();
      } catch { /* ignore */ }
    }
  }

  return result;
}

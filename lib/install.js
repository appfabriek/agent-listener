/**
 * Platform-specific daemon installation for Agent Listener.
 * Supports macOS (launchd) and Linux (systemd).
 */

import { writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const LABEL = "com.appfabriek.agent-listener";

/**
 * Install as a launchd daemon on macOS.
 */
export function installLaunchd(installPath) {
  const logsDir = resolve(installPath, "logs");
  mkdirSync(logsDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>${resolve(installPath, "index.js")}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${installPath}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${resolve(logsDir, "stdout.log")}</string>
    <key>StandardErrorPath</key>
    <string>${resolve(logsDir, "stderr.log")}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>`;

  const launchAgentsDir = resolve(process.env.HOME, "Library/LaunchAgents");
  mkdirSync(launchAgentsDir, { recursive: true });
  const plistPath = resolve(launchAgentsDir, `${LABEL}.plist`);

  // Unload existing if present
  try {
    execSync(`launchctl bootout gui/${process.getuid()}/${LABEL} 2>/dev/null`, { stdio: "ignore" });
  } catch { /* not loaded, fine */ }

  writeFileSync(plistPath, plist);
  console.log(`Plist written to ${plistPath}`);

  try {
    execSync(`launchctl bootstrap gui/${process.getuid()} ${plistPath}`, { stdio: "inherit" });
    console.log("Agent listener installed and started.");
    console.log("");
    console.log("The listener will start automatically on login.");
    console.log("Use 'agent-listener status' to check the status.");
  } catch (err) {
    console.error(`Failed to load plist: ${err.message}`);
    console.log(`Plist is at ${plistPath} — try loading manually:`);
    console.log(`  launchctl bootstrap gui/$(id -u) ${plistPath}`);
    process.exit(1);
  }
}

/**
 * Uninstall the launchd daemon on macOS.
 */
export function uninstallLaunchd() {
  const plistPath = resolve(process.env.HOME, "Library/LaunchAgents", `${LABEL}.plist`);

  try {
    execSync(`launchctl bootout gui/${process.getuid()}/${LABEL}`, { stdio: "ignore" });
    console.log("Daemon stopped.");
  } catch { /* not loaded */ }

  if (existsSync(plistPath)) {
    unlinkSync(plistPath);
    console.log(`Removed ${plistPath}`);
  }

  console.log("Agent listener uninstalled.");
}

/**
 * Install as a systemd user service on Linux.
 */
export function installSystemd(installPath) {
  const logsDir = resolve(installPath, "logs");
  mkdirSync(logsDir, { recursive: true });

  const unit = `[Unit]
Description=Agent Talk To Me Listener
After=network.target

[Service]
Type=simple
WorkingDirectory=${installPath}
ExecStart=${process.execPath} ${resolve(installPath, "index.js")}
Restart=always
RestartSec=5
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`;

  const systemdDir = resolve(process.env.HOME, ".config/systemd/user");
  mkdirSync(systemdDir, { recursive: true });
  const unitPath = resolve(systemdDir, "agent-listener.service");

  writeFileSync(unitPath, unit);
  console.log(`Unit file written to ${unitPath}`);

  try {
    execSync("systemctl --user daemon-reload", { stdio: "inherit" });
    execSync("systemctl --user enable agent-listener", { stdio: "inherit" });
    execSync("systemctl --user start agent-listener", { stdio: "inherit" });
    console.log("Agent listener installed and started.");
    console.log("");
    console.log("The listener will start automatically on login.");
    console.log("Use 'agent-listener status' to check the status.");
  } catch (err) {
    console.error(`Failed to enable service: ${err.message}`);
    console.log("Try manually:");
    console.log("  systemctl --user daemon-reload");
    console.log("  systemctl --user enable --now agent-listener");
    process.exit(1);
  }
}

/**
 * Uninstall the systemd user service on Linux.
 */
export function uninstallSystemd() {
  try {
    execSync("systemctl --user stop agent-listener", { stdio: "ignore" });
    execSync("systemctl --user disable agent-listener", { stdio: "ignore" });
    console.log("Service stopped and disabled.");
  } catch { /* not active */ }

  const unitPath = resolve(process.env.HOME, ".config/systemd/user/agent-listener.service");
  if (existsSync(unitPath)) {
    unlinkSync(unitPath);
    console.log(`Removed ${unitPath}`);
  }

  try {
    execSync("systemctl --user daemon-reload", { stdio: "ignore" });
  } catch { /* ignore */ }

  console.log("Agent listener uninstalled.");
}

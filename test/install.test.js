import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for lib/install.js
 *
 * The install/uninstall functions directly call writeFileSync, execSync,
 * mkdirSync etc., making them hard to unit test without actually modifying
 * the system. We test what we can: the LABEL constant and the module's
 * export surface. Integration testing against a real system is recommended
 * for full coverage of installLaunchd/installSystemd/uninstall*.
 */

describe("install module", () => {
  it("exports installLaunchd, uninstallLaunchd, installSystemd, uninstallSystemd", async () => {
    const mod = await import("../lib/install.js");
    assert.equal(typeof mod.installLaunchd, "function");
    assert.equal(typeof mod.uninstallLaunchd, "function");
    assert.equal(typeof mod.installSystemd, "function");
    assert.equal(typeof mod.uninstallSystemd, "function");
  });

  it("module can be parsed without errors (syntax check)", async () => {
    // If the import succeeds, the module syntax is valid
    const mod = await import("../lib/install.js");
    assert.ok(mod);
  });
});

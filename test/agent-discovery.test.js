import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { selectAgent } from "../lib/agent-discovery.js";

// discoverAgents() shells out to `openclaw agents list --json`, hard to unit test
// without mocking child_process globally. We focus on selectAgent which has the
// selection logic, and verify discoverAgents behaviour patterns.

describe("selectAgent", () => {
  it("returns fallback when agents list is empty", () => {
    assert.equal(selectAgent([], "main"), "main");
  });

  it("returns default fallback 'main' when no fallback specified", () => {
    assert.equal(selectAgent([]), "main");
  });

  it("returns the only agent when list has one entry", () => {
    const agents = [{ id: "lena", name: "Lena", isDefault: false }];
    assert.equal(selectAgent(agents), "lena");
  });

  it("returns the default agent when multiple are available", () => {
    const agents = [
      { id: "alice", name: "Alice", isDefault: false },
      { id: "bob", name: "Bob", isDefault: true },
      { id: "charlie", name: "Charlie", isDefault: false },
    ];
    assert.equal(selectAgent(agents), "bob");
  });

  it("returns first agent when none is marked default", () => {
    const agents = [
      { id: "alice", name: "Alice", isDefault: false },
      { id: "bob", name: "Bob", isDefault: false },
    ];
    assert.equal(selectAgent(agents), "alice");
  });

  it("ignores extra properties on agent objects", () => {
    const agents = [
      { id: "lena", name: "Lena", emoji: "🌸", isDefault: true, model: "gpt-4" },
    ];
    assert.equal(selectAgent(agents), "lena");
  });

  it("uses custom fallback when provided and list is empty", () => {
    assert.equal(selectAgent([], "custom-agent"), "custom-agent");
  });
});

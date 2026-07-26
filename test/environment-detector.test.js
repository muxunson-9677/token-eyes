"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  detectCurrentEnvironment,
  mapLegacyEnvironmentKind,
  ENVIRONMENT_KINDS,
} = require("../src/lib/environment-detector");

describe("environment-detector", () => {
  describe("detectCurrentEnvironment", () => {
    it("returns native for plain win32 with no WSL/SSH/container signals", () => {
      const result = detectCurrentEnvironment({
        platform: "win32",
        env: { COMPUTERNAME: "HOST-A" },
        hostname: "HOST-A",
      });
      assert.equal(result.kind, "native");
      assert.match(result.id, /^native:host-a$/);
    });

    it("returns native for plain darwin", () => {
      const result = detectCurrentEnvironment({
        platform: "darwin",
        env: {},
        hostname: "macbook",
      });
      assert.equal(result.kind, "native");
      assert.equal(result.id, "native:macbook");
    });

    it("returns native for plain linux (no container signals)", () => {
      const result = detectCurrentEnvironment({
        platform: "linux",
        env: {},
        hostname: "linuxbox",
        pathExists: () => false,
        readFile: () => {
          throw new Error("ENOENT");
        },
      });
      assert.equal(result.kind, "native");
      assert.equal(result.id, "native:linuxbox");
    });

    it("returns wsl when WSL_DISTRO_NAME is set", () => {
      const result = detectCurrentEnvironment({
        platform: "linux",
        env: { WSL_DISTRO_NAME: "Ubuntu" },
        hostname: "wsl-host",
      });
      assert.equal(result.kind, "wsl");
      assert.equal(result.id, "wsl:ubuntu");
    });

    it("returns ssh when SSH_CONNECTION is set", () => {
      const result = detectCurrentEnvironment({
        platform: "linux",
        env: { SSH_CONNECTION: "1.2.3.4 22 5.6.7.8 22" },
        hostname: "ssh-target",
      });
      assert.equal(result.kind, "ssh");
      assert.equal(result.id, "ssh:ssh-target");
    });

    it("returns ssh when SSH_CLIENT is set", () => {
      const result = detectCurrentEnvironment({
        platform: "linux",
        env: { SSH_CLIENT: "1.2.3.4 22" },
        hostname: "ssh-target",
      });
      assert.equal(result.kind, "ssh");
      assert.equal(result.id, "ssh:ssh-target");
    });

    it("returns container when /.dockerenv exists", () => {
      const result = detectCurrentEnvironment({
        platform: "linux",
        env: {},
        hostname: "container-host",
        pathExists: (p) => p === "/.dockerenv",
        readFile: () => {
          throw new Error("ENOENT");
        },
      });
      assert.equal(result.kind, "container");
      assert.equal(result.id, "container:container-host");
    });

    it("returns container when env.container is set", () => {
      const result = detectCurrentEnvironment({
        platform: "linux",
        env: { container: "true" },
        hostname: "container-host",
        pathExists: () => false,
        readFile: () => {
          throw new Error("ENOENT");
        },
      });
      assert.equal(result.kind, "container");
      assert.equal(result.id, "container:container-host");
    });

    it("returns container when cgroup mentions docker", () => {
      const result = detectCurrentEnvironment({
        platform: "linux",
        env: {},
        hostname: "container-host",
        pathExists: () => false,
        readFile: () => "0::/docker/abcdef",
      });
      assert.equal(result.kind, "container");
      assert.equal(result.id, "container:container-host");
    });

    it("prioritizes container over WSL when both signals present", () => {
      const result = detectCurrentEnvironment({
        platform: "linux",
        env: { WSL_DISTRO_NAME: "Ubuntu", container: "true" },
        hostname: "host",
        pathExists: () => false,
        readFile: () => {
          throw new Error("ENOENT");
        },
      });
      assert.equal(result.kind, "container");
    });

    it("prioritizes container over SSH when both signals present", () => {
      const result = detectCurrentEnvironment({
        platform: "linux",
        env: { SSH_CLIENT: "1.2.3.4 22", container: "true" },
        hostname: "host",
        pathExists: () => false,
        readFile: () => {
          throw new Error("ENOENT");
        },
      });
      assert.equal(result.kind, "container");
    });

    it("returns unknown when hostname cannot be determined", () => {
      const result = detectCurrentEnvironment({
        platform: "win32",
        env: {},
        hostname: "",
      });
      assert.equal(result.kind, "unknown");
      assert.equal(result.id, "unknown");
    });

    it("uses real platform and env when called with no arguments (smoke test)", () => {
      const result = detectCurrentEnvironment();
      assert.ok(ENVIRONMENT_KINDS.has(result.kind));
      assert.ok(typeof result.id === "string" && result.id.length > 0);
    });
  });

  describe("mapLegacyEnvironmentKind", () => {
    it("maps legacy 'win' to 'native'", () => {
      assert.equal(mapLegacyEnvironmentKind("win"), "native");
    });

    it("maps legacy 'wsl-ubuntu' to 'wsl'", () => {
      assert.equal(mapLegacyEnvironmentKind("wsl-ubuntu"), "wsl");
    });

    it("maps legacy 'wsl-<distro>' to 'wsl'", () => {
      assert.equal(mapLegacyEnvironmentKind("wsl-debian"), "wsl");
    });

    it("maps 'native' to 'native'", () => {
      assert.equal(mapLegacyEnvironmentKind("native"), "native");
    });

    it("maps 'not-detected' to 'unknown'", () => {
      assert.equal(mapLegacyEnvironmentKind("not-detected"), "unknown");
    });

    it("maps null/undefined to 'unknown'", () => {
      assert.equal(mapLegacyEnvironmentKind(null), "unknown");
      assert.equal(mapLegacyEnvironmentKind(undefined), "unknown");
    });

    it("maps unknown strings to 'unknown'", () => {
      assert.equal(mapLegacyEnvironmentKind("something-weird"), "unknown");
    });
  });
});

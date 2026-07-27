const assert = require("node:assert/strict");
const { describe, it, beforeEach, afterEach } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

require("./helpers/home-shim.cjs");

const { handleLimitAccountsRequest } = require("../src/lib/limit-accounts-handler");
const {
  buildLimitAccountV2,
  clearLimitAccountsState,
  LIMIT_ACCOUNT_STATUS,
} = require("../src/lib/limit-accounts");

function makeTmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "limit-accounts-handler-"));
}

describe("handleLimitAccountsRequest", () => {
  beforeEach(() => clearLimitAccountsState());
  afterEach(() => clearLimitAccountsState());

  it("returns the v2 matrix payload via the independent handler", async () => {
    const home = makeTmpHome();
    try {
      const data = await handleLimitAccountsRequest({
        home,
        env: {},
        adapters: {
          codex: async ({ salt }) => [
            buildLimitAccountV2({
              providerId: "codex",
              rawAccountId: "acct-1",
              salt,
              accountLabel: "Work",
              planLabel: "Plus",
              status: LIMIT_ACCOUNT_STATUS.OK,
              windows: [],
              lastSuccessAt: null,
              errorCode: null,
            }),
          ],
        },
      });
      assert.equal(data.schema_version, "token-observability/v2");
      assert.equal(data.accounts.length, 1);
      assert.equal(data.accounts[0].account_label, "Work");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("preserves Windows discovery options for every account adapter", async () => {
    const home = makeTmpHome();
    try {
      let received = null;
      await handleLimitAccountsRequest({
        home,
        env: { TOKENTRACKER_AGENTDATA_ROOTS: "D:\\AgentData" },
        platform: "win32",
        scanDefaultWindowsDrives: true,
        windowsDriveRoots: ["D:\\"],
        adapters: {
          codex: async (options) => {
            received = options;
            return [];
          },
        },
      });

      assert.equal(received.platform, "win32");
      assert.equal(received.scanDefaultWindowsDrives, true);
      assert.deepEqual(received.windowsDriveRoots, ["D:\\"]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

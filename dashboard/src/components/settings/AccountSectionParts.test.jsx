import { beforeEach, describe, expect, it, vi } from "vitest";

import { prepareLeaderboardAvatar } from "./AccountSectionParts.jsx";

describe("leaderboard avatar normalization", () => {
  beforeEach(() => {
    const originalCreateElement = document.createElement.bind(document);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
      width: 120,
      height: 100,
      close: vi.fn(),
    })));
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      if (tag !== "canvas") return originalCreateElement(tag);
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback) => callback(new Blob(["webp"], { type: "image/webp" })),
      };
    });
  });

  it("uses a content hash as the immutable 96x96 WebP filename", async () => {
    const result = await prepareLeaderboardAvatar(
      new File(["source"], "private-name.png", { type: "image/png" }),
    );
    expect(result.type).toBe("image/webp");
    expect(result.name).toMatch(/^[a-f0-9]{64}\.webp$/);
    expect(result.name).not.toContain("private-name");
  });

  it("rejects output that cannot fit under 16 KiB", async () => {
    document.createElement.mockRestore();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      if (tag !== "canvas") return originalCreateElement(tag);
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback) => callback(
          new Blob([new Uint8Array(16 * 1024 + 1)], { type: "image/webp" }),
        ),
      };
    });
    await expect(prepareLeaderboardAvatar(
      new File(["source"], "avatar.png", { type: "image/png" }),
    )).rejects.toThrow("16 KiB");
  });
});

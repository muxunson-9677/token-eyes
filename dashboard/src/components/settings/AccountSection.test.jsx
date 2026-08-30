import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openLogin: vi.fn(),
  settings: {},
}));

vi.mock("../../contexts/LoginModalContext.jsx", () => ({
  useLoginModal: () => ({ openLoginModal: mocks.openLogin }),
}));
vi.mock("./useAccountProfileSettings.js", () => ({
  useAccountProfileSettings: () => mocks.settings,
}));

import { AccountSection } from "./AccountSection.jsx";

function signedInSettings() {
  return {
    enabled: true,
    signedIn: true,
    leaderboardParticipant: true,
    email: "user@example.com",
    userId: "user-1",
    signOut: vi.fn(),
    shareActualCost: false,
    actualCostSaving: false,
    handleActualCostToggle: vi.fn(),
    deleting: false,
    handleDeleteParticipation: vi.fn(),
    avatar: { avatarUrl: null, uploading: false, handleAvatarFile: vi.fn() },
    name: {
      anonymousOn: false,
      customDisplayName: "Token User",
      displayName: "OAuth User",
      editingName: false,
      handleSaveName: vi.fn(),
      nameInput: "",
      profileLoading: false,
      profileSaving: false,
      setEditingName: vi.fn(),
      setNameInput: vi.fn(),
      startEditingName: vi.fn(),
    },
    github: {
      editingGithub: false,
      githubError: null,
      githubInput: "",
      githubUrl: "https://github.com/token-user",
      handleSaveGithub: vi.fn(),
      handleShowGithubToggle: vi.fn(),
      profileLoading: false,
      profileSaving: false,
      setEditingGithub: vi.fn(),
      setGithubError: vi.fn(),
      setGithubInput: vi.fn(),
      showGithubOn: true,
      startEditingGithub: vi.fn(),
    },
  };
}

describe("AccountSection leaderboard participation", () => {
  beforeEach(() => {
    mocks.openLogin.mockReset();
    mocks.settings = { enabled: true, signedIn: false };
  });

  it("does not expose a login entry outside the leaderboard while signed out", () => {
    render(<AccountSection />);
    expect(screen.queryByText("登录 · 参与排行榜")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登录" })).not.toBeInTheDocument();
    expect(mocks.openLogin).not.toHaveBeenCalled();
  });

  it("shows profile, actual-cost consent, sign out, and destructive exit only", () => {
    mocks.settings = signedInSettings();
    render(<AccountSection />);

    for (const text of ["昵称", "头像", "GitHub", "公开实际总成本", "退出登录", "退出排行榜并删除数据"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    for (const obsolete of ["云同步", "公开主页", "匿名"]) {
      expect(screen.queryByText(obsolete)).not.toBeInTheDocument();
    }
  });

  it("confirms before deleting leaderboard participation", () => {
    const settings = signedInSettings();
    mocks.settings = settings;
    vi.stubGlobal("confirm", vi.fn(function confirmDelete() {
      return true;
    }));
    render(<AccountSection />);

    fireEvent.click(screen.getByRole("button", { name: "退出排行榜并删除数据" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(settings.handleDeleteParticipation).toHaveBeenCalledTimes(1);
  });
});

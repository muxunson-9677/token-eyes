import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LeaderboardRulesPage } from "./LeaderboardRulesPage.jsx";

describe("LeaderboardRulesPage", () => {
  it("explains ranking, privacy, periods, cache metrics and deduplication", () => {
    render(
      <MemoryRouter>
        <LeaderboardRulesPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "排行榜规则说明" })).toBeInTheDocument();
    expect(screen.getByText(/仅供交流与娱乐/)).toBeInTheDocument();
    expect(screen.getByText(/UTC\+8/)).toBeInTheDocument();
    expect(screen.getByText(/含缓存/)).toBeInTheDocument();
    expect(screen.getByText(/不含缓存/)).toBeInTheDocument();
    expect(screen.getAllByText(/多设备/).length).toBeGreaterThan(0);
    expect(screen.getByText(/不会上传提示词、回复、代码或日志正文/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回排行榜" })).toHaveAttribute(
      "href",
      "/leaderboard",
    );
    expect(screen.getByRole("link", { name: "返回概览" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});

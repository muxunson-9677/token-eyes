import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { DataDirectoriesSection } from "./DataDirectoriesSection.jsx";
import { getLocalSettings, setLocalSettings } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getLocalSettings: vi.fn(),
  setLocalSettings: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getLocalSettings.mockResolvedValue({
    dataDirectories: {
      claude: "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude",
      codex: "",
      hermes: "",
    },
  });
  setLocalSettings.mockImplementation(async ({ dataDirectories }) => ({ ok: true, dataDirectories }));
});

it("loads and saves data directory overrides", async () => {
  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  const claudeInput = await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");
  const codexInput = screen.getByLabelText(/Codex data directory/i);
  const saveButton = screen.getByRole("button", { name: /Save/i });

  expect(saveButton).toBeDisabled();

  await act(async () => {
    await user.type(codexInput, "C:\\Users\\admin\\.codex");
  });
  expect(saveButton).toBeEnabled();

  await act(async () => {
    await user.click(saveButton);
  });

  await waitFor(() => {
    expect(setLocalSettings).toHaveBeenCalledWith({
      dataDirectories: {
        claude: claudeInput.value,
        codex: "C:\\Users\\admin\\.codex",
        hermes: "",
      },
    });
  });
  expect(await screen.findByText(/Saved locally/i)).toBeInTheDocument();
});

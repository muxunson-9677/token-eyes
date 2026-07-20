import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderIcon } from "../ProviderIcon.jsx";

describe("ProviderIcon", () => {
  it("renders TRAE from the bundled project asset", () => {
    const { container } = render(<ProviderIcon provider="trae" size={20} />);

    const icon = container.querySelector("img");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("src", "/brand-logos/trae.svg");
    expect(icon).toHaveAttribute("width", "20");
    expect(icon).toHaveAttribute("height", "20");
  });
});

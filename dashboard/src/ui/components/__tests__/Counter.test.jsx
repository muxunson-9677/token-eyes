import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import Counter, { getCounterPlaces, getStaticTokenStyle } from "../Counter";

describe("getCounterPlaces", () => {
  it("preserves separators and suffixes while deriving digit places", () => {
    expect(getCounterPlaces("1,234.5B")).toEqual([1000, ",", 100, 10, 1, ".", 0.1, "B"]);
  });

  it("keeps a Chinese unit as a static token", () => {
    expect(getCounterPlaces("33.76亿")).toEqual([10, 1, ".", 0.1, 0.01, "亿"]);
  });
});

describe("getStaticTokenStyle", () => {
  it("allocates a full em for Chinese units", () => {
    expect(getStaticTokenStyle("亿", 78)).toMatchObject({
      width: "1em",
      flexShrink: 0,
    });
  });
});

describe("Counter", () => {
  it("renders a counter root with static suffix tokens", () => {
    render(<Counter value={1.2} displayValue="1.2B" />);

    expect(screen.getByText("1.2B")).toBeInTheDocument();
    expect(document.querySelector('[data-counter-root="true"]')).not.toBeNull();
  });
});

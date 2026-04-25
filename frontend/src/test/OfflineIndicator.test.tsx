import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import OfflineIndicator from "../components/OfflineIndicator";

describe("OfflineIndicator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows banner when offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<OfflineIndicator />);
    expect(screen.getByRole("alert")).toHaveTextContent("offline.message");
  });

  it("hides banner when online", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<OfflineIndicator />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reacts to offline/online events", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<OfflineIndicator />);
    expect(screen.queryByRole("alert")).toBeNull();

    // Go offline
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Go back online
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

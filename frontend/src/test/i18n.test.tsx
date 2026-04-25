import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider, useI18n } from "../i18n";

function TestComponent({ keyPath, vars }: { keyPath: string; vars?: Record<string, string | number> }) {
  const { t } = useI18n();
  return <span data-testid="output">{t(keyPath, vars)}</span>;
}

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("i18n", () => {
  it("resolves a simple key", () => {
    renderWithI18n(<TestComponent keyPath="common.loading" />);
    expect(screen.getByTestId("output")).toHaveTextContent("Loading...");
  });

  it("resolves nested key with variable interpolation", () => {
    renderWithI18n(<TestComponent keyPath="dashboard.welcomeUser" vars={{ name: "John" }} />);
    expect(screen.getByTestId("output")).toHaveTextContent("Welcome, John.");
  });

  it("returns key as fallback when key missing", () => {
    renderWithI18n(<TestComponent keyPath="nonexistent.key.here" />);
    expect(screen.getByTestId("output")).toHaveTextContent("nonexistent.key.here");
  });

  it("resolves newly added profile OTP keys", () => {
    renderWithI18n(<TestComponent keyPath="profile.sendOtpButton" />);
    expect(screen.getByTestId("output")).toHaveTextContent("Send OTP");
  });

  it("resolves newly added dashboard payment keys", () => {
    renderWithI18n(<TestComponent keyPath="dashboard.successSubscriptionPaid" />);
    expect(screen.getByTestId("output")).toHaveTextContent("Subscription due paid successfully.");
  });

  it("resolves photo section keys", () => {
    renderWithI18n(<TestComponent keyPath="photo.uploadHint" />);
    expect(screen.getByTestId("output")).toHaveTextContent("Click or drag to upload photo");
  });

  it("resolves csv section keys", () => {
    renderWithI18n(<TestComponent keyPath="csv.dropzoneHint" />);
    expect(screen.getByTestId("output")).toHaveTextContent("Drop a CSV file here or click to browse");
  });
});

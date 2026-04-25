import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ValidatedInput, { validatePhone, validateEmail } from "../components/ValidatedInput";
import { I18nProvider } from "../i18n";

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("ValidatedInput (phone)", () => {
  it("renders with +91 prefix", () => {
    renderWithI18n(
      <ValidatedInput type="phone" value="9876543210" onChange={() => {}} label="Phone" />,
    );
    expect(screen.getByText("+91")).toBeInTheDocument();
    expect(screen.getByDisplayValue("9876543210")).toBeInTheDocument();
  });

  it("strips +91 prefix for display", () => {
    renderWithI18n(
      <ValidatedInput type="phone" value="+919876543210" onChange={() => {}} />,
    );
    expect(screen.getByDisplayValue("9876543210")).toBeInTheDocument();
  });

  it("shows validation error on blur for invalid number", () => {
    renderWithI18n(
      <ValidatedInput type="phone" value="123" onChange={() => {}} />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.blur(input);
    expect(screen.getByText("Enter a valid 10-digit Indian mobile number")).toBeInTheDocument();
  });

  it("shows no error for valid number", () => {
    renderWithI18n(
      <ValidatedInput type="phone" value="9876543210" onChange={() => {}} />,
    );
    const input = screen.getByDisplayValue("9876543210");
    fireEvent.blur(input);
    expect(screen.queryByText("Enter a valid 10-digit Indian mobile number")).toBeNull();
  });

  it("shows no error for empty value", () => {
    renderWithI18n(
      <ValidatedInput type="phone" value="" onChange={() => {}} />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.blur(input);
    expect(screen.queryByClassName?.("field-error")).toBeUndefined();
  });
});

describe("ValidatedInput (email)", () => {
  it("renders email input", () => {
    renderWithI18n(
      <ValidatedInput type="email" value="test@example.com" onChange={() => {}} label="Email" />,
    );
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByDisplayValue("test@example.com")).toBeInTheDocument();
  });

  it("shows validation error for invalid email on blur", () => {
    renderWithI18n(
      <ValidatedInput type="email" value="notanemail" onChange={() => {}} />,
    );
    const input = screen.getByDisplayValue("notanemail");
    fireEvent.blur(input);
    expect(screen.getByText("Invalid email address")).toBeInTheDocument();
  });

  it("shows no error for valid email", () => {
    renderWithI18n(
      <ValidatedInput type="email" value="user@test.com" onChange={() => {}} />,
    );
    const input = screen.getByDisplayValue("user@test.com");
    fireEvent.blur(input);
    expect(screen.queryByText("Invalid email address")).toBeNull();
  });
});

describe("validatePhone (standalone)", () => {
  it("returns empty for valid phone", () => {
    expect(validatePhone("9876543210")).toBe("");
    expect(validatePhone("+919876543210")).toBe("");
  });

  it("returns error for invalid phone", () => {
    expect(validatePhone("123")).toBe("Enter a valid 10-digit Indian mobile number");
  });

  it("returns empty for empty string", () => {
    expect(validatePhone("")).toBe("");
  });

  it("uses t function when provided", () => {
    const t = (key: string) => `translated:${key}`;
    expect(validatePhone("123", t)).toBe("translated:validation.errorInvalidIndianPhone");
  });
});

describe("validateEmail (standalone)", () => {
  it("returns empty for valid email", () => {
    expect(validateEmail("a@b.com")).toBe("");
  });

  it("returns error for invalid email", () => {
    expect(validateEmail("nope")).toBe("Invalid email address");
  });

  it("returns empty for empty string", () => {
    expect(validateEmail("")).toBe("");
  });

  it("uses t function when provided", () => {
    const t = (key: string) => `translated:${key}`;
    expect(validateEmail("bad", t)).toBe("translated:validation.errorInvalidEmail");
  });
});

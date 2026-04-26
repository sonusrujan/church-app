import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock modules ──
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: "/signin", search: "", hash: "", state: null, key: "test" }),
    BrowserRouter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const mockApiRequest = vi.fn();
const mockSetActiveChurchId = vi.fn();
vi.mock("../lib/api", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  setActiveChurchId: (...args: unknown[]) => mockSetActiveChurchId(...args),
  getActiveChurchId: () => null,
  setTokenRefreshCallback: vi.fn(),
  setAuthFailureCallback: vi.fn(),
  tryRefreshToken: vi.fn().mockResolvedValue(null),
  API_BASE_URL: "http://localhost:4000",
}));

vi.mock("../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, language: "en", setLanguage: vi.fn() }),
}));

import { useAuth } from "../hooks/useAuth";
import { renderHook, act } from "@testing-library/react";

function createSetNotice() {
  return vi.fn<[{ tone: string; text: string }]>();
}

describe("Auth Flow — OTP Send", () => {
  let setNotice: ReturnType<typeof createSetNotice>;

  beforeEach(() => {
    vi.clearAllMocks();
    setNotice = createSetNotice();
    mockApiRequest.mockReset();
  });

  it("rejects empty phone number", async () => {
    const { result } = renderHook(() => useAuth(setNotice));

    await act(async () => {
      await result.current.sendOtp();
    });

    expect(setNotice).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "error" }),
    );
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("sends OTP for valid phone and moves to otp step", async () => {
    mockApiRequest.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAuth(setNotice));

    // Set phone
    act(() => {
      result.current.setPhoneInput("9876543210");
    });

    await act(async () => {
      await result.current.sendOtp();
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "/api/otp/send",
      expect.objectContaining({ method: "POST", body: expect.objectContaining({ phone: expect.any(String) }) }),
    );
    expect(result.current.otpStep).toBe("otp");
    expect(setNotice).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "success" }),
    );
  });

  it("shows error when OTP send fails", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("Rate limited"));

    const { result } = renderHook(() => useAuth(setNotice));

    act(() => {
      result.current.setPhoneInput("9876543210");
    });

    await act(async () => {
      await result.current.sendOtp();
    });

    expect(setNotice).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "error", text: "Rate limited" }),
    );
    expect(result.current.otpStep).toBe("phone");
  });
});

describe("Auth Flow — OTP Verify", () => {
  let setNotice: ReturnType<typeof createSetNotice>;

  beforeEach(() => {
    vi.clearAllMocks();
    setNotice = createSetNotice();
    mockApiRequest.mockReset();
  });

  it("rejects empty OTP", async () => {
    const { result } = renderHook(() => useAuth(setNotice));

    await act(async () => {
      await result.current.verifyOtp();
    });

    expect(setNotice).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "error" }),
    );
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("verifies OTP, sets session, and navigates to dashboard (single church)", async () => {
    mockApiRequest.mockResolvedValueOnce({
      access_token: "jwt-test-token",
      user: { id: "u1", email: "test@example.com", phone: "+919876543210" },
      churches: [{ church_id: "c1", church_name: "Test Church", role: "member" }],
    });

    const { result } = renderHook(() => useAuth(setNotice));

    act(() => {
      result.current.setPhoneInput("9876543210");
      result.current.setOtpInput("123456");
    });

    await act(async () => {
      await result.current.verifyOtp();
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "/api/otp/verify",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ otp: "123456" }),
      }),
    );
    expect(result.current.isLoggedIn).toBe(true);
    expect(result.current.token).toBe("jwt-test-token");
    expect(mockSetActiveChurchId).toHaveBeenCalledWith("c1");
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard", { replace: true });
  });

  it("shows church picker when multiple churches returned", async () => {
    mockApiRequest.mockResolvedValueOnce({
      access_token: "jwt-multi",
      user: { id: "u1", email: "test@example.com", phone: "+919876543210" },
      churches: [
        { church_id: "c1", church_name: "Church A", role: "member" },
        { church_id: "c2", church_name: "Church B", role: "admin" },
      ],
    });

    const { result } = renderHook(() => useAuth(setNotice));

    act(() => {
      result.current.setPhoneInput("9876543210");
      result.current.setOtpInput("654321");
    });

    await act(async () => {
      await result.current.verifyOtp();
    });

    expect(result.current.showChurchPicker).toBe(true);
    expect(result.current.userChurches).toHaveLength(2);
    // Should NOT navigate yet — user must pick
    expect(mockNavigate).not.toHaveBeenCalledWith("/dashboard", expect.anything());
  });

  it("handles verification failure", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("Invalid OTP"));

    const { result } = renderHook(() => useAuth(setNotice));

    act(() => {
      result.current.setPhoneInput("9876543210");
      result.current.setOtpInput("000000");
    });

    await act(async () => {
      await result.current.verifyOtp();
    });

    expect(result.current.isLoggedIn).toBe(false);
    expect(setNotice).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "error", text: "Invalid OTP" }),
    );
  });
});

describe("Auth Flow — Sign Out", () => {
  let setNotice: ReturnType<typeof createSetNotice>;

  beforeEach(() => {
    vi.clearAllMocks();
    setNotice = createSetNotice();
    mockApiRequest.mockReset();
  });

  it("clears session and navigates to signin", async () => {
    // First log in
    mockApiRequest.mockResolvedValueOnce({
      access_token: "jwt-token",
      user: { id: "u1", email: "test@example.com", phone: "+919876543210" },
      churches: [{ church_id: "c1", church_name: "Test", role: "member" }],
    });

    const { result } = renderHook(() => useAuth(setNotice));

    act(() => {
      result.current.setPhoneInput("9876543210");
      result.current.setOtpInput("123456");
    });

    await act(async () => {
      await result.current.verifyOtp();
    });

    expect(result.current.isLoggedIn).toBe(true);

    // Now sign out
    mockApiRequest.mockResolvedValueOnce(undefined); // revoke call

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.isLoggedIn).toBe(false);
    expect(result.current.token).toBe("");
    expect(mockSetActiveChurchId).toHaveBeenCalledWith(null);
    expect(mockNavigate).toHaveBeenCalledWith("/signin", { replace: true });
  });
});

describe("Auth Flow — Church Selection", () => {
  let setNotice: ReturnType<typeof createSetNotice>;

  beforeEach(() => {
    vi.clearAllMocks();
    setNotice = createSetNotice();
    mockApiRequest.mockReset();
  });

  it("selectChurch sets active church and navigates", async () => {
    mockApiRequest.mockResolvedValueOnce({
      access_token: "jwt-multi",
      user: { id: "u1", email: "test@example.com", phone: "+919876543210" },
      churches: [
        { church_id: "c1", church_name: "Church A", role: "member" },
        { church_id: "c2", church_name: "Church B", role: "admin" },
      ],
    });

    const { result } = renderHook(() => useAuth(setNotice));

    act(() => {
      result.current.setPhoneInput("9876543210");
      result.current.setOtpInput("123456");
    });

    await act(async () => {
      await result.current.verifyOtp();
    });

    expect(result.current.showChurchPicker).toBe(true);

    await act(async () => {
      await result.current.selectChurch("c2");
    });

    expect(mockSetActiveChurchId).toHaveBeenCalledWith("c2");
    expect(result.current.showChurchPicker).toBe(false);
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard", { replace: true });
  });
});

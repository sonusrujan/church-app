/**
 * Lazy Capacitor bridge. Every call is guarded so the web build keeps
 * working even when Capacitor packages are absent at runtime (Vite tree-shakes
 * the dynamic imports out of the web bundle).
 *
 * Do NOT `import` Capacitor statically from any file that might render on web.
 */

export async function isNativePlatform(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function openExternalBrowser(url: string): Promise<boolean> {
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url, presentationStyle: "popover" });
    return true;
  } catch {
    // Fallback: open in the system browser
    try {
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    } catch {
      return false;
    }
  }
}

export async function closeInAppBrowser(): Promise<void> {
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch { /* ignored */ }
}

type AppUrlOpenHandler = (url: URL) => void;

export async function onAppUrlOpen(handler: AppUrlOpenHandler): Promise<() => void> {
  try {
    const { App } = await import("@capacitor/app");
    const listener = await App.addListener("appUrlOpen", (data) => {
      try {
        handler(new URL(data.url));
      } catch { /* ignore malformed URLs */ }
    });
    return () => { listener.remove(); };
  } catch {
    return () => {};
  }
}

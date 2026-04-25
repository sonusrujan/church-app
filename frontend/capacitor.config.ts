import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.shalom.church",
  appName: "Shalom",
  webDir: "dist",
  bundledWebRuntime: false,
  server: {
    // iOS uses capacitor://localhost, Android uses https://localhost.
    // androidScheme must be https so Service Workers and secure-context APIs
    // (push, clipboard, etc.) work inside the WebView.
    androidScheme: "https",
    // Universal/App Links: allowNavigation whitelists our web origin so the
    // WebView can stay in-app for same-site navigation, while the
    // appUrlOpen listener catches the deep link on return from browser.
    allowNavigation: ["shalom.app", "*.shalom.app"],
  },
  ios: {
    contentInset: "automatic",
    limitsNavigationsToAppBoundDomains: true,
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;

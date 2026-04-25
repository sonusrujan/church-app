# Play Store Deployment Guide — Shalom Church App

## Overview

The Shalom Church App is packaged for Google Play as a **Trusted Web Activity (TWA)** — a thin Android wrapper around the existing PWA at `https://shalomapp.in`. No app code changes are needed.

## Prerequisites

| Requirement | Status |
|-------------|--------|
| PWA with valid manifest | ✅ Done |
| Service Worker with offline | ✅ Done |
| HTTPS | ✅ Done |
| Icons (192px + 512px, maskable) | ✅ Done |
| Privacy Policy page | ✅ `/privacy` |
| Node.js 18+ | Required locally |
| JDK 11+ | Required locally |
| Android SDK (via Bubblewrap) | Auto-downloaded |
| Google Play Developer account ($25) | Required |

## Step-by-Step

### 1. Generate the Android App Bundle (AAB)

```bash
# From the project root
./build-twa.sh
```

Bubblewrap will prompt you to:
- Accept the Android SDK license
- Create a signing keystore (remember the password!)

The output AAB is at `twa-output/app-release-bundle.aab`.

### 2. Get Your Signing Key Fingerprint

```bash
cd twa-output
bubblewrap fingerprint
```

This outputs a SHA-256 fingerprint like:
```
AB:CD:EF:12:34:...
```

### 3. Update Digital Asset Links

Edit `frontend/public/.well-known/assetlinks.json` and replace the placeholder:

```json
"sha256_cert_fingerprints": [
  "AB:CD:EF:12:34:..."
]
```

Then redeploy the frontend:
```bash
cd frontend && npm run build
aws s3 sync dist/ s3://shalom-frontend-357644040292/ --delete --region ap-south-1
aws cloudfront create-invalidation --distribution-id E29I0OCEMV8WKN --paths '/*' --region ap-south-1
```

> **Important:** Also add the Google Play signing key fingerprint (from Play Console → Setup → App signing) to the same `assetlinks.json` array.

### 4. Upload to Google Play Console

1. Go to [Google Play Console](https://play.google.com/console)
2. Create a new app → "Shalom Church App"
3. Upload the AAB to **Production** (or **Internal testing** first)
4. Fill in the store listing:
   - **App name:** Shalom Church App
   - **Short description:** Church management and member engagement platform
   - **Full description:** Shalom helps churches manage members, process donations, organize events, send notifications, and build community — all in one app. Available in English, Hindi, Telugu, Tamil, Malayalam, and Kannada.
   - **Category:** Social
   - **Privacy policy URL:** `https://shalomapp.in/privacy`

### 5. Required Store Listing Assets

| Asset | Specification |
|-------|---------------|
| App icon | 512×512 PNG (already have `icon-512.png`) |
| Feature graphic | 1024×500 PNG/JPG |
| Phone screenshots | Min 2, 16:9 or 9:16, 1080px min width |
| 7" tablet screenshots | Min 1 (recommended) |
| 10" tablet screenshots | Min 1 (recommended) |

### 6. Content Rating

Complete the content rating questionnaire in Play Console. For a church app, it will likely receive an **Everyone** rating.

### 7. Submit for Review

Google reviews typically take 1–7 days for new apps.

## Updating the App

Since the app is a TWA wrapping a PWA, **most updates are instant** — just deploy to S3/CloudFront. You only need to upload a new AAB when:
- Changing the package name or version
- Updating TWA configuration (colors, orientation)
- Adding Android-specific features

## Troubleshooting

### Chrome address bar appears in the TWA
This means Digital Asset Links verification failed. Check:
1. `assetlinks.json` is served at `https://shalomapp.in/.well-known/assetlinks.json`
2. The SHA-256 fingerprint matches your signing key
3. The package name matches `com.shalomapp.twa`

### App opens in browser instead of TWA
The user needs Chrome 72+ installed. TWA falls back to Custom Tabs if Chrome is outdated.

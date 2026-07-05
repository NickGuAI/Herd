# iOS Build Guide

This guide documents how to build Herd for iOS from the macOS command line,
install it on a connected iPhone, and prepare a TestFlight archive for App
Store Connect. It reflects the current `apps/herd/ios` Capacitor 8 project
using Swift Package Manager, with no `Podfile`.

Use it when you need to ship a debug build to a development device, refresh a
sideloaded build before its provisioning profile expires, recover after an
Xcode/keychain reset wiped your signing state, or hand an operator the exact
archive/export/upload path for TestFlight.

## The Mental Model

The iOS app is a thin Capacitor shell that loads the Vite-built web app from a
bundled `public/` directory. There is no separate React Native or Swift UI tree
— `apps/herd/src` is the entire UI.

```
apps/herd/src (React/Vite)
        │  pnpm build
        v
apps/herd/dist/                       (Vite production output)
        │  cap sync ios
        v
apps/herd/ios/App/App/public/         (Capacitor copies dist into the iOS bundle)
        │  xcodebuild -project ios/App/App.xcodeproj -scheme App
        v
DerivedData/Build/Products/Debug-iphoneos/App.app  (signed for the connected device)
        │  xcrun devicectl device install app
        v
/private/var/containers/Bundle/Application/<uuid>/App.app  (on the iPhone)
        │  xcrun devicectl device process launch ai.gehirn.herd
        v
Herd launches on the device
```

Key facts:

- `webDir: 'dist'` in `capacitor.config.ts` is the only thing that ties the
  Vite output to the iOS bundle. Capacitor copies it on every `cap sync`.
- Bundle id is immutable: `ai.gehirn.herd`. The iOS display name and App
  Store Connect display name are `Herd`.
- `ios/App/App/PrivacyInfo.xcprivacy` is part of the app target's resources and
  declares QR-camera and microphone dictation data for app functionality, with
  no tracking domains.
- `ios/App/exportOptions.plist` is the checked-in App Store Connect export
  scaffold for team `YQYSGND73G`.
- On native, `Capacitor.isNativePlatform()` in `src/lib/api-base.ts` resolves
  every API and WebSocket request against the instance URL the user picks on
  the Connect screen and persists in `localStorage`. The bundle is not pinned
  to any particular backend; the hosted `https://herd.gehirn.ai` instance
  is only the default suggestion. The iOS bundle itself contains no server —
  it is purely the web client.
- The Xcode project uses Swift Package Manager via `ios/App/CapApp-SPM`. Do not
  add a `Podfile`; Capacitor 8 stopped using CocoaPods.

## Prerequisites

| Requirement | Why | Verify |
| --- | --- | --- |
| Xcode 15+ (tested with 26.2 / build 17C52) | `xcodebuild`, simulator runtimes, codesigning | `xcodebuild -version` |
| Apple ID signed into Xcode | Auto-issues `Apple Development` certificate | Xcode → Settings → Accounts |
| Codesigning identity in keychain | `xcodebuild` will refuse without one | `security find-identity -v -p codesigning` → must be ≥ 1 |
| Paid Apple Developer membership in `YQYSGND73G` | Required for App Store Connect/TestFlight archive export | App Store Connect → Users and Access |
| Apple Distribution identity for `YQYSGND73G` | Required for distribution-signed IPA export | `security find-identity -v -p codesigning` |
| iPhone in Developer Mode | iOS 16+ blocks unsigned-from-CLI installs | Settings → Privacy & Security → Developer Mode |
| Device trusted with this Mac | `xcrun devicectl` cannot tunnel otherwise | First plug-in, accept "Trust This Computer" |
| Workspace deps installed | Vite build pulls workspace packages | `pnpm install` at repo root |

The project sets `DEVELOPMENT_TEAM = YQYSGND73G` (Gehirn) and
`CODE_SIGN_STYLE = Automatic` in `ios/App/App.xcodeproj/project.pbxproj`. With
`-allowProvisioningUpdates`, `xcodebuild` will substitute your personal team if
your Apple ID is not a member of `YQYSGND73G`. That produces a working 7-day
sideload build but cannot be distributed via TestFlight; see
[Signing Notes](#signing-notes).

## One-Time Signing Setup

If `security find-identity -v -p codesigning` shows `0 valid identities`,
the keychain has no cert and no CLI tool can produce a device build. Fix it
once in Xcode:

1. Xcode → Settings (⌘,) → **Accounts** → "+" → **Add Apple ID** → sign in.
2. Select your Apple ID row. In the team list, confirm "Gehirn" is shown if you
   are a member; otherwise note your "Personal Team" id.
3. Click **Manage Certificates…** (bottom-right of the pane) → "+" →
   **Apple Development**. A new certificate row appears.
4. For TestFlight on `yus-mac-mini`, repeat the certificate flow with
   **Apple Distribution**, or have the team admin install the existing
   distribution certificate and private key on that host.
5. Re-run `security find-identity -v -p codesigning` from a terminal. You
   should see at least one identity like
   `Apple Development: <Your Name> (<TEAM_ID>)`. For TestFlight, you must also
   see an `Apple Distribution` identity for `YQYSGND73G`.

The certificate is stored in `~/Library/Keychains/login.keychain-db` and is
reused for every later build until it expires (currently 1 year).

## Build And Install Commands

From `apps/herd`:

```bash
# 1. Build web assets and sync them into the iOS bundle.
pnpm cap:build
# = pnpm build && cap sync ios
# Output: apps/herd/dist/ + apps/herd/ios/App/App/public/

# 2. Find your connected device id.
xcrun devicectl list devices
# Copy the UUID under "Identifier", e.g. 2E9B7953-32C6-5ADC-B1E9-840D21EA18D2.

# 3. Build and codesign for the connected device.
DEVICE_ID="<paste device UUID>"
DERIVED="/tmp/herd-ios-derived"
rm -rf "$DERIVED"
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -destination "id=$DEVICE_ID" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  build

# 4. Install and launch on the phone.
APP_PATH="$DERIVED/Build/Products/Debug-iphoneos/App.app"
BUNDLE_ID="ai.gehirn.herd"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"
xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID"
```

The shortcut `pnpm cap:ios` opens `ios/App/App.xcodeproj` in Xcode; from there
you can pick a destination and ⌘R, which is the recommended path when you need
breakpoints or live console output. The CLI flow above is for unattended builds
and repeated reinstalls after sideload expiry.

For simulator runs, replace the destination with
`-destination 'platform=iOS Simulator,name=iPhone 15'` and the simulator will
sign locally with `Sign to Run Locally`. No Apple ID required.

## Workspace Prep After Fresh Checkouts

The Vite build pulls in workspace packages such as `@gehirn/ai-services`. If
those packages have not been installed since you last fast-forwarded the base branch,
`pnpm cap:build` fails inside the package build with:

```
error TS2580: Cannot find name 'process'.
Do you need to install type definitions for node?
```

That is the documented "fresh worktree" state from
`.claude/rules/herd.md`. Run `pnpm install --frozen-lockfile` at the
repo root before `pnpm cap:build`.

```bash
cd <repo-root>
pnpm install --frozen-lockfile
cd apps/herd
pnpm cap:build
```

Per `.claude/rules/packages.md`, do not run root `pnpm install` casually during
targeted bug fixes — it can churn `pnpm-lock.yaml`. The frozen-lockfile variant
above is safe because it refuses any lockfile drift.

## Signing Notes

`xcodebuild -allowProvisioningUpdates` performs the same auto-provisioning that
Xcode's GUI does:

- If your Apple ID belongs to team `YQYSGND73G`, the build is signed for the
  Gehirn team and `DEVELOPMENT_TEAM` stays as configured. This is the path
  required for TestFlight distribution.
- If your Apple ID only has a personal team, `xcodebuild` substitutes your
  personal team id (for example `9RQ3P437A2`) and issues an
  `iOS Team Provisioning Profile: *` for it. The build runs on the device but
  the provisioning profile expires after 7 days and the build cannot be
  uploaded to TestFlight or App Store Connect.

Confirm what was used by scanning the `xcodebuild` output for `CodeSign`:

```
Signing Identity:     "Apple Development: Yu Gu (9RQ3P437A2)"
Provisioning Profile: "iOS Team Provisioning Profile: *"
                      (ad7bf4aa-3ba1-42b0-8f2c-ca388f40960c)
```

If you intend a Gehirn-team build but see your personal team id, ask the team
admin to add your Apple ID to `YQYSGND73G` in App Store Connect, then
re-run `Manage Certificates…` in Xcode and rebuild.

## Signing Host Readiness

`yus-mac-mini` is the designated signing-capable host for TestFlight exports.
Run this machine check before attempting an archive:

```bash
sw_vers
xcodebuild -version
xcodebuild -showsdks | grep -E 'iOS.*SDK'
security find-identity -v -p codesigning | grep 'Apple Distribution'
cd <repo-root>/apps/herd
xcodebuild -list -project ios/App/App.xcodeproj
```

Expected evidence:

- `xcodebuild -version` reports Xcode 15 or newer.
- `xcodebuild -showsdks` lists an iOS SDK.
- `security find-identity` includes an `Apple Distribution` identity for team
  `YQYSGND73G`.
- `xcodebuild -list` resolves the Swift Package Manager graph and lists the
  `App` scheme.

If any item fails, do not attempt a TestFlight archive. Fix Xcode first, sign
into the `YQYSGND73G` team in Xcode Settings, or install the distribution
certificate/private key supplied by the team admin.

## App Store Connect Setup

The repository cannot create Apple portal resources. The operator must verify
or create these records before the first upload:

1. Apple Developer Program enrollment is paid and active for team
   `YQYSGND73G`.
2. Certificates, Identifiers & Profiles has bundle id `ai.gehirn.herd`.
   Do not change the bundle id in Xcode or App Store Connect.
3. An App Store provisioning profile exists for `ai.gehirn.herd`, or Xcode
   automatic signing is allowed to create/update the profile during archive.
4. App Store Connect has an iOS app record:
   - Name: `Herd`
   - Bundle ID: `ai.gehirn.herd`
   - SKU: any stable internal SKU, for example `herd-ios`

Record portal evidence on the GitHub issue, not in the repo: enrollment/team
proof, certificate/profile names or IDs, App Store Connect app ID, and upload
or processing screenshots.

## TestFlight Archive And Export

These commands prepare a distribution-signed IPA. Run them only on
`yus-mac-mini` after [Signing Host Readiness](#signing-host-readiness) and
[App Store Connect Setup](#app-store-connect-setup) are complete.

```bash
cd <repo-root>/apps/herd

# 1. Build web assets and sync generated Capacitor files.
pnpm cap:build

# 2. Archive for generic iOS distribution.
ARCHIVE_PATH="$PWD/ios/App/build/Herd.xcarchive"
EXPORT_PATH="$PWD/ios/App/build/TestFlight"
rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH"
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  archive

# 3. Export an App Store Connect IPA using the checked-in scaffold.
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist ios/App/exportOptions.plist \
  -allowProvisioningUpdates

# 4. Confirm the export artifacts before uploading.
ls "$EXPORT_PATH"/*.ipa "$EXPORT_PATH"/ExportOptions.plist
plutil -p "$EXPORT_PATH"/ExportOptions.plist | grep -E 'method|teamID|distributionBundleIdentifier'
```

The checked-in `ios/App/exportOptions.plist` uses:

- `method = app-store-connect`
- `destination = export`
- `teamID = YQYSGND73G`
- `distributionBundleIdentifier = ai.gehirn.herd`
- automatic signing, Swift symbol stripping, symbol upload enabled, and App
  Store information generation enabled

Upload is operator-side. Use Xcode Organizer, Transporter, or the App Store
Connect upload command approved for the signing host. If using `altool`, the
shape is:

```bash
IPA_PATH="$(ls "$EXPORT_PATH"/*.ipa | head -n 1)"
xcrun altool --upload-app \
  -f "$IPA_PATH" \
  -t ios \
  -u "$ASC_USERNAME" \
  -p "$ASC_APP_SPECIFIC_PASSWORD"
```

Do not commit Apple credentials, app-specific passwords, API keys, upload logs
with tokens, or portal screenshots.

## TestFlight Install Check

After App Store Connect processes the build:

1. Add the build to an internal TestFlight group.
2. Install Herd from TestFlight on a physical iPhone.
3. Open the app, enter the live instance URL and pairing invite or scoped API
   key, and confirm the app reaches the normal Herd web experience.
4. Record the processed build number, tester device, instance URL hostname, and
   pass/fail result on the issue.

## Runtime Configuration On Device

The iOS app loads bundled assets but talks to a remote Herd/Herd
instance the user picks on first launch. Three things must be true for sign-in
to work:

1. The target instance must allow `capacitor://localhost` in
   `HERD_ALLOWED_ORIGINS` (CORS). The hosted `https://herd.gehirn.ai`
   instance is already configured; for a self-hosted instance, add
   `capacitor://localhost` to that deployment's allow-list and restart it.
2. Auth0 redirects do not reliably return to the app from Safari. Use API-key
   sign-in instead. Create a mobile-scoped key from the **/api-keys** UI on the
   target instance, or generate a one-time mobile pairing invite from
   **Settings -> Mobile Access**.

3. On the Connect screen, enter the instance URL (default
   `https://herd.gehirn.ai`, editable for self-hosted instances) and paste
   the API key. The app verifies both before storing them. Sign out clears
   both the stored URL and the key.

The native API/WebSocket base URL is decided in `src/lib/api-base.ts`. On
`Capacitor.isNativePlatform()`, `getApiBase()` reads
`localStorage.herd_instance_url` (set by the Connect screen). There is no
hardcoded backend in the bundle.

## Manual Voice Capture Checklist

Use this after changing mobile voice capture, realtime transcription, or iOS
permission metadata:

- Install a fresh iOS build, open Command Room, and tap the microphone button.
- Confirm iOS shows the microphone permission prompt and the copy matches
  `NSMicrophoneUsageDescription`.
- Allow microphone access, speak for at least one second, stop recording, and
  confirm the transcript appears in the composer.
- Deny microphone access on a reinstall or after resetting app permissions, tap
  the microphone button again, and confirm the app surfaces a start failure
  instead of leaving the microphone visually active but inert.

## Re-Syncing After Changes

Web changes do not require a full Xcode rebuild every time, but `dist/` and the
iOS bundle's `public/` must be back in sync before any device run.

| Change | Run |
| --- | --- |
| Anything in `apps/herd/src` or `modules/` | `pnpm cap:build` (rebuilds `dist/` + `cap sync`) |
| Only `apps/herd/dist/` is stale | `pnpm cap:sync` (skips Vite, just copies `dist`) |
| Added/removed a Capacitor plugin | `pnpm cap:sync` then ⇧⌘K in Xcode (clean SPM cache) |
| Native iOS code under `ios/App/App/` | `xcodebuild build` (Vite build is unnecessary) |
| Provisioning profile expired (after ~7 days on personal team) | Re-run steps 3–4 from [Build And Install Commands](#build-and-install-commands) |

You do not need to delete the old app from the phone between reinstalls;
`devicectl device install app` overwrites the existing bundle when the bundle
id and signing identity match.

## Troubleshooting Map

`security find-identity -v -p codesigning` returns 0 identities:

- Sign in to Xcode and click `Manage Certificates… → + → Apple Development`.
  Signing in alone does not issue the cert; the explicit Manage Certificates
  step does.

`pnpm cap:build` fails with `TS2580 Cannot find name 'process'`:

- Workspace deps are not installed for `@gehirn/ai-services` or another
  package. Run `pnpm install --frozen-lockfile` at the repo root and retry.

`xcodebuild` exits with `Failed to register bundle identifier` or
`No profiles for 'ai.gehirn.herd' were found`:

- Your Apple ID is not a member of `YQYSGND73G` and `-allowProvisioningUpdates`
  could not substitute a personal team. Either join the team or change
  `DEVELOPMENT_TEAM` in `ios/App/App.xcodeproj/project.pbxproj` to your
  personal team id for local builds only — do not commit that change.

`xcrun devicectl list devices` shows the phone as
`connected (unavailable)` or does not list it at all:

- The device is locked or has not trusted this Mac. Unlock and accept the
  trust prompt. iOS 16+ also requires Developer Mode under
  Settings → Privacy & Security.

`xcrun devicectl device install app` succeeds but the app crashes on launch:

- The web bundle inside `ios/App/App/public/` is stale or empty. Re-run
  `pnpm cap:build` and verify `dist/index.html` exists before `cap sync`.

API calls in the app return CORS or 401:

- The server is not allowing `capacitor://localhost`. Check
  `HERD_ALLOWED_ORIGINS` on the target server.
- Or the API key is missing or revoked. Recreate it from the API keys UI, or
  generate a new mobile pairing invite from **Settings -> Mobile Access**.

App opens but shows a blank white screen:

- Open Safari → Develop → `<device name>` → `Herd` and inspect the WebView
  console. Most often this is a Vite asset-resolution issue where
  `dist/index.html` references files that are not in
  `ios/App/App/public/` because `cap sync` was skipped.

## Sanity Tests After A Build

Quick checks to run before declaring a build healthy:

```bash
# Bundle id baked into the .app
plutil -p /tmp/herd-ios-derived/Build/Products/Debug-iphoneos/App.app/Info.plist \
  | grep CFBundleIdentifier
# Expect: "CFBundleIdentifier" => "ai.gehirn.herd"
plutil -p /tmp/herd-ios-derived/Build/Products/Debug-iphoneos/App.app/Info.plist \
  | grep CFBundleDisplayName
# Expect: "CFBundleDisplayName" => "Herd"

# Web assets present
ls apps/herd/ios/App/App/public/index.html
ls apps/herd/ios/App/App/public/assets | head

# Process is running on device after launch
xcrun devicectl device info processes --device "$DEVICE_ID" \
  | grep ai.gehirn.herd
```

If any of those fail, return to the matching section above before iterating
on UI or server behavior — a broken pipeline can masquerade as a runtime bug.

## What This Guide Does Not Cover

- Creating Apple portal resources or running the upload from an unattended
  agent. Paid enrollment, App Store Connect app records, distribution
  certificates, provisioning profiles, TestFlight groups, and physical-device
  installation evidence stay operator-side.
- Push notifications, App Groups, or any other capability requiring
  entitlements changes. The current project ships with the default automatic
  entitlements only.
- Building for the Mac Catalyst destination. Capacitor supports it, but it is
  not wired into the project's scheme.

# ALMAS SDM shop app

The shop management client, package `pk.almassdm.shop`, is separate from the financed-handset DPC and SMS relay. Native Android screens introduce the product and provide splash animation, account entry, offline recovery, camera/photo selection, document saving and printing. The authenticated business interface uses the same HTTPS dashboard, roles and server records as the website.

## Distributions

- `directRelease`: full website account functionality, including existing license ordering. Signed APK for direct installation.
- `playRelease`: consumption-only licensing presentation. Business operations, existing licenses, account signup and device management remain available; the app does not steer users to external lock-pack checkout. Signup can create an account without a purchase request. Signed AAB for Play Console, plus an APK for internal validation.

Play still requires the owner's developer account, correct declarations, reviewer access and applicable testing/review before publication. A compiled, signed bundle does not itself establish store approval. Account deletion is initiated through the public support request page; support must actually verify and fulfill requests, including explaining retained active financial/contract records.

## Build

From `android/`, use JDK 17+, the Android 36 SDK and the existing company signing configuration described in `android/RELEASE.md`:

```
./gradlew :shop:testDirectDebugUnitTest :shop:testPlayDebugUnitTest :shop:lintDirectRelease :shop:lintPlayRelease :shop:assembleDirectRelease :shop:assemblePlayRelease :shop:bundlePlayRelease
```

Release configuration always targets `https://app.almassdm.pro`. The optional `-Palmassdm.shopTestOrigin=http://10.0.2.2:5195` changes only debug builds and permits only the emulator's host loopback. Release traffic remains HTTPS-only. Session files are excluded from backup and device transfer. Camera access is requested when used; there are no SMS, contacts, background location, phone-ID or device-admin permissions in this app.

Robolectric UI/security tests cover account entry, restricted navigation, file types and native rendering. Browser tests exercise the shared dashboard, mobile sections, exports and account-only signup. A physical-device camera/document-picker acceptance pass remains distinct from those tests. No existing handset was reset, updated, enrolled or controlled during this release.

## Play listing URLs

Privacy: https://app.almassdm.pro/privacy

Account deletion request: https://app.almassdm.pro/account-deletion

Support: +92 321 1144477

Google references: [target SDK](https://developer.android.com/google/play/requirements/target-sdk), [account deletion](https://support.google.com/googleplay/android-developer/answer/13327111), [consumption-only apps](https://support.google.com/googleplay/android-developer/answer/10281818), [store graphics](https://support.google.com/googleplay/android-developer/answer/9866151).

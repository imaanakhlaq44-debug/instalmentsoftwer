# Website APK → Google Play: preserve the account and installed app

The current website APK and Play flavor both use package `pk.almassdm.shop` and the same production service `https://app.almassdm.pro`. Saved customers, phones, financing plans, payments and signed agreements are server records, associated with the authenticated account/shop, not a separate local APK database. The user should sign in to the same account after any reinstall or on a different phone; creating a new shop/account is not a migration.

Current public release: 1.1.0 / versionCode 2. All later published builds, including the first Play release intended to update website installs, must use a higher versionCode.

Current app signing certificate SHA-256:
`306e17c3d3eaf8ca5182d8722efe6200b6210bc9ae345d046852ca8fe9a5d959`

## Required when first setting up Play App Signing

Use the **existing app signing key**, securely transferred with Google's PEPK process. Do not choose a newly Google-generated app signing key for this app if seamless updates from the currently distributed website APK are required. The locally held key is the actual signing key of the website APK, even though the local alias/file calls it an upload key. Signing an AAB with it alone does not control the certificate Google uses for delivered APKs.

After enrolling the existing signing key, a separate upload key can be configured if desired. Keep the app signing key and its protected local credentials out of source control, website downloads and normal delivery ZIPs. Do not rotate the current key or change the package during this transition.

Before production Play rollout:

1. Build a newer versionCode against the same backend/account system.
2. Download the actual Google-signed distribution APK from Play Console and verify its app-signing certificate against the digest above.
3. On a dedicated test phone/account, install the public website APK, save sample business data, then update to the Play-delivered build **without uninstalling**. Check login/session, shop scope and saved records.
4. Separately sign in on a clean install to verify server data recovery. Unsaved form drafts are not saved server records and should be completed before updating.

The Play edition omits digital-license purchasing from its interface; this does not create a separate shop account or separate financial database. These settings must be completed and tested in the owner's Play Console when publishing; no Play App Signing enrollment or publication has been performed by this release.

Official guidance:
https://developer.android.com/studio/publish/app-signing
https://support.google.com/googleplay/android-developer/answer/9842756

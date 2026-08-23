import java.io.FileInputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * The release signing key.
 *
 * This is the most consequential secret in the product. The QR a factory-reset
 * handset scans carries the SHA-256 of this certificate, and the setup wizard
 * refuses to install anything that does not match — which is exactly what stops
 * a lookalike APK being provisioned as the owner of somebody's phone. It also
 * cannot be rotated casually: an APK signed with a different key will not
 * update an installed one, and a handset that is device owner cannot be
 * factory-reset by the customer to fix it.
 *
 * So it is never in the repository. It comes from `android/keystore.properties`
 * (git-ignored) on a developer's machine, or from environment variables in CI:
 *
 *     ALMAS_KEYSTORE_FILE       path to the .jks
 *     ALMAS_KEYSTORE_PASSWORD
 *     ALMAS_KEY_ALIAS
 *     ALMAS_KEY_PASSWORD
 *
 * When none of it is configured the release build is simply left unsigned, so
 * `assembleDebug`, the unit tests and CI all keep working on a machine that has
 * no business holding the key.
 */
val keystoreProperties = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) FileInputStream(file).use { load(it) }
}

fun signingSecret(propertyName: String, environmentName: String): String? =
    (keystoreProperties.getProperty(propertyName) ?: System.getenv(environmentName))
        ?.takeIf { it.isNotBlank() }

val keystorePath = signingSecret("storeFile", "ALMAS_KEYSTORE_FILE")
val keystorePassword = signingSecret("storePassword", "ALMAS_KEYSTORE_PASSWORD")
val releaseKeyAlias = signingSecret("keyAlias", "ALMAS_KEY_ALIAS")
val releaseKeyPassword = signingSecret("keyPassword", "ALMAS_KEY_PASSWORD")

val releaseSigningConfigured =
    keystorePath != null && keystorePassword != null && releaseKeyAlias != null && releaseKeyPassword != null

android {
    namespace = "pk.almassdm.dpc"
    compileSdk = 36

    defaultConfig {
        applicationId = "pk.almassdm.dpc"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "1.0.1"

        buildConfigField(
            "String",
            "DEFAULT_SERVER_URL",
            "\"${project.findProperty("almassdm.defaultServerUrl") ?: "http://10.0.2.2:5000/api/dpc"}\""
        )
    }

    signingConfigs {
        if (releaseSigningConfigured) {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = keystorePassword
                // Named `releaseKeyAlias` / `releaseKeyPassword` rather than
                // matching the properties: inside this block a bare `keyAlias`
                // resolves to the property being assigned, not to the value
                // read from the keystore file, and the build then fails at
                // packaging with "missing required property".
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword

                // APK Signature Scheme v2 arrived in Android 7.0 and this app's
                // minSdk is 26, so every handset that can install it can verify
                // it this way. v1 (JAR signing) would add nothing but a slower
                // install and a larger APK.
                enableV1Signing = false
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        debug {
            // Only the debug build trusts plaintext HTTP, and only to the
            // emulator's view of the host machine. A shipped APK talks HTTPS.
            manifestPlaceholders["networkSecurityConfig"] = "@xml/network_security_config_debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            manifestPlaceholders["networkSecurityConfig"] = "@xml/network_security_config"

            // Left unsigned rather than failing when no key is configured, so a
            // machine without the keystore can still compile the release build.
            // `verifyReleaseSigned` is what refuses to let an unsigned one be
            // mistaken for something publishable.
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

/**
 * Prints `DPC_APK_SIGNATURE_CHECKSUM` for the configured signing key.
 *
 * This exists because the value is easy to get wrong and the failure is
 * miserable: a factory-reset phone downloads the APK, refuses to install it,
 * and abandons provisioning with a message that says nothing useful. The wizard
 * wants the SHA-256 of the signing **certificate** — not of the APK file, not
 * the SHA-1 fingerprint `keytool` prints most prominently — base64url encoded
 * with the padding stripped. Three chances to be subtly wrong by hand, so it is
 * computed here instead.
 */
tasks.register("printSigningCertChecksum") {
    group = "almas sdm"
    description = "Prints the base64url SHA-256 of the release signing certificate."

    doLast {
        check(releaseSigningConfigured) {
            "No signing key is configured. Create android/keystore.properties, or set " +
                "ALMAS_KEYSTORE_FILE, ALMAS_KEYSTORE_PASSWORD, ALMAS_KEY_ALIAS and ALMAS_KEY_PASSWORD."
        }

        val store = file(keystorePath!!)
        check(store.exists()) { "The keystore was not found at ${store.absolutePath}." }

        // Java 9+ detects PKCS12 or JKS from the file itself, so a keystore made
        // by any recent keytool is read without naming its format here.
        val keyStore = KeyStore.getInstance(store, keystorePassword!!.toCharArray())
        val certificate = keyStore.getCertificate(releaseKeyAlias!!)
            ?: error("The keystore has no certificate under the alias '$releaseKeyAlias'.")

        val encoded = (certificate as X509Certificate).encoded
        val checksum = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(MessageDigest.getInstance("SHA-256").digest(encoded))

        logger.lifecycle("")
        logger.lifecycle("Certificate : ${certificate.subjectX500Principal}")
        logger.lifecycle("Expires     : ${certificate.notAfter}")
        logger.lifecycle("")
        logger.lifecycle("DPC_APK_SIGNATURE_CHECKSUM=$checksum")
        logger.lifecycle("")
    }
}

/**
 * Refuses to hand over a release APK that nothing signed.
 *
 * Without this the release build succeeds unsigned, produces
 * `app-release-unsigned.apk`, and somebody uploads it. Every phone that
 * downloads it then refuses to install it, having verified honestly that it
 * matches no certificate at all.
 */
tasks.register("verifyReleaseSigned") {
    group = "almas sdm"
    description = "Fails unless a signing key is configured for the release build."

    doLast {
        check(releaseSigningConfigured) {
            "The release APK would be unsigned, and no handset will install it. Configure the signing " +
                "key before building a release — see android/RELEASE.md."
        }
    }
}

tasks.matching { it.name == "assembleRelease" }.configureEach {
    dependsOn("verifyReleaseSigned")
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    testImplementation("junit:junit:4.13.2")
    // android.jar's org.json is a stub that throws; the real implementation
    // makes the parsing tests exercise the parser rather than a mock.
    testImplementation("org.json:json:20240303")
}

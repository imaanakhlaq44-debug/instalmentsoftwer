import java.util.Properties
import java.io.FileInputStream
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
val keys = Properties().apply { val f = rootProject.file("keystore.properties"); if (f.exists()) FileInputStream(f).use { load(it) } }
fun secret(key: String, env: String) = (keys.getProperty(key) ?: System.getenv(env))?.takeIf { it.isNotBlank() }
val storePath = secret("storeFile", "ALMAS_KEYSTORE_FILE")
val storePass = secret("storePassword", "ALMAS_KEYSTORE_PASSWORD")
val aliasValue = secret("keyAlias", "ALMAS_KEY_ALIAS")
val keyPass = secret("keyPassword", "ALMAS_KEY_PASSWORD")
val signed = listOf(storePath, storePass, aliasValue, keyPass).all { it != null }
android {
    namespace = "pk.almassdm.shop"
    compileSdk = 36
    defaultConfig {
        applicationId = "pk.almassdm.shop"
        minSdk = 26
        targetSdk = 36
        versionCode = 9
        versionName = "1.2.3"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "APP_ORIGIN", "\"https://app.almassdm.pro\"")
    }
    signingConfigs {
        if (signed) create("release") {
            storeFile = file(storePath!!); storePassword = storePass
            keyAlias = aliasValue; keyPassword = keyPass
            enableV1Signing = false; enableV2Signing = true
        }
    }
    flavorDimensions += "distribution"
    productFlavors {
        create("direct") { dimension = "distribution"; buildConfigField("boolean", "PLAY_STORE", "false") }
        create("play") { dimension = "distribution"; buildConfigField("boolean", "PLAY_STORE", "true") }
    }
    buildTypes {
        debug {
            applicationIdSuffix = ".debug"; versionNameSuffix = "-test"
            val testOrigin = (project.findProperty("almassdm.shopTestOrigin") as String?) ?: "https://app.almassdm.pro"
            // 10.0.2.2 is the emulator's view of this computer; 127.0.0.1 is a real phone on USB after `adb reverse`.
            require(testOrigin == "https://app.almassdm.pro" || testOrigin.matches(Regex("http://(10\\.0\\.2\\.2|127\\.0\\.0\\.1):[0-9]{4,5}")))
            buildConfigField("String", "APP_ORIGIN", "\"$testOrigin\"")
        }
        release {
            isMinifyEnabled = true; isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
    testOptions { unitTests.isReturnDefaultValues = true; unitTests.isIncludeAndroidResources = true }
}
tasks.register("verifyReleaseSigned") { doLast { check(signed) { "Configure the existing company signing key before a release build." } } }
tasks.matching { it.name.matches(Regex("(?:assemble|bundle)(?:Direct|Play)Release")) }.configureEach { dependsOn("verifyReleaseSigned") }
dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    // Reads the CNIC front on the phone itself: bundled model, works offline, the photo never leaves the phone.
    implementation("com.google.mlkit:text-recognition:16.0.1")
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}



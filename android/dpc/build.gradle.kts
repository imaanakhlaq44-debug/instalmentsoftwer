plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "pk.emishield.dpc"
    compileSdk = 36

    defaultConfig {
        applicationId = "pk.emishield.dpc"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField(
            "String",
            "DEFAULT_SERVER_URL",
            "\"${project.findProperty("emishield.defaultServerUrl") ?: "http://10.0.2.2:5000/api/dpc"}\""
        )
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

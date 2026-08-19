pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "EMI Shield Android"

// Two apps, on two different phones.
//   :dpc       — the customer's handset. Enforces the lock.
//   :sms-relay — the shop's own handset. Sends the messages.
// They share nothing but this build, and that is deliberate: the relay must
// never end up installed on a financed phone, nor the DPC on the counter's.
include(":dpc")
include(":sms-relay")

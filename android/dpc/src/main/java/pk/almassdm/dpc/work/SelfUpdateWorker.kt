package pk.almassdm.dpc.work

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import pk.almassdm.dpc.BuildConfig
import pk.almassdm.dpc.admin.LockController
import pk.almassdm.dpc.data.Prefs
import pk.almassdm.dpc.data.UpdateOffer
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Downloads, checks and silently installs a newer build of this app.
 *
 * A device owner may install packages without asking anyone, which is the only
 * way a fleet of phones in customers' pockets ever gets a fix. Each step can
 * only make it safer to refuse:
 *
 * 1. HTTPS only (the network security config forbids anything else anyway).
 * 2. The file's SHA-256 must equal the one the server announced.
 * 3. The archive must be this package, at exactly the announced versionCode.
 * 4. Android refuses an update signed with a different key.
 * 5. Not while the phone is locked; checked again just before installing.
 *
 * A failure is remembered, so the same version is not retried for a day.
 * The result arrives in [SelfUpdateResultReceiver]; after a successful update
 * the new app starts again through [BootReceiver] (MY_PACKAGE_REPLACED).
 */
class SelfUpdateWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val prefs = Prefs(applicationContext)
        val offer = UpdateOffer(
            versionCode = inputData.getInt(KEY_VERSION, 0),
            url = inputData.getString(KEY_URL).orEmpty(),
            sha256 = inputData.getString(KEY_SHA).orEmpty(),
        )
        val controller = LockController(applicationContext)
        if (!UpdateOffer.shouldInstall(
                offer, BuildConfig.VERSION_CODE, controller.isDeviceOwner, prefs.lockApplied,
                prefs.updateFailedVersion, prefs.updateFailedAt, System.currentTimeMillis()
            )
        ) {
            return@withContext Result.success()
        }

        val apk = File(applicationContext.cacheDir, "update.apk")
        try {
            download(offer.url, apk, offer.sha256)
            checkArchive(apk, offer.versionCode)
            // The lock may have arrived while downloading.
            if (prefs.lockApplied) {
                Log.i(TAG, "Phone locked during download; installing after unlock.")
                return@withContext Result.success()
            }
            install(apk, offer.versionCode)
            Log.i(TAG, "Installing version ${offer.versionCode}.")
            Result.success()
        } catch (e: Exception) {
            Log.w(TAG, "Update to ${offer.versionCode} failed: ${e.message}")
            markFailed(applicationContext, offer.versionCode)
            apk.delete()
            Result.success()
        }
    }

    private fun download(url: String, target: File, expectedSha256: String) {
        if (!url.startsWith("https://")) throw IllegalStateException("Not an HTTPS URL.")
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20_000
            readTimeout = 60_000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "AlmasSdmDPC/" + BuildConfig.VERSION_NAME)
        }
        try {
            if (connection.responseCode != 200) throw IllegalStateException("HTTP ${connection.responseCode}")
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            connection.inputStream.use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        if (total > MAX_BYTES) throw IllegalStateException("Download too large.")
                        digest.update(buffer, 0, read)
                        output.write(buffer, 0, read)
                    }
                }
            }
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (actual != expectedSha256) throw SecurityException("Checksum mismatch.")
        } finally {
            connection.disconnect()
        }
    }

    @Suppress("DEPRECATION")
    private fun checkArchive(apk: File, expectedVersion: Int) {
        val info: PackageInfo = applicationContext.packageManager.getPackageArchiveInfo(apk.path, 0)
            ?: throw IllegalStateException("Not a readable APK.")
        val version = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode.toInt() else info.versionCode
        if (info.packageName != applicationContext.packageName) throw SecurityException("Wrong package.")
        if (version != expectedVersion) throw SecurityException("Wrong version ($version).")
    }

    private fun install(apk: File, versionCode: Int) {
        val installer = applicationContext.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(applicationContext.packageName)
            setSize(apk.length())
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("base.apk", 0, apk.length()).use { output ->
                    input.copyTo(output)
                    session.fsync(output)
                }
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            val status = PendingIntent.getBroadcast(
                applicationContext,
                sessionId,
                Intent(applicationContext, SelfUpdateResultReceiver::class.java)
                    .putExtra(SelfUpdateResultReceiver.EXTRA_VERSION, versionCode),
                flags
            )
            session.commit(status.intentSender)
        }
    }

    companion object {
        private const val TAG = "SelfUpdate"
        private const val WORK_NAME = "almas-sdm-self-update"
        private const val KEY_VERSION = "versionCode"
        private const val KEY_URL = "url"
        private const val KEY_SHA = "sha256"
        private const val MAX_BYTES = 60L * 1024 * 1024

        fun enqueue(context: Context, offer: UpdateOffer) {
            val request = OneTimeWorkRequestBuilder<SelfUpdateWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInputData(
                    Data.Builder()
                        .putInt(KEY_VERSION, offer.versionCode)
                        .putString(KEY_URL, offer.url)
                        .putString(KEY_SHA, offer.sha256)
                        .build()
                )
                .build()
            // KEEP: a check-in every 15 minutes must not restart a download in progress.
            WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }

        fun markFailed(context: Context, versionCode: Int) {
            val prefs = Prefs(context)
            prefs.updateFailedVersion = versionCode
            prefs.updateFailedAt = System.currentTimeMillis()
        }
    }
}

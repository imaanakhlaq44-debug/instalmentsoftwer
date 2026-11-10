package pk.almassdm.dpc.admin

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.cert.Certificate
import java.security.spec.ECGenParameterSpec
import java.util.Base64

/**
 * Asks the phone's secure chip (TEE or StrongBox) to vouch for this handset.
 *
 * As Device Owner the app can request *ID attestation*: the chip signs a
 * certificate that includes the IMEI(s) and serial number written into it at
 * the factory, plus whether the bootloader is locked. Changing the modem IMEI
 * with a flashing box, or hooking `getImei()` on a rooted phone, does not
 * change what the chip signs — and the signature chains up to Google, so the
 * server can check it without trusting this app or the OS around it.
 *
 * The key is throwaway: generated, its certificate chain read, deleted.
 * Falls back step by step (no IMEI → no IDs → plain keystore attestation) so a
 * phone that cannot do the full version still proves what it can.
 */
object KeyAttestor {

    private const val TAG = "KeyAttestor"
    private const val ALIAS = "almas-sdm-attestation"

    fun attest(context: Context, challenge: ByteArray): AttestationReport {
        val app = context.applicationContext
        val errors = mutableListOf<String>()

        val dpm = app.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
        val isOwner = dpm?.isDeviceOwnerApp(app.packageName) == true

        if (isOwner && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val admin = AlmasDeviceAdminReceiver.componentName(app)
            val attempts = listOf(
                DevicePolicyManager.ID_TYPE_BASE_INFO or DevicePolicyManager.ID_TYPE_SERIAL or DevicePolicyManager.ID_TYPE_IMEI,
                DevicePolicyManager.ID_TYPE_BASE_INFO or DevicePolicyManager.ID_TYPE_SERIAL,
                DevicePolicyManager.ID_TYPE_BASE_INFO,
            )
            for (flags in attempts) {
                try {
                    val pair = dpm!!.generateKeyPair(admin, KeyProperties.KEY_ALGORITHM_EC, spec(challenge), flags)
                    val chain = pair?.attestationRecord.orEmpty()
                    runCatching { dpm.removeKeyPair(admin, ALIAS) }
                    if (chain.isNotEmpty()) {
                        return AttestationReport(
                            chain = encode(chain),
                            idsAttested = flags and DevicePolicyManager.ID_TYPE_IMEI != 0,
                            error = errors.joinToString("; ").ifBlank { null },
                        )
                    }
                    errors += "flags=$flags: empty chain"
                } catch (e: Exception) {
                    // Common reasons: the OEM did not provision IDs (some budget
                    // phones), or no telephony for IMEI. Try with less.
                    errors += "flags=$flags: ${e.javaClass.simpleName}"
                    runCatching { dpm!!.removeKeyPair(admin, ALIAS) }
                }
            }
        }

        // Plain keystore attestation: no IDs, but still the chip's word on the
        // bootloader and boot state.
        return try {
            val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            generator.initialize(spec(challenge))
            generator.generateKeyPair()
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val chain = store.getCertificateChain(ALIAS)?.toList().orEmpty()
            runCatching { store.deleteEntry(ALIAS) }
            AttestationReport(encode(chain), idsAttested = false, error = errors.joinToString("; ").ifBlank { null })
        } catch (e: Exception) {
            Log.w(TAG, "Attestation unavailable: ${e.message}")
            errors += "keystore: ${e.javaClass.simpleName}"
            AttestationReport(emptyList(), idsAttested = false, error = errors.joinToString("; "))
        }
    }

    private fun spec(challenge: ByteArray): KeyGenParameterSpec =
        KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setAttestationChallenge(challenge)
            .build()

    private fun encode(chain: List<Certificate>): List<String> =
        chain.take(8).map { Base64.getEncoder().encodeToString(it.encoded) }
}

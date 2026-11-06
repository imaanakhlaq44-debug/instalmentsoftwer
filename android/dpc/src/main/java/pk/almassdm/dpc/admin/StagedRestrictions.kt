package pk.almassdm.dpc.admin

/**
 * What a restriction level means on this handset, worked out without touching
 * Android, so it can be unit-tested on the JVM.
 *
 *   level 0  nothing
 *   level 1  no outgoing calls, no SMS
 *   level 2  level 1, plus the server's list of apps suspended
 *
 * A full lock is not a level: it is the separate lock-task mechanism, and it is
 * applied on top of whatever level the phone is at.
 *
 * Android keeps emergency calls working under DISALLOW_OUTGOING_CALLS, and
 * incoming calls are untouched at every level. A suspended app stays installed
 * with all its data; it simply cannot be opened until it is unsuspended.
 */
object StagedRestrictions {

    /** UserManager.DISALLOW_OUTGOING_CALLS and DISALLOW_SMS, as their string values. */
    const val NO_OUTGOING_CALLS = "no_outgoing_calls"
    const val NO_SMS = "no_sms"

    val LEVEL_ONE_RESTRICTIONS = listOf(NO_OUTGOING_CALLS, NO_SMS)

    data class Plan(
        val addRestrictions: List<String>,
        val clearRestrictions: List<String>,
        val suspend: List<String>,
        val unsuspend: List<String>,
    ) {
        val isEmpty: Boolean
            get() = addRestrictions.isEmpty() && clearRestrictions.isEmpty() && suspend.isEmpty() && unsuspend.isEmpty()
    }

    /**
     * The changes that take the handset from what it has now to [level].
     *
     * @param requestedApps apps the server wants suspended at level 2
     * @param installed which of those are actually on this phone
     * @param suspendedNow apps this app suspended earlier and has not released
     * @param restrictionsOn whether the level-one restrictions are currently set
     */
    fun plan(
        level: Int,
        requestedApps: List<String>,
        installed: Set<String>,
        suspendedNow: Set<String>,
        restrictionsOn: Boolean,
    ): Plan {
        val target = level.coerceIn(0, 2)
        val wantRestrictions = target >= 1
        val wantSuspended: Set<String> =
            if (target >= 2) requestedApps.filter { it in installed }.toSet() else emptySet()

        return Plan(
            addRestrictions = if (wantRestrictions && !restrictionsOn) LEVEL_ONE_RESTRICTIONS else emptyList(),
            clearRestrictions = if (!wantRestrictions && restrictionsOn) LEVEL_ONE_RESTRICTIONS else emptyList(),
            suspend = (wantSuspended - suspendedNow).sorted(),
            unsuspend = (suspendedNow - wantSuspended).sorted(),
        )
    }
}

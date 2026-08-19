package pk.emishield.dpc

import android.app.Application
import pk.emishield.dpc.data.Prefs
import pk.emishield.dpc.work.CheckInScheduler

class EmiApp : Application() {

    override fun onCreate() {
        super.onCreate()

        // An enrolled phone must always have a heartbeat pending. Re-asserting
        // it on every process start costs nothing (the request is unique and
        // kept, not replaced) and covers a job dropped by a force-stop or by
        // an aggressive battery manager.
        val prefs = Prefs(this)
        if (prefs.isEnrolled) {
            CheckInScheduler.schedule(this, prefs.checkInIntervalSeconds)
        }
    }
}

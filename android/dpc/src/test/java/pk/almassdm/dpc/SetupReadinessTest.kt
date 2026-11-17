package pk.almassdm.dpc
import org.junit.Assert.*
import org.junit.Test
import pk.almassdm.dpc.net.SetupReadiness
class SetupReadinessTest {
 @Test fun incompleteDeviceSetupStaysPending(){assertFalse(SetupReadiness.ready(0,1,true))}
 @Test fun incompleteUserSetupStaysPending(){assertFalse(SetupReadiness.ready(1,0,true))}
 @Test fun missingDeviceOwnerStaysPending(){assertFalse(SetupReadiness.ready(1,1,false))}
 @Test fun onlyFullyProvisionedOwnerCanConfirm(){assertTrue(SetupReadiness.ready(1,1,true))}
}

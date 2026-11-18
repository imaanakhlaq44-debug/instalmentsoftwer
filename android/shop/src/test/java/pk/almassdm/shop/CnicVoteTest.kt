package pk.almassdm.shop

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class CnicVoteTest {
    private fun card(cnic: String? = null, name: String? = null, expiry: LocalDate? = null) =
        CnicCard(cnic, name, null, null, expiry, lifetime = false)

    @Test fun oneFrameIsNotEnough() {
        val vote = CnicVote()
        vote.add(card("35202-1234567-1", "Muhammad Aslam"))
        assertFalse(vote.cnicConfirmed)
        assertFalse(vote.complete)
        assertNull(vote.result().cnic)
        assertTrue(vote.seenAnything)
    }

    @Test fun twoAgreeingFramesConfirm() {
        val vote = CnicVote()
        vote.add(card("35202-1234567-1", "MUHAMMAD  ASLAM"))
        vote.add(card("35202-1234567-1", "Muhammad Aslam"))
        assertTrue(vote.complete)
        assertEquals("35202-1234567-1", vote.result().cnic)
        assertEquals("Muhammad Aslam", vote.result().name)
    }

    @Test fun aMisreadFrameIsOutvoted() {
        val vote = CnicVote()
        vote.add(card("35202-1234567-1"))
        vote.add(card("35202-1234561-1"))
        vote.add(card("35202-1234567-1"))
        assertEquals("35202-1234567-1", vote.result().cnic)
    }

    @Test fun aTieFillsNothingEvenAtTheEnd() {
        val vote = CnicVote()
        vote.add(card("35202-1234567-1"))
        vote.add(card("35202-1234561-1"))
        assertFalse(vote.cnicConfirmed)
        assertNull(vote.result(final = true).cnic)
    }

    @Test fun theShutterAcceptsASingleRead() {
        val vote = CnicVote()
        vote.add(card(name = "Ayesha Bibi"))
        assertEquals("Ayesha Bibi", vote.result(final = true).name)
        assertNull(vote.result().name)
    }

    @Test fun waitsForTheFatherAndDatesBeforeCallingItEverything() {
        val vote = CnicVote()
        repeat(2) { vote.add(card("35202-1234567-1", "Muhammad Aslam")) }
        assertTrue(vote.complete)
        assertFalse(vote.everything)
        val full = CnicCard("35202-1234567-1", "Muhammad Aslam", "Muhammad Akram", LocalDate.of(1990, 1, 1), LocalDate.of(2030, 3, 15), false)
        repeat(2) { vote.add(full) }
        assertTrue(vote.everything)
        assertEquals("Muhammad Akram", vote.result().fatherName)
    }

    @Test fun aNumberWithAnImpossibleProvinceDigitIsIgnored() {
        assertNull(CnicCardReader.cnic("95202-1234567-1"))
        assertNull(CnicCardReader.cnic("05202-1234567-1"))
        assertEquals("71101-8765432-0", CnicCardReader.cnic("71101-8765432-0"))
    }
}

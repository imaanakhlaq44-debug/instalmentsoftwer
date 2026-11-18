package pk.almassdm.shop

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class CnicCardReaderTest {
    private fun line(text: String, left: Int, top: Int) = OcrLine(text, left, top, left + text.length * 12, top + 24)

    /** The front of a smart CNIC as the on-device OCR reads it: labels small, values under them. */
    private val smartCard = listOf(
        line("PAKISTAN", 300, 20),
        line("National Identity Card", 300, 50),
        line("Name", 300, 110),
        line("Muhammad Aslam", 300, 140),
        line("Father Name", 300, 190),
        line("Muhammad Akram", 300, 220),
        line("Gender", 300, 270), line("Country of Stay", 450, 270),
        line("M", 300, 300), line("Pakistan", 450, 300),
        line("Identity Number", 300, 350), line("Date of Birth", 520, 350),
        line("35202-1234567-1", 300, 380), line("01.01.1990", 520, 380),
        line("Date of Issue", 300, 430), line("Date of Expiry", 520, 430),
        line("15.03.2020", 300, 460), line("15.03.2030", 520, 460),
        line("Holder's Signature", 600, 520),
    )

    @Test fun readsEveryFieldOffASmartCard() {
        val card = CnicCardReader.read(smartCard)
        assertEquals("35202-1234567-1", card.cnic)
        assertEquals("Muhammad Aslam", card.name)
        assertEquals("Muhammad Akram", card.fatherName)
        assertEquals(LocalDate.of(1990, 1, 1), card.dateOfBirth)
        assertEquals(LocalDate.of(2030, 3, 15), card.dateOfExpiry)
        assertFalse(card.lifetime)
    }

    @Test fun readsTheLinesInAnyOrder() {
        assertEquals(CnicCardReader.read(smartCard), CnicCardReader.read(smartCard.shuffled(java.util.Random(7))))
    }

    @Test fun putsRightTheLettersOcrTakesForDigits() {
        assertEquals("35202-1234567-1", CnicCardReader.cnic("352O2-l234567-1"))
        assertEquals("61101-8765432-0", CnicCardReader.cnic("61101 8765432 O"))
        assertEquals("61101-8765432-0", CnicCardReader.cnic("6110187654320"))
    }

    @Test fun doesNotTakeADateOrAWordForTheCnic() {
        assertNull(CnicCardReader.cnic("01.01.1990"))
        assertNull(CnicCardReader.cnic("Signature of Holder"))
        assertNull(CnicCardReader.cnic("35202-12345-1"))
    }

    @Test fun readsAHusbandNameAndANameOnTheLabelLine() {
        val card = CnicCardReader.read(listOf(
            line("Name: Ayesha Bibi", 300, 110),
            line("Husband Name", 300, 190),
            line("Imran Khan", 300, 220),
        ))
        assertEquals("Ayesha Bibi", card.name)
        assertEquals("Imran Khan", card.fatherName)
    }

    @Test fun leavesTheNameEmptyRatherThanGuessing() {
        val card = CnicCardReader.read(listOf(line("Name", 300, 110), line("Father Name", 300, 140), line("PAKISTAN", 300, 400)))
        assertNull(card.name)
        assertNull(card.fatherName)
    }

    @Test fun aLifetimeCardHasNoExpiry() {
        val card = CnicCardReader.read(listOf(
            line("Date of Birth", 520, 350), line("01.01.1950", 520, 380),
            line("Date of Issue", 300, 430), line("Date of Expiry", 520, 430),
            line("15.03.2020", 300, 460), line("Lifetime", 520, 460),
        ))
        assertTrue(card.lifetime)
        assertNull(card.dateOfExpiry)
        assertEquals(LocalDate.of(1950, 1, 1), card.dateOfBirth)
    }

    @Test fun anIssueDateIsNotTakenForTheExpiryWhenTheExpiryIsUnread() {
        // "Date of Issue  Date of Expiry" read as one line, and the expiry date itself missed.
        val card = CnicCardReader.read(listOf(
            line("Date of Birth", 520, 350), line("01.01.1990", 520, 380),
            line("Date of Issue Date of Expiry", 300, 430), line("15.03.2020", 300, 460),
        ))
        assertNull(card.dateOfExpiry)
        assertEquals(LocalDate.of(1990, 1, 1), card.dateOfBirth)
    }

    @Test fun answersInTheShapeTheSaleFormReads() {
        val json = CnicCardReader.read(smartCard).toJson()
        assertEquals(true, json.getBoolean("ok"))
        assertEquals("35202-1234567-1", json.getString("cnic"))
        assertEquals("1990-01-01", json.getString("dateOfBirth"))
        assertEquals("2030-03-15", json.getString("dateOfExpiry"))
    }
}

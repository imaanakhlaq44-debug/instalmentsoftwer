package pk.almassdm.shop

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File

/**
 * Runs Google's on-device text recognition over a photo of the CNIC front and
 * hands the lines to [CnicCardReader]. Blocking: call it off the main thread.
 */
object CnicPhotoReader {
    fun read(context: Context, photo: File): CnicCard {
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        try {
            // First as the camera saved it (its own rotation tag is honoured).
            var best = CnicCardReader.read(lines(Tasks.await(recognizer.process(InputImage.fromFilePath(context, Uri.fromFile(photo))))))
            if (complete(best)) return best
            // A card held sideways: try the other turns on a smaller copy.
            val bitmap = BitmapFactory.decodeFile(photo.path, BitmapFactory.Options().apply { inSampleSize = sampleSize(photo) }) ?: return best
            try {
                for (degrees in intArrayOf(90, 270, 0, 180)) {
                    val card = CnicCardReader.read(lines(Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, degrees)))))
                    if (score(card) > score(best)) best = card
                    if (complete(best)) break
                }
            } finally { bitmap.recycle() }
            return best
        } finally { recognizer.close() }
    }

    private fun lines(text: Text) = text.textBlocks.flatMap { it.lines }.mapNotNull { line ->
        line.boundingBox?.let { OcrLine(line.text, it.left, it.top, it.right, it.bottom) }
    }

    private fun complete(card: CnicCard) = card.cnic != null && card.name != null
    private fun score(card: CnicCard) = listOf(card.cnic, card.name, card.fatherName, card.dateOfBirth).count { it != null }

    /** Keeps the long side near 2000 px: enough for card text, light on memory. */
    private fun sampleSize(photo: File): Int {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(photo.path, bounds)
        var size = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (size * 2) >= 2000) size *= 2
        return size
    }
}

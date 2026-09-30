package expo.modules.smsreader

import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Reads recent messages from the device SMS inbox (needs the READ_SMS runtime permission). */
class SmsReaderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SmsReader")

    AsyncFunction("readInbox") { sinceMs: Double, maxCount: Int ->
      val context = appContext.reactContext
        ?: throw CodedException("NO_CONTEXT", "React context is not available", null)
      val messages = mutableListOf<Map<String, Any>>()
      try {
        val cursor = context.contentResolver.query(
          Uri.parse("content://sms/inbox"),
          arrayOf("_id", "address", "body", "date"),
          "date > ?",
          arrayOf(sinceMs.toLong().toString()),
          "date DESC"
        )
        cursor?.use {
          val idIdx = it.getColumnIndexOrThrow("_id")
          val addressIdx = it.getColumnIndexOrThrow("address")
          val bodyIdx = it.getColumnIndexOrThrow("body")
          val dateIdx = it.getColumnIndexOrThrow("date")
          while (it.moveToNext() && messages.size < maxCount) {
            messages.add(
              mapOf(
                "id" to (it.getString(idIdx) ?: ""),
                "address" to (it.getString(addressIdx) ?: ""),
                "body" to (it.getString(bodyIdx) ?: ""),
                "date" to it.getLong(dateIdx).toDouble()
              )
            )
          }
        }
      } catch (e: SecurityException) {
        throw CodedException("NO_PERMISSION", "READ_SMS permission has not been granted", e)
      }
      messages
    }
  }
}

package expo.modules.ridenotifications

import android.content.Context
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Small on-device queue of notifications posted by ride-hailing apps (Rapido, Ola, Uber).
 * The listener service writes to it (also while the app is closed); the JS side reads it.
 * Notifications from any other app are never stored. This is read-only: nothing here
 * answers, accepts or dismisses a notification.
 */
object RideNotificationStore {
  // Matched on the package name so both the driver and the differently-named regional
  // builds of each app are covered; the stored packageName shows exactly which app it was.
  private val RIDE_APP_MARKERS = listOf("rapido", "olacabs", "ubercab")

  private const val PREFS = "ride_notifications"
  private const val KEY_QUEUE = "queue"
  private const val MAX_ITEMS = 300
  private const val REPOST_WINDOW_MS = 30_000L

  fun isRideApp(packageName: String): Boolean {
    val lower = packageName.lowercase()
    return RIDE_APP_MARKERS.any { lower.contains(it) }
  }

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun load(context: Context): JSONArray {
    val raw = prefs(context).getString(KEY_QUEUE, null)
    return try {
      if (raw == null) JSONArray() else JSONArray(raw)
    } catch (e: JSONException) {
      JSONArray()
    }
  }

  @Synchronized
  fun add(context: Context, packageName: String, title: String, text: String, actions: String, postTime: Long) {
    val queue = load(context)
    // Apps re-post the same notification as it updates: keep one copy.
    for (i in queue.length() - 1 downTo maxOf(0, queue.length() - 10)) {
      val item = queue.optJSONObject(i) ?: continue
      if (item.optString("packageName") == packageName && item.optString("title") == title &&
        item.optString("text") == text && postTime - item.optLong("date") < REPOST_WINDOW_MS
      ) return
    }
    queue.put(
      JSONObject()
        .put("id", "$packageName:$postTime")
        .put("packageName", packageName)
        .put("title", title)
        .put("text", text)
        .put("actions", actions)
        .put("date", postTime)
    )
    val trimmed = JSONArray()
    for (i in maxOf(0, queue.length() - MAX_ITEMS) until queue.length()) trimmed.put(queue.get(i))
    prefs(context).edit().putString(KEY_QUEUE, trimmed.toString()).apply()
  }

  @Synchronized
  fun readSince(context: Context, sinceMs: Long, maxCount: Int): List<Map<String, Any>> {
    val queue = load(context)
    val result = mutableListOf<Map<String, Any>>()
    // Newest first
    for (i in queue.length() - 1 downTo 0) {
      val item = queue.optJSONObject(i) ?: continue
      if (item.optLong("date") <= sinceMs) continue
      result.add(
        mapOf(
          "id" to item.optString("id"),
          "packageName" to item.optString("packageName"),
          "title" to item.optString("title"),
          "text" to item.optString("text"),
          "actions" to item.optString("actions"),
          "date" to item.optLong("date").toDouble()
        )
      )
      if (result.size >= maxCount) break
    }
    return result
  }

  @Synchronized
  fun clear(context: Context) {
    prefs(context).edit().remove(KEY_QUEUE).apply()
  }
}

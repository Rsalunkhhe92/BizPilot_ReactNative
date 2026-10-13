package expo.modules.ridenotifications

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Queues the text of notifications posted by ride-hailing apps (needs the "Notification
 * access" setting). It only reads: it never triggers a notification's buttons.
 */
class RideNotificationService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val posted = sbn ?: return
    val notification = posted.notification ?: return
    val extras = notification.extras ?: return
    // Our own "send test alert" notification travels the same path as a real ride alert.
    val isTest = posted.packageName == packageName && extras.getBoolean(EXTRA_TEST_ALERT, false)
    if (!isTest && !RideNotificationStore.isRideApp(posted.packageName)) return
    // The summary row of a notification group repeats its children.
    if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
    val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))
      ?.toString() ?: ""
    if (title.isBlank() && text.isBlank()) return
    // Button labels only, recorded so we can see what kind of notification this is.
    val actions = notification.actions?.mapNotNull { it?.title?.toString() }?.joinToString(" | ") ?: ""
    val source = if (isTest) "${posted.packageName} (test)" else posted.packageName
    RideNotificationStore.add(applicationContext, source, title, text, actions, posted.postTime)
  }

  companion object {
    const val EXTRA_TEST_ALERT = "autoledger_ride_test_alert"
  }
}

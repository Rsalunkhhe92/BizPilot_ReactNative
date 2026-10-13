package expo.modules.ridenotifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS access to the queue of ride-app notifications kept by RideNotificationService. */
class RideNotificationsModule : Module() {
  private fun context() = appContext.reactContext
    ?: throw CodedException("NO_CONTEXT", "React context is not available", null)

  private companion object {
    const val TEST_CHANNEL_ID = "ride_alert_test"
  }

  override fun definition() = ModuleDefinition {
    Name("RideNotifications")

    AsyncFunction("isAccessGranted") {
      val context = context()
      val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: ""
      enabled.split(":").any { it.startsWith(context.packageName + "/") }
    }

    AsyncFunction("openAccessSettings") {
      context().startActivity(
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }

    AsyncFunction("readSince") { sinceMs: Double, maxCount: Int ->
      RideNotificationStore.readSince(context(), sinceMs.toLong(), maxCount)
    }

    AsyncFunction("clear") {
      RideNotificationStore.clear(context())
    }

    // Posts a real Android notification from this app, marked as a test, so the whole
    // capture path (notification -> listener service -> store -> screen) can be checked
    // without waiting for a ride app.
    AsyncFunction("postTestNotification") { title: String, text: String ->
      val context = context()
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.createNotificationChannel(
          NotificationChannel(TEST_CHANNEL_ID, "Ride alert test", NotificationManager.IMPORTANCE_DEFAULT)
        )
        Notification.Builder(context, TEST_CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }
      val notification = builder
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(title)
        .setContentText(text)
        .setStyle(Notification.BigTextStyle().bigText(text))
        .setAutoCancel(true)
        .addExtras(Bundle().apply { putBoolean(RideNotificationService.EXTRA_TEST_ALERT, true) })
        .build()
      manager.notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), notification)
    }
  }
}

package net.swiftirc.coyote

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

// Keeps the process (and so the WebRTC call) alive while the app is in the
// background, with an ongoing "In call" notification. Started on join, stopped on
// leave/kick/ban/fatal error by CallServiceModule.
class CallService : Service() {
  companion object {
    const val CHANNEL_ID = "call"
    const val NOTIFICATION_ID = 4201
    const val ACTION_LEAVE = "net.swiftirc.coyote.LEAVE"
    const val EXTRA_ROOM = "room"
    // Set by CallServiceModule; invoked when the notification's Leave is tapped.
    @Volatile var onLeave: (() -> Unit)? = null
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_LEAVE) {
      onLeave?.invoke()
      return START_NOT_STICKY
    }
    val room = intent?.getStringExtra(EXTRA_ROOM) ?: ""
    ensureChannel()
    val launch = packageManager.getLaunchIntentForPackage(packageName)!!
      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val open = PendingIntent.getActivity(this, 0, launch,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val leave = PendingIntent.getService(this, 1,
      Intent(this, CallService::class.java).setAction(ACTION_LEAVE), PendingIntent.FLAG_IMMUTABLE)
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("In call: #$room")
      .setContentText("Tap to return to the call")
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setContentIntent(open)
      .addAction(0, "Leave", leave)
      .build()
    var types = 0
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      types = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
        types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      }
    }
    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, types)
    return START_NOT_STICKY
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(NotificationManager::class.java)
    if (nm.getNotificationChannel(CHANNEL_ID) == null) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Ongoing call", NotificationManager.IMPORTANCE_LOW))
    }
  }
}

package net.swiftirc.coyote

import android.bluetooth.BluetoothDevice
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.OutcomeReceiver
import android.os.PowerManager
import android.os.SystemClock
import android.telecom.CallAudioState
import android.telecom.CallEndpoint
import android.telecom.CallEndpointException
import android.util.Log
import android.view.WindowManager
import androidx.annotation.RequiresApi
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import io.wazo.callkeep.VoiceConnection
import io.wazo.callkeep.VoiceConnectionService

// Audio output selection for a call, through Telecom. Android calls are self-managed
// callkeep connections, so Telecom owns routing: this module lists and selects
// outputs on the call's VoiceConnection and never touches AudioManager routing.
// While attached it also does InCallManager's other jobs (InCallManager isn't
// started then): keep the screen on, and turn it off near the ear on the earpiece.
// All state is confined to the main thread, where Telecom delivers its callbacks.
class CoyoteAudioRouteModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx), VoiceConnection.AudioRouteListener {
  override fun getName() = "CoyoteAudioRoute"

  private data class Output(val id: String, val kind: String, val name: String)

  private val main = Handler(Looper.getMainLooper())
  private var gen = 0 // bumped by start/stop; a stale start attempt gives up
  private var conn: VoiceConnection? = null
  private var video = false
  private var initialDone = false
  private var proximity: PowerManager.WakeLock? = null

  @ReactMethod
  fun start(callId: String, video: Boolean, promise: Promise) {
    main.post {
      detach()
      val g = ++gen
      this.video = video
      initialDone = false
      val deadline = SystemClock.uptimeMillis() + CONNECTION_WAIT_MS
      fun attempt() {
        if (g != gen) {
          promise.resolve(false)
          return
        }
        val c = VoiceConnectionService.getConnection(callId) as? VoiceConnection
        when {
          c != null -> {
            attach(c)
            promise.resolve(true)
          }
          SystemClock.uptimeMillis() >= deadline -> promise.resolve(false)
          else -> main.postDelayed({ attempt() }, 100)
        }
      }
      attempt()
    }
  }

  @ReactMethod
  fun stop() {
    main.post {
      gen++
      detach()
    }
  }

  @ReactMethod
  fun routes(promise: Promise) {
    main.post { promise.resolve(toMap(outputs(), selectedId())) }
  }

  @ReactMethod
  fun select(id: String, promise: Promise) {
    main.post {
      val c = conn
      if (c == null) promise.reject("no-call", "No call audio to route") else selectOn(c, id, promise)
    }
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  override fun invalidate() {
    main.post {
      gen++
      detach()
    }
    super.invalidate()
  }

  override fun onAudioRouteChanged(connection: VoiceConnection) {
    main.post { if (connection === conn) changed() }
  }

  private fun attach(c: VoiceConnection) {
    conn = c
    VoiceConnection.audioRouteListener = this
    setKeepScreenOn(true)
    changed()
  }

  private fun detach() {
    if (VoiceConnection.audioRouteListener === this) VoiceConnection.audioRouteListener = null
    if (conn != null) setKeepScreenOn(false)
    conn = null
    setProximity(false)
  }

  // After every report: tell JS, follow the earpiece, apply the starting output once.
  private fun changed() {
    val outs = outputs()
    val sel = selectedId()
    emit(toMap(outs, sel))
    setProximity(outs.firstOrNull { it.id == sel }?.kind == "earpiece")
    if (!initialDone && outs.isNotEmpty()) {
      initialDone = true
      val want = initialOutput(outs)
      val c = conn
      if (want != null && want != sel && c != null) selectOn(c, want, null)
    }
  }

  // A connected headset keeps Telecom's choice; otherwise video starts on the
  // speaker and audio-only on the earpiece (speaker when there is none, e.g. tablets).
  private fun initialOutput(outs: List<Output>): String? {
    if (outs.any { it.kind == "wired" || it.kind == "bluetooth" }) return null
    return if (!video && outs.any { it.kind == "earpiece" }) "earpiece" else "speaker"
  }

  private fun outputs(): List<Output> {
    val c = conn ?: return emptyList()
    val eps = endpoints(c)
    if (eps.isNotEmpty()) return eps.mapNotNull { endpointOutput(it) }
    @Suppress("DEPRECATION")
    val s = c.callAudioState ?: return emptyList()
    val mask = s.supportedRouteMask
    val list = mutableListOf<Output>()
    if ((mask and CallAudioState.ROUTE_EARPIECE) != 0) list += Output("earpiece", "earpiece", "Phone")
    if ((mask and CallAudioState.ROUTE_SPEAKER) != 0) list += Output("speaker", "speaker", "Speaker")
    if ((mask and CallAudioState.ROUTE_WIRED_HEADSET) != 0) list += Output("wired", "wired", "Headset")
    if ((mask and CallAudioState.ROUTE_BLUETOOTH) != 0) {
      val devices = if (Build.VERSION.SDK_INT >= 28) s.supportedBluetoothDevices.toList() else emptyList()
      if (devices.isEmpty()) list += Output("bluetooth", "bluetooth", "Bluetooth")
      else devices.forEach { list += Output("bt:${it.address}", "bluetooth", btName(it)) }
    }
    return list
  }

  private fun selectedId(): String {
    val c = conn ?: return ""
    val eps = endpoints(c)
    if (eps.isNotEmpty()) return (c.currentEndpoint as? CallEndpoint)?.let { endpointOutput(it)?.id } ?: ""
    @Suppress("DEPRECATION")
    val s = c.callAudioState ?: return ""
    return when (s.route) {
      CallAudioState.ROUTE_EARPIECE -> "earpiece"
      CallAudioState.ROUTE_SPEAKER -> "speaker"
      CallAudioState.ROUTE_WIRED_HEADSET -> "wired"
      CallAudioState.ROUTE_BLUETOOTH -> {
        val d = if (Build.VERSION.SDK_INT >= 28) s.activeBluetoothDevice ?: s.supportedBluetoothDevices.firstOrNull() else null
        if (d != null) "bt:${d.address}" else "bluetooth"
      }
      else -> ""
    }
  }

  // API 34+ endpoints as Telecom last reported them. Empty below 34, and on builds
  // that never deliver them to a self-managed call: callers then use CallAudioState,
  // which is deprecated on 34 but still reported and honoured.
  private fun endpoints(c: VoiceConnection): List<CallEndpoint> =
    if (Build.VERSION.SDK_INT >= 34) c.availableEndpoints.filterIsInstance<CallEndpoint>() else emptyList()

  @RequiresApi(34)
  private fun endpointOutput(e: CallEndpoint): Output? = when (e.endpointType) {
    CallEndpoint.TYPE_EARPIECE -> Output("earpiece", "earpiece", "Phone")
    CallEndpoint.TYPE_SPEAKER -> Output("speaker", "speaker", "Speaker")
    CallEndpoint.TYPE_WIRED_HEADSET -> Output("wired", "wired", "Headset")
    CallEndpoint.TYPE_BLUETOOTH -> Output("bt:${e.identifier}", "bluetooth", e.endpointName.toString().ifBlank { "Bluetooth device" })
    else -> null // streaming / unknown endpoints are not call outputs
  }

  // BLUETOOTH_CONNECT is requested at join (API 31+); without it, a generic name.
  private fun btName(d: BluetoothDevice): String {
    val name = try { d.name } catch (e: SecurityException) { null }
    return if (name.isNullOrBlank()) "Bluetooth device" else name
  }

  @Suppress("DEPRECATION")
  private fun selectOn(c: VoiceConnection, id: String, promise: Promise?) {
    val eps = endpoints(c)
    if (eps.isNotEmpty()) {
      val ep = eps.firstOrNull { endpointOutput(it)?.id == id }
      if (ep == null) {
        promise?.reject("unknown-output", "No output $id")
        return
      }
      c.requestCallEndpointChange(ep, ctx.mainExecutor, object : OutcomeReceiver<Void?, CallEndpointException> {
        override fun onResult(result: Void?) { promise?.resolve(null) }
        override fun onError(error: CallEndpointException) {
          Log.w(TAG, "select $id failed", error)
          promise?.reject("select-failed", error.message, error)
        }
      })
      return
    }
    when {
      id == "earpiece" -> c.setAudioRoute(CallAudioState.ROUTE_EARPIECE)
      id == "speaker" -> c.setAudioRoute(CallAudioState.ROUTE_SPEAKER)
      id == "wired" -> c.setAudioRoute(CallAudioState.ROUTE_WIRED_HEADSET)
      id == "bluetooth" -> c.setAudioRoute(CallAudioState.ROUTE_BLUETOOTH)
      id.startsWith("bt:") && Build.VERSION.SDK_INT >= 28 -> {
        val d = c.callAudioState?.supportedBluetoothDevices?.firstOrNull { "bt:${it.address}" == id }
        if (d == null) {
          promise?.reject("unknown-output", "No output $id")
          return
        }
        c.requestBluetoothAudio(d)
      }
      else -> {
        promise?.reject("unknown-output", "No output $id")
        return
      }
    }
    promise?.resolve(null)
  }

  private fun setProximity(on: Boolean) {
    if (on) {
      if (proximity != null) return
      val pm = ctx.getSystemService(PowerManager::class.java) ?: return
      if (!pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return
      proximity = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "coyote:proximity").apply {
        setReferenceCounted(false)
        acquire()
      }
    } else {
      proximity?.let { if (it.isHeld) it.release(PowerManager.RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY) }
      proximity = null
    }
  }

  private fun setKeepScreenOn(on: Boolean) {
    val w = ctx.currentActivity?.window ?: return
    if (on) w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    else w.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  private fun toMap(outs: List<Output>, sel: String): WritableMap {
    val arr = Arguments.createArray()
    for (o in outs) {
      arr.pushMap(Arguments.createMap().apply {
        putString("id", o.id)
        putString("kind", o.kind)
        putString("name", o.name)
      })
    }
    return Arguments.createMap().apply {
      putArray("outputs", arr)
      putString("selected", sel)
    }
  }

  private fun emit(body: WritableMap) {
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(EVENT, body)
  }

  companion object {
    private const val TAG = "CoyoteAudioRoute"
    private const val EVENT = "CoyoteAudioRoutes"
    private const val CONNECTION_WAIT_MS = 2000L
  }
}

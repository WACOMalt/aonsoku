package xyz.bsums.aonsoku;

import android.util.Log;

/**
 * Traces the native player's media controls (presses, play/pause changes,
 * loads, skips) under the "NativePlayer" tag. Debug builds only: read it with
 * `adb logcat -s NativePlayer`.
 */
final class DebugLog {

    private DebugLog() {}

    static void i(String tag, String message) {
        if (BuildConfig.DEBUG) Log.i(tag, message);
    }
}

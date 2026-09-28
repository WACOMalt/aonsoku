package xyz.bsums.aonsoku;

import android.content.Context;

import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

/**
 * The one ExoPlayer that plays songs, shared by the NativePlayer plugin (which
 * the web app drives) and PlaybackService (which exposes it to the system:
 * notification, lock screen, headsets, cars).
 *
 * ExoPlayer plays a playlist through a single audio output and trims each
 * track's encoder padding, so consecutive tracks join sample-accurately:
 * albums that run continuously play without a gap. Only touch it on the main
 * thread.
 */
final class PlaybackEngine {

    /** Next/previous pressed on the notification, lock screen or a headset. */
    interface CommandListener {
        void onCommand(String action);
    }

    private static ExoPlayer player;
    private static CommandListener commandListener;

    private PlaybackEngine() {}

    @OptIn(markerClass = UnstableApi.class)
    static ExoPlayer get(Context context) {
        if (player == null) {
            Context app = context.getApplicationContext();
            DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true);
            player = new ExoPlayer.Builder(app)
                .setMediaSourceFactory(
                    new DefaultMediaSourceFactory(new DefaultDataSource.Factory(app, http)))
                .setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                        .build(),
                    true)
                // Pause when headphones are unplugged, like other players.
                .setHandleAudioBecomingNoisy(true)
                // Streaming with the screen off needs the CPU and Wi-Fi awake.
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();
        }
        return player;
    }

    static ExoPlayer peek() {
        return player;
    }

    static void release() {
        if (player != null) {
            player.release();
            player = null;
        }
    }

    static void setCommandListener(CommandListener listener) {
        commandListener = listener;
    }

    static void sendCommand(String action) {
        CommandListener listener = commandListener;
        if (listener != null) listener.onCommand(action);
    }
}

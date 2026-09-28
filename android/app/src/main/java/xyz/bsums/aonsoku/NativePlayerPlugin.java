package xyz.bsums.aonsoku;

import android.content.ComponentName;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;

import java.util.ArrayList;
import java.util.List;

/**
 * Lets the web app play songs through ExoPlayer (see PlaybackEngine).
 *
 * The web app keeps the queue. The player holds the current track plus the
 * one after it, which it preloads and joins onto without a gap; when it moves
 * on by itself the web app is told, advances its queue and sends the track
 * after that. Every item carries a key from the web app so events can be
 * matched to the item they are about.
 *
 * Events: "progress" (position), "transition" (a new item started),
 * "playing" (play/pause from outside the app: notification, headset, another
 * app taking audio focus), "ended" (nothing left to play), "error" and
 * "command" (next/previous from the notification or a headset).
 */
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    private static final String TAG = "NativePlayer";
    private static final long PROGRESS_INTERVAL_MS = 500;
    private static final String EXTRA_GAIN = "aonsoku.gain";

    private final Handler main = new Handler(Looper.getMainLooper());

    private ExoPlayer player;
    private ListenableFuture<MediaController> controller;
    private float volume = 1f;
    // What the web app last asked for; changes from anywhere else are
    // reported back so its play/pause state follows.
    private boolean requestedPlaying = false;

    private final Runnable progressTick = new Runnable() {
        @Override
        public void run() {
            emitProgress();
            if (player != null && player.isPlaying()) {
                main.postDelayed(this, PROGRESS_INTERVAL_MS);
            }
        }
    };

    private final Player.Listener listener = new Player.Listener() {
        @Override
        public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
            if (item == null) return;
            applyVolume();
            JSObject data = new JSObject();
            data.put("key", item.mediaId);
            data.put("reason", reason);
            notifyListeners("transition", data);
            // Only the current item and the one after it are kept.
            main.post(() -> {
                if (player == null) return;
                int index = player.getCurrentMediaItemIndex();
                if (index > 0) player.removeMediaItems(0, index);
            });
            emitProgress();
        }

        @Override
        public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
            if (playWhenReady == requestedPlaying) return;
            requestedPlaying = playWhenReady;
            JSObject data = new JSObject();
            data.put("playing", playWhenReady);
            data.put("reason", reason);
            notifyListeners("playing", data);
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            main.removeCallbacks(progressTick);
            if (isPlaying) {
                main.post(progressTick);
            } else {
                emitProgress();
            }
        }

        @Override
        public void onPlaybackStateChanged(int state) {
            emitProgress();
            if (state == Player.STATE_ENDED) {
                JSObject data = new JSObject();
                data.put("key", currentKey());
                notifyListeners("ended", data);
            }
        }

        @Override
        public void onPositionDiscontinuity(
            @NonNull Player.PositionInfo oldPosition,
            @NonNull Player.PositionInfo newPosition,
            int reason
        ) {
            emitProgress();
        }

        @Override
        public void onPlayerError(@NonNull PlaybackException error) {
            Log.e(TAG, "Playback error", error);
            JSObject data = new JSObject();
            data.put("key", currentKey());
            data.put("code", error.getErrorCodeName());
            data.put("message", error.getMessage());
            notifyListeners("error", data);
        }
    };

    @Override
    public void load() {
        PlaybackEngine.setCommandListener(action -> {
            JSObject data = new JSObject();
            data.put("action", action);
            notifyListeners("command", data);
        });
    }

    @Override
    protected void handleOnDestroy() {
        main.post(() -> {
            main.removeCallbacks(progressTick);
            if (player != null) {
                player.removeListener(listener);
                player.stop();
                player.clearMediaItems();
                player = null;
            }
            if (controller != null) {
                MediaController.releaseFuture(controller);
                controller = null;
            }
        });
        PlaybackEngine.setCommandListener(null);
        super.handleOnDestroy();
    }

    /**
     * Starts a track: { current, next?, positionMs, playWhenReady, repeatOne,
     * volume }. Items are { key, url, title, artist, album, artworkUrl,
     * durationMs, gain }.
     */
    @PluginMethod
    public void load(PluginCall call) {
        JSObject current = call.getObject("current");
        if (current == null) {
            call.reject("current is required");
            return;
        }
        JSObject next = call.getObject("next");
        long positionMs = Math.max(0, call.getDouble("positionMs", 0.0).longValue());
        boolean playWhenReady = Boolean.TRUE.equals(call.getBoolean("playWhenReady", false));
        boolean repeatOne = Boolean.TRUE.equals(call.getBoolean("repeatOne", false));
        float newVolume = call.getFloat("volume", volume);

        main.post(() -> {
            ExoPlayer p = ensurePlayer();
            List<MediaItem> items = new ArrayList<>();
            items.add(toMediaItem(current));
            if (next != null) items.add(toMediaItem(next));
            volume = newVolume;
            requestedPlaying = playWhenReady;
            p.setRepeatMode(repeatOne ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
            p.setMediaItems(items, 0, positionMs);
            applyVolume();
            p.prepare();
            p.setPlayWhenReady(playWhenReady);
            call.resolve();
        });
    }

    /** Replaces whatever follows the current track: { next? }. */
    @PluginMethod
    public void setNext(PluginCall call) {
        JSObject next = call.getObject("next");
        main.post(() -> {
            if (player == null || player.getMediaItemCount() == 0) {
                call.resolve();
                return;
            }
            int index = player.getCurrentMediaItemIndex();
            int count = player.getMediaItemCount();
            if (next != null && count == index + 2
                && player.getMediaItemAt(index + 1).mediaId.equals(next.getString("key"))) {
                call.resolve();
                return;
            }
            if (count > index + 1) player.removeMediaItems(index + 1, count);
            if (next != null) player.addMediaItem(toMediaItem(next));
            call.resolve();
        });
    }

    /**
     * Moves on to the preloaded next track: { key }. Does nothing if that
     * track is already playing, or is not the one preloaded.
     */
    @PluginMethod
    public void skipToNext(PluginCall call) {
        String key = call.getString("key", "");
        main.post(() -> {
            JSObject result = new JSObject();
            boolean skipped = false;
            if (player != null) {
                int index = player.getCurrentMediaItemIndex();
                if (key.equals(currentKey())) {
                    skipped = true;
                } else if (index + 1 < player.getMediaItemCount()
                    && player.getMediaItemAt(index + 1).mediaId.equals(key)) {
                    player.seekTo(index + 1, 0);
                    if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
                    skipped = true;
                }
            }
            result.put("skipped", skipped);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void setPlaying(PluginCall call) {
        boolean playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        main.post(() -> {
            requestedPlaying = playing;
            if (player != null) {
                if (playing && player.getPlaybackState() == Player.STATE_IDLE
                    && player.getMediaItemCount() > 0) {
                    player.prepare();
                }
                player.setPlayWhenReady(playing);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        long positionMs = Math.max(0, call.getDouble("positionMs", 0.0).longValue());
        main.post(() -> {
            if (player != null && player.getMediaItemCount() > 0) player.seekTo(positionMs);
            call.resolve();
        });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        float newVolume = call.getFloat("volume", 1f);
        main.post(() -> {
            volume = newVolume;
            applyVolume();
            call.resolve();
        });
    }

    @PluginMethod
    public void setRepeatOne(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        main.post(() -> {
            if (player != null) {
                player.setRepeatMode(enabled ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
            }
            call.resolve();
        });
    }

    /** Stops and empties the player, which also removes its notification. */
    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            requestedPlaying = false;
            main.removeCallbacks(progressTick);
            if (player != null) {
                player.stop();
                player.clearMediaItems();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        main.post(() -> call.resolve(progressData()));
    }

    private ExoPlayer ensurePlayer() {
        if (player == null) {
            player = PlaybackEngine.get(getContext());
            player.addListener(listener);
        }
        // Connecting a controller starts PlaybackService, which puts the
        // player in the notification and keeps it running in the background.
        if (controller == null) {
            Context context = getContext();
            SessionToken token = new SessionToken(
                context, new ComponentName(context, PlaybackService.class));
            controller = new MediaController.Builder(context, token).buildAsync();
        }
        return player;
    }

    private MediaItem toMediaItem(JSObject item) {
        Bundle extras = new Bundle();
        extras.putFloat(EXTRA_GAIN, (float) item.optDouble("gain", 1.0));

        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .setTitle(item.getString("title", ""))
            .setArtist(item.getString("artist", ""))
            .setAlbumTitle(item.getString("album", ""))
            .setExtras(extras);
        String artwork = item.getString("artworkUrl", "");
        if (artwork != null && !artwork.isEmpty()) metadata.setArtworkUri(Uri.parse(artwork));
        long durationMs = (long) item.optDouble("durationMs", 0);
        if (durationMs > 0) metadata.setDurationMs(durationMs);

        return new MediaItem.Builder()
            .setMediaId(item.getString("key", ""))
            .setUri(item.getString("url", ""))
            .setMediaMetadata(metadata.build())
            .build();
    }

    /** The listener's volume times the current track's ReplayGain. */
    private void applyVolume() {
        if (player == null) return;
        float gain = 1f;
        MediaItem item = player.getCurrentMediaItem();
        if (item != null && item.mediaMetadata.extras != null) {
            gain = item.mediaMetadata.extras.getFloat(EXTRA_GAIN, 1f);
        }
        // The output cannot be boosted above full scale.
        player.setVolume(Math.max(0f, Math.min(1f, volume * gain)));
    }

    private String currentKey() {
        if (player == null) return "";
        MediaItem item = player.getCurrentMediaItem();
        return item == null ? "" : item.mediaId;
    }

    private JSObject progressData() {
        JSObject data = new JSObject();
        data.put("key", currentKey());
        if (player == null) {
            data.put("positionMs", 0);
            data.put("durationMs", -1);
            data.put("playing", false);
            data.put("state", Player.STATE_IDLE);
            return data;
        }
        long duration = player.getDuration();
        data.put("positionMs", player.getCurrentPosition());
        data.put("durationMs", duration == C.TIME_UNSET ? -1 : duration);
        data.put("playing", player.isPlaying());
        data.put("state", player.getPlaybackState());
        return data;
    }

    private void emitProgress() {
        if (player == null) return;
        notifyListeners("progress", progressData());
    }
}

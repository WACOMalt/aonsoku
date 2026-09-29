package xyz.bsums.aonsoku;

import android.app.PendingIntent;
import android.content.Intent;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/**
 * Keeps songs playing in the background and gives the system its media
 * session: the notification, lock screen controls, headset and car buttons.
 * The player itself is PlaybackEngine's.
 *
 * The player only holds the tracks around the current one (the web app owns
 * the queue), so next and previous move within those and fall back to the
 * web app beyond them.
 */
public class PlaybackService extends MediaSessionService {

    private MediaSession session;

    @OptIn(markerClass = UnstableApi.class)
    @Override
    public void onCreate() {
        super.onCreate();

        ExoPlayer player = PlaybackEngine.get(this);

        DefaultMediaNotificationProvider notifications =
            new DefaultMediaNotificationProvider.Builder(this).build();
        notifications.setSmallIcon(R.drawable.ic_notification);
        setMediaNotificationProvider(notifications);

        MediaSession.Builder builder = new MediaSession.Builder(this, new QueuePlayer(player));
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            builder.setSessionActivity(PendingIntent.getActivity(
                this, 0, launch,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        }
        session = builder.build();
        DebugLog.i("NativePlayer", "media session created");
    }

    @Override
    public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Closing the app from recents stops the music, as it always has:
        // the web app that owns the queue is gone with it.
        ExoPlayer player = PlaybackEngine.peek();
        if (player != null) {
            player.pause();
            player.stop();
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        DebugLog.i("NativePlayer", "media session closed");
        if (session != null) {
            session.release();
            session = null;
        }
        super.onDestroy();
    }

    /** Offers next/previous everywhere, handled by PlaybackEngine. */
    private static final class QueuePlayer extends ForwardingPlayer {

        QueuePlayer(Player player) {
            super(player);
        }

        @Override
        public void seekToNext() {
            PlaybackEngine.skipToNext(getWrappedPlayer());
        }

        @Override
        public void seekToNextMediaItem() {
            PlaybackEngine.skipToNext(getWrappedPlayer());
        }

        @Override
        public void seekToPrevious() {
            PlaybackEngine.skipToPrevious(getWrappedPlayer());
        }

        @Override
        public void seekToPreviousMediaItem() {
            PlaybackEngine.skipToPrevious(getWrappedPlayer());
        }

        @Override
        public boolean hasNextMediaItem() {
            return true;
        }

        @Override
        public boolean hasPreviousMediaItem() {
            return true;
        }

        @Override
        public boolean isCommandAvailable(int command) {
            return isQueueCommand(command) || super.isCommandAvailable(command);
        }

        @NonNull
        @Override
        public Commands getAvailableCommands() {
            return super.getAvailableCommands().buildUpon()
                .addAll(
                    COMMAND_SEEK_TO_NEXT,
                    COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                    COMMAND_SEEK_TO_PREVIOUS,
                    COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                .build();
        }

        private static boolean isQueueCommand(int command) {
            return command == COMMAND_SEEK_TO_NEXT
                || command == COMMAND_SEEK_TO_NEXT_MEDIA_ITEM
                || command == COMMAND_SEEK_TO_PREVIOUS
                || command == COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM;
        }
    }
}

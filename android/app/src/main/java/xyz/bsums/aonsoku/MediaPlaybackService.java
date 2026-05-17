package xyz.bsums.aonsoku;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.session.MediaButtonReceiver;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MediaPlaybackService extends Service {

    private static final String TAG = "MediaPlaybackService";
    private static final String CHANNEL_ID = "aonsoku_media_playback";
    private static final int NOTIFICATION_ID = 1;

    private MediaSessionCompat mediaSession;
    private PlaybackStateCompat.Builder stateBuilder;
    private final IBinder binder = new LocalBinder();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private Bitmap currentArtwork;
    private String currentArtworkUrl;
    private boolean isPlaying = false;
    private long currentPosition = 0;
    private float currentPlaybackRate = 1.0f;

    // Metadata fields
    private String currentTitle = "";
    private String currentArtist = "";
    private String currentAlbum = "";
    private long currentDuration = 0;

    // Callback interface for communicating media actions back to the plugin
    public interface MediaActionCallback {
        void onAction(String action);
    }

    private MediaActionCallback actionCallback;

    public class LocalBinder extends Binder {
        MediaPlaybackService getService() {
            return MediaPlaybackService.this;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "Service created");
        createNotificationChannel();
        initMediaSession();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        MediaButtonReceiver.handleIntent(mediaSession, intent);
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "Service destroyed");
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        executor.shutdown();
        super.onDestroy();
    }

    public void setActionCallback(MediaActionCallback callback) {
        this.actionCallback = callback;
    }

    public MediaSessionCompat getMediaSession() {
        return mediaSession;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Music Playback",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Controls for music playback");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void initMediaSession() {
        mediaSession = new MediaSessionCompat(this, "AonsokuMediaSession");

        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
            MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );

        stateBuilder = new PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY |
                PlaybackStateCompat.ACTION_PAUSE |
                PlaybackStateCompat.ACTION_PLAY_PAUSE |
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
                PlaybackStateCompat.ACTION_STOP |
                PlaybackStateCompat.ACTION_SEEK_TO
            );

        mediaSession.setPlaybackState(stateBuilder.build());

        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                Log.d(TAG, "MediaSession callback: onPlay");
                notifyAction("play");
            }

            @Override
            public void onPause() {
                Log.d(TAG, "MediaSession callback: onPause");
                notifyAction("pause");
            }

            @Override
            public void onSkipToNext() {
                Log.d(TAG, "MediaSession callback: onSkipToNext");
                notifyAction("nexttrack");
            }

            @Override
            public void onSkipToPrevious() {
                Log.d(TAG, "MediaSession callback: onSkipToPrevious");
                notifyAction("previoustrack");
            }

            @Override
            public void onStop() {
                Log.d(TAG, "MediaSession callback: onStop");
                notifyAction("stop");
            }

            @Override
            public void onSeekTo(long pos) {
                Log.d(TAG, "MediaSession callback: onSeekTo " + pos);
                notifyAction("seekto:" + pos);
            }
        });

        mediaSession.setActive(true);
    }

    private void notifyAction(String action) {
        if (actionCallback != null) {
            actionCallback.onAction(action);
        }
    }

    public void updateMetadata(String title, String artist, String album,
                                String artworkUrl, long duration) {
        this.currentTitle = title;
        this.currentArtist = artist;
        this.currentAlbum = album;
        this.currentDuration = duration;

        MediaMetadataCompat.Builder metadataBuilder = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration);

        if (currentArtwork != null) {
            metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentArtwork);
        }

        mediaSession.setMetadata(metadataBuilder.build());

        // Load artwork asynchronously if URL changed
        if (artworkUrl != null && !artworkUrl.isEmpty() && !artworkUrl.equals(currentArtworkUrl)) {
            currentArtworkUrl = artworkUrl;
            loadArtworkAsync(artworkUrl);
        } else {
            updateNotification();
        }
    }

    public void updatePlaybackState(boolean playing, long position, float playbackRate) {
        this.isPlaying = playing;
        this.currentPosition = position;
        this.currentPlaybackRate = playbackRate;

        int state = playing
            ? PlaybackStateCompat.STATE_PLAYING
            : PlaybackStateCompat.STATE_PAUSED;

        stateBuilder.setState(state, position, playbackRate);
        mediaSession.setPlaybackState(stateBuilder.build());

        updateNotification();
    }

    private void loadArtworkAsync(String artworkUrl) {
        executor.execute(() -> {
            Bitmap bitmap = downloadBitmap(artworkUrl);
            mainHandler.post(() -> {
                currentArtwork = bitmap;

                // Update metadata with artwork
                MediaMetadataCompat.Builder metadataBuilder = new MediaMetadataCompat.Builder()
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                    .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
                    .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDuration);

                if (bitmap != null) {
                    metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bitmap);
                }

                mediaSession.setMetadata(metadataBuilder.build());
                updateNotification();
            });
        });
    }

    private Bitmap downloadBitmap(String urlString) {
        try {
            URL url = new URL(urlString);
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setDoInput(true);
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);

            // Follow redirects
            connection.setInstanceFollowRedirects(true);

            // Accept self-signed certs for local Navidrome servers
            connection.connect();

            int responseCode = connection.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                Log.w(TAG, "Failed to download artwork: HTTP " + responseCode);
                return null;
            }

            InputStream input = connection.getInputStream();
            Bitmap bitmap = BitmapFactory.decodeStream(input);
            input.close();
            connection.disconnect();

            // Scale down if too large to avoid memory issues
            if (bitmap != null && (bitmap.getWidth() > 512 || bitmap.getHeight() > 512)) {
                bitmap = Bitmap.createScaledBitmap(bitmap, 512, 512, true);
            }

            return bitmap;
        } catch (Exception e) {
            Log.e(TAG, "Error downloading artwork: " + e.getMessage());
            return null;
        }
    }

    private void updateNotification() {
        Notification notification = buildNotification();
        if (notification != null) {
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception e) {
                Log.e(TAG, "Failed to start foreground: " + e.getMessage());
            }
        }
    }

    private Notification buildNotification() {
        // Create intent to open the app when notification is tapped
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Build notification actions
        NotificationCompat.Action prevAction = new NotificationCompat.Action.Builder(
            R.drawable.ic_media_previous,
            "Previous",
            MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
        ).build();

        NotificationCompat.Action playPauseAction;
        if (isPlaying) {
            playPauseAction = new NotificationCompat.Action.Builder(
                R.drawable.ic_media_pause,
                "Pause",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PAUSE)
            ).build();
        } else {
            playPauseAction = new NotificationCompat.Action.Builder(
                R.drawable.ic_media_play,
                "Play",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PLAY)
            ).build();
        }

        NotificationCompat.Action nextAction = new NotificationCompat.Action.Builder(
            R.drawable.ic_media_next,
            "Next",
            MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT)
        ).build();

        // Build the notification
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setSubText(currentAlbum)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .setShowWhen(false)
            .addAction(prevAction)
            .addAction(playPauseAction)
            .addAction(nextAction)
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2)
                .setShowCancelButton(true)
                .setCancelButtonIntent(
                    MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_STOP)
                )
            );

        if (currentArtwork != null) {
            builder.setLargeIcon(currentArtwork);
        }

        return builder.build();
    }
}

package xyz.bsums.aonsoku;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "MediaSession",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { "android.permission.POST_NOTIFICATIONS" }
        )
    }
)
public class MediaSessionPlugin extends Plugin {

    private static final String TAG = "MediaSessionPlugin";

    private MediaPlaybackService service;
    private boolean serviceBound = false;
    private boolean serviceStarted = false;

    // Queue metadata update if service isn't bound yet
    private PluginCall pendingMetadataCall;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            Log.d(TAG, "Service connected");
            MediaPlaybackService.LocalBinder localBinder = (MediaPlaybackService.LocalBinder) binder;
            service = localBinder.getService();
            serviceBound = true;

            // Set up the callback for media actions
            service.setActionCallback(action -> {
                Log.d(TAG, "Media action received: " + action);
                JSObject data = new JSObject();

                // Handle seekto with position
                if (action.startsWith("seekto:")) {
                    data.put("action", "seekto");
                    try {
                        long position = Long.parseLong(action.substring(7));
                        data.put("position", position);
                    } catch (NumberFormatException e) {
                        data.put("position", 0);
                    }
                } else {
                    data.put("action", action);
                }

                notifyListeners("mediaSessionAction", data);
            });

            // Process any pending metadata call
            if (pendingMetadataCall != null) {
                processUpdateMetadata(pendingMetadataCall);
                pendingMetadataCall = null;
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            Log.d(TAG, "Service disconnected");
            serviceBound = false;
            service = null;
        }
    };

    @Override
    public void load() {
        Log.d(TAG, "MediaSessionPlugin loaded");
    }

    @Override
    protected void handleOnDestroy() {
        destroyService();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        // Check notification permission on Android 13+
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(getContext(), "android.permission.POST_NOTIFICATIONS")
                    != PackageManager.PERMISSION_GRANTED) {
                // Request permission
                requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
                return;
            }
        }

        processUpdateMetadata(call);
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        // Permission result received, proceed with metadata update regardless
        // (notification may not show but service still works for bluetooth)
        processUpdateMetadata(call);
    }

    private void processUpdateMetadata(PluginCall call) {
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        String artworkUrl = call.getString("artworkUrl", "");
        long duration = call.getInt("duration", 0) * 1000L; // Convert seconds to ms

        Log.d(TAG, "updateMetadata: " + title + " - " + artist);

        if (!serviceStarted) {
            startAndBindService();
            // Queue this call for when service connects
            pendingMetadataCall = call;
            return;
        }

        if (!serviceBound || service == null) {
            // Service is starting but not yet bound, queue the call
            pendingMetadataCall = call;
            return;
        }

        service.updateMetadata(title, artist, album, artworkUrl, duration);
        call.resolve();
    }

    @PluginMethod
    public void updatePlaybackState(PluginCall call) {
        Boolean isPlaying = call.getBoolean("isPlaying", false);
        long position = (long) (call.getDouble("position", 0.0) * 1000); // Convert seconds to ms
        float playbackRate = call.getFloat("playbackRate", 1.0f);

        Log.d(TAG, "updatePlaybackState: playing=" + isPlaying + " position=" + position);

        if (serviceBound && service != null) {
            service.updatePlaybackState(Boolean.TRUE.equals(isPlaying), position, playbackRate);
        }

        call.resolve();
    }

    @PluginMethod
    public void destroy(PluginCall call) {
        Log.d(TAG, "destroy called");
        destroyService();
        call.resolve();
    }

    private void startAndBindService() {
        if (serviceStarted) return;

        Context context = getContext();
        Intent intent = new Intent(context, MediaPlaybackService.class);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
            context.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
            serviceStarted = true;
            Log.d(TAG, "Service started and binding");
        } catch (Exception e) {
            Log.e(TAG, "Failed to start service: " + e.getMessage());
        }
    }

    private void destroyService() {
        Context context = getContext();

        if (serviceBound) {
            try {
                context.unbindService(serviceConnection);
            } catch (Exception e) {
                Log.w(TAG, "Error unbinding service: " + e.getMessage());
            }
            serviceBound = false;
        }

        if (serviceStarted) {
            try {
                Intent intent = new Intent(context, MediaPlaybackService.class);
                context.stopService(intent);
            } catch (Exception e) {
                Log.w(TAG, "Error stopping service: " + e.getMessage());
            }
            serviceStarted = false;
        }

        service = null;
    }
}

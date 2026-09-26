package xyz.bsums.aonsoku;

import android.content.res.Configuration;
import android.os.Bundle;

import androidx.annotation.NonNull;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NavigationBarPlugin.class);
        registerPlugin(MediaSessionPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);

        // Rotating (or switching light/dark) re-applies the activity theme,
        // which repaints the window background and undoes the colour the
        // NavigationBar plugin set. Without this the theme's light default
        // shows as a pale border around the WebView wherever the system bars
        // inset it, which is most visible in landscape.
        NavigationBarPlugin.reapply(this);
    }
}

package xyz.bsums.aonsoku;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.View;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NavigationBar")
public class NavigationBarPlugin extends Plugin {

    @PluginMethod
    public void setBackgroundColor(PluginCall call) {
        String color = call.getString("color");
        if (color == null || color.isEmpty()) {
            call.reject("Color is required");
            return;
        }

        try {
            final int parsedColor = Color.parseColor(color);
            final Boolean isLight = call.getBoolean("isLight", false);

            getActivity().runOnUiThread(() -> {
                Window window = getActivity().getWindow();

                // On Android 15+ (API 35+), setNavigationBarColor and setStatusBarColor
                // are deprecated and ignored. The system enforces edge-to-edge.
                // Instead, we set the Window background color which shows through
                // behind the transparent system bars.
                if (Build.VERSION.SDK_INT >= 35) {
                    // Set the window background to our theme color.
                    // This color shows behind the transparent system bars.
                    window.setBackgroundDrawable(new ColorDrawable(parsedColor));

                    // Disable the system's contrast-enforced scrim on the navigation bar
                    window.setNavigationBarContrastEnforced(false);
                    window.setStatusBarContrastEnforced(false);

                    // Set light/dark appearance for system bar icons
                    WindowInsetsControllerCompat insetsController =
                        WindowCompat.getInsetsController(window, window.getDecorView());
                    if (insetsController != null) {
                        // isAppearanceLightNavigationBars = true means dark icons (for light bg)
                        insetsController.setAppearanceLightNavigationBars(Boolean.TRUE.equals(isLight));
                        insetsController.setAppearanceLightStatusBars(Boolean.TRUE.equals(isLight));
                    }
                } else {
                    // Pre-Android 15: use the traditional APIs
                    window.setNavigationBarColor(parsedColor);
                    window.setStatusBarColor(parsedColor);

                    // Set light/dark navigation bar icons (API 26+)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        View decorView = window.getDecorView();
                        int flags = decorView.getSystemUiVisibility();
                        if (Boolean.TRUE.equals(isLight)) {
                            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                        } else {
                            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                        }
                        decorView.setSystemUiVisibility(flags);
                    }
                }
            });

            JSObject ret = new JSObject();
            ret.put("color", color);
            call.resolve(ret);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid color format: " + color, e);
        }
    }
}

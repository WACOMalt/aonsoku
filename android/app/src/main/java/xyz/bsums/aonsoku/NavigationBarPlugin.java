package xyz.bsums.aonsoku;

import android.app.Activity;
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

    // A configuration change (rotation, light/dark switch) re-applies the
    // activity theme, which repaints the window background and drops the
    // colour set here. Remember the last appearance so the activity can put
    // it back; otherwise the theme's light default shows around the WebView
    // wherever the system bars inset it.
    private static boolean hasAppearance = false;
    private static int lastColor = Color.BLACK;
    private static boolean lastIsLight = false;

    /** Re-applies the most recent appearance. No-op until one has been set. */
    public static void reapply(Activity activity) {
        if (!hasAppearance || activity == null) return;
        apply(activity.getWindow(), lastColor, lastIsLight);
    }

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
                hasAppearance = true;
                lastColor = parsedColor;
                lastIsLight = Boolean.TRUE.equals(isLight);
                apply(getActivity().getWindow(), lastColor, lastIsLight);
            });

            JSObject ret = new JSObject();
            ret.put("color", color);
            call.resolve(ret);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid color format: " + color, e);
        }
    }

    /** Paints the window + system bar icons. Must run on the UI thread. */
    private static void apply(Window window, int parsedColor, boolean isLight) {
        if (window == null) return;

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
                insetsController.setAppearanceLightNavigationBars(isLight);
                insetsController.setAppearanceLightStatusBars(isLight);
            }
        } else {
            // Pre-Android 15: use the traditional APIs
            window.setNavigationBarColor(parsedColor);
            window.setStatusBarColor(parsedColor);

            // Set light/dark system bar icons. Setting the status bar
            // flag here too keeps the icons correct regardless of
            // whether the StatusBar plugin call lands before or after.
            View decorView = window.getDecorView();
            int flags = decorView.getSystemUiVisibility();
            if (isLight) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            } else {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (isLight) {
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                } else {
                    flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                }
            }
            decorView.setSystemUiVisibility(flags);
        }
    }
}

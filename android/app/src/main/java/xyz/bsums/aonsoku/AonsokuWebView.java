package xyz.bsums.aonsoku;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.AttributeSet;

import com.getcapacitor.CapacitorWebView;

import java.util.HashSet;
import java.util.Set;

/**
 * The app's WebView, which keeps the web app running in the background while
 * music plays.
 *
 * When the app's window is hidden (in the background, or the screen off),
 * the WebView marks its page hidden and Chromium soon freezes it. The page
 * owns the queue and the Jam and Connect connections, so a frozen page means
 * the queue stops advancing and a Jam stops being followed. While any reason
 * to stay awake holds, the page is told its window is still visible. Nothing
 * is drawn either way; only the page's scripts keep running.
 */
public class AonsokuWebView extends CapacitorWebView {

    private static final Set<String> awakeReasons = new HashSet<>();
    private static AonsokuWebView current;

    private final Handler main = new Handler(Looper.getMainLooper());
    private int windowVisibility = VISIBLE;

    public AonsokuWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
        current = this;
    }

    /**
     * Adds or removes a reason to keep the page running in the background,
     * such as "native" (the native player is playing) or "page" (the web app
     * is playing or in a Jam).
     */
    static void setAwake(String reason, boolean awake) {
        new Handler(Looper.getMainLooper()).post(() -> {
            boolean before = !awakeReasons.isEmpty();
            if (awake) awakeReasons.add(reason); else awakeReasons.remove(reason);
            boolean after = !awakeReasons.isEmpty();
            if (before != after && current != null) current.applyVisibility();
        });
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        windowVisibility = visibility;
        super.onWindowVisibilityChanged(effectiveVisibility());
    }

    private void applyVisibility() {
        main.post(() -> super.onWindowVisibilityChanged(effectiveVisibility()));
    }

    private int effectiveVisibility() {
        return awakeReasons.isEmpty() ? windowVisibility : VISIBLE;
    }
}

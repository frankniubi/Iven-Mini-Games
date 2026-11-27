package cc.mcbar.minigames;

import android.content.res.AssetManager;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Small app-specific helpers the stock plugins don't cover (Android only; JS name "AppBridge").
 *
 *   copyBundledWeb({ to })  -> { files, bytes }
 *       Recursively copies the web bundle shipped in the APK (assets/public) into the absolute
 *       directory `to` (plain path or file:// URI). Creates directories, overwrites existing files.
 *       Runs on a background thread.
 *   getLocalIp()            -> { ip: string | null }
 *       First usable IPv4 address: wlan* first, then hotspot interfaces (ap*, swlan*, softap*),
 *       then any other up interface (cellular/VPN last); null if none.
 */
@CapacitorPlugin(name = "AppBridge")
public class AppBridgePlugin extends Plugin {

    private static final String TAG = "AppBridge";
    private static final String BUNDLED_WEB_DIR = "public";
    private static final int BUFFER_SIZE = 64 * 1024;

    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void copyBundledWeb(PluginCall call) {
        String to = call.getString("to");
        if (to == null || to.trim().isEmpty()) {
            call.reject("copyBundledWeb: option 'to' (absolute directory path or file:// URI) is required");
            return;
        }
        final File dest = toFile(to.trim());
        if (dest == null || !dest.isAbsolute()) {
            call.reject("copyBundledWeb: 'to' must be an absolute path or file:// URI, got: " + to);
            return;
        }

        io.execute(() -> {
            long started = System.currentTimeMillis();
            try {
                long[] totals = new long[2]; // [files, bytes]
                byte[] buffer = new byte[BUFFER_SIZE];
                AssetManager assets = getContext().getAssets();
                String[] top = assets.list(BUNDLED_WEB_DIR);
                if (top == null || top.length == 0) {
                    throw new IOException("bundled web directory assets/" + BUNDLED_WEB_DIR + " is empty or missing");
                }
                copyAssetDir(assets, BUNDLED_WEB_DIR, dest, totals, buffer);
                Logger.info(TAG, "copyBundledWeb: " + totals[0] + " files, " + totals[1] + " bytes -> " + dest +
                        " in " + (System.currentTimeMillis() - started) + " ms");
                JSObject ret = new JSObject();
                ret.put("files", totals[0]);
                ret.put("bytes", totals[1]);
                call.resolve(ret);
            } catch (Exception e) {
                Logger.error(TAG, "copyBundledWeb failed", e);
                call.reject("copyBundledWeb failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void getLocalIp(PluginCall call) {
        JSObject ret = new JSObject();
        String ip = null;
        try {
            ip = findLocalIpv4();
        } catch (Exception e) {
            Logger.error(TAG, "getLocalIp failed", e);
        }
        ret.put("ip", ip != null ? ip : JSONObject.NULL);
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        io.shutdown();
        super.handleOnDestroy();
    }

    // ---------------------------------------------------------------------------------------------

    private static File toFile(String pathOrUri) {
        if (pathOrUri.startsWith("file:")) {
            String p = Uri.parse(pathOrUri).getPath();
            return p != null ? new File(p) : null;
        }
        return new File(pathOrUri);
    }

    /** Recursively copies assets/<assetPath> into dir. An asset path with no children is a file. */
    private static void copyAssetDir(AssetManager assets, String assetPath, File dir, long[] totals, byte[] buffer)
        throws IOException {
        ensureDir(dir);
        String[] children = assets.list(assetPath);
        if (children == null) return;
        for (String name : children) {
            String childAsset = assetPath + "/" + name;
            File target = new File(dir, name);
            String[] grandChildren = assets.list(childAsset);
            if (grandChildren != null && grandChildren.length > 0) {
                copyAssetDir(assets, childAsset, target, totals, buffer);
            } else {
                totals[1] += copyAssetFile(assets, childAsset, target, buffer);
                totals[0]++;
            }
        }
    }

    private static long copyAssetFile(AssetManager assets, String assetPath, File target, byte[] buffer) throws IOException {
        if (target.isDirectory()) {
            throw new IOException("cannot overwrite directory with file: " + target);
        }
        long written = 0;
        try (InputStream in = assets.open(assetPath, AssetManager.ACCESS_STREAMING); OutputStream out = new FileOutputStream(target, false)) {
            int n;
            while ((n = in.read(buffer)) != -1) {
                out.write(buffer, 0, n);
                written += n;
            }
        }
        return written;
    }

    private static void ensureDir(File dir) throws IOException {
        if (dir.isDirectory()) return;
        if (dir.exists() && !dir.delete()) {
            throw new IOException("path exists and is not a directory: " + dir);
        }
        if (!dir.mkdirs() && !dir.isDirectory()) {
            throw new IOException("cannot create directory: " + dir);
        }
    }

    /** Lower rank = preferred. */
    private static int interfaceRank(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.startsWith("wlan")) return 0;
        if (n.startsWith("ap") || n.startsWith("swlan") || n.startsWith("softap")) return 1;
        if (n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("pdp") || n.startsWith("v4-") ||
            n.startsWith("tun") || n.startsWith("ppp") || n.startsWith("ipsec")) return 3;
        return 2;
    }

    private static String findLocalIpv4() throws Exception {
        String best = null;
        int bestRank = Integer.MAX_VALUE;
        for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!nif.isUp() || nif.isLoopback()) continue;
            int rank = interfaceRank(nif.getName());
            for (InetAddress addr : Collections.list(nif.getInetAddresses())) {
                if (!(addr instanceof Inet4Address) || addr.isLoopbackAddress()) continue;
                int r = addr.isLinkLocalAddress() ? rank + 10 : rank; // 169.254.x.x only as a last resort
                if (r < bestRank) {
                    bestRank = r;
                    best = addr.getHostAddress();
                }
            }
        }
        return best;
    }
}

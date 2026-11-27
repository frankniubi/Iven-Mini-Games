package cc.mcbar.minigames;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // In-app plugins must be registered before the bridge is created in super.onCreate().
        registerPlugin(AppBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

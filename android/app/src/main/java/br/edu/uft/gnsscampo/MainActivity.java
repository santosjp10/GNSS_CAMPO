package br.edu.uft.gnsscampo;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GnssStatusPlugin.class);
        registerPlugin(TcpNmeaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

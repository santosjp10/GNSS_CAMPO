package br.edu.uft.gnsscampo;

import android.content.Context;
import android.location.GnssStatus;
import android.location.LocationManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Expõe ao JavaScript o número de satélites em vista e em uso na solução GNSS,
 * lido diretamente do LocationManager nativo do Android (GnssStatus).
 * Isso não está disponível via API padrão de geolocalização web/Capacitor.
 */
@CapacitorPlugin(name = "GnssStatus")
public class GnssStatusPlugin extends Plugin {

    private LocationManager locationManager;
    private GnssStatus.Callback callback;

    @PluginMethod
    public void startListening(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            call.reject("Contagem de satélites requer Android 7.0 ou superior");
            return;
        }
        locationManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);

        if (callback == null) {
            callback = new GnssStatus.Callback() {
                @Override
                public void onSatelliteStatusChanged(GnssStatus status) {
                    int total = status.getSatelliteCount();
                    int used = 0;
                    for (int i = 0; i < total; i++) {
                        if (status.usedInFix(i)) used++;
                    }
                    JSObject data = new JSObject();
                    data.put("satellitesInView", total);
                    data.put("satellitesUsed", used);
                    notifyListeners("gnssStatusChange", data);
                }
            };
        }

        try {
            locationManager.registerGnssStatusCallback(callback, null);
            call.resolve();
        } catch (SecurityException e) {
            call.reject("Permissão de localização necessária");
        }
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        if (locationManager != null && callback != null) {
            locationManager.unregisterGnssStatusCallback(callback);
        }
        call.resolve();
    }
}

package br.edu.uft.gnsscampo;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * Conecta como cliente TCP a um servidor local (ex.: app "GNSS Master" configurado com
 * Receiver Data Output = TCP Server) e repassa cada linha NMEA recebida para o JavaScript.
 * Usado para receptores GNSS conectados via USB-C/OTG que são lidos por um app intermediário.
 */
@CapacitorPlugin(name = "TcpNmea")
public class TcpNmeaPlugin extends Plugin {

    private Socket socket;
    private Thread readThread;
    private volatile boolean running = false;

    @PluginMethod
    public void connect(PluginCall call) {
        final String host = call.getString("host", "127.0.0.1");
        final Integer port = call.getInt("port");
        if (port == null) { call.reject("Porta é obrigatória"); return; }

        disconnectInternal();
        running = true;

        readThread = new Thread(() -> {
            try {
                socket = new Socket();
                socket.connect(new InetSocketAddress(host, port), 5000);
                socket.setKeepAlive(true);

                JSObject statusOk = new JSObject();
                statusOk.put("connected", true);
                notifyListeners("tcpStatus", statusOk);

                BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
                String line;
                while (running && (line = reader.readLine()) != null) {
                    JSObject data = new JSObject();
                    data.put("line", line);
                    notifyListeners("nmeaLine", data);
                }
            } catch (Exception e) {
                JSObject statusErr = new JSObject();
                statusErr.put("connected", false);
                statusErr.put("error", e.getMessage() != null ? e.getMessage() : "Falha na conexão TCP");
                notifyListeners("tcpStatus", statusErr);
            } finally {
                running = false;
                JSObject statusClosed = new JSObject();
                statusClosed.put("connected", false);
                notifyListeners("tcpStatus", statusClosed);
            }
        });
        readThread.start();
        call.resolve();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        disconnectInternal();
        call.resolve();
    }

    private void disconnectInternal() {
        running = false;
        try {
            if (socket != null) socket.close();
        } catch (Exception e) { /* ignore */ }
        socket = null;
    }

    @Override
    protected void handleOnDestroy() {
        disconnectInternal();
        super.handleOnDestroy();
    }
}

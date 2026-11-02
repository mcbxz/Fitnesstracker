// Live-Herzfrequenz per Web Bluetooth über den standardisierten "Heart Rate Service"
// der Bluetooth SIG. Garmin-Uhren senden diesen Dienst, wenn auf der Uhr
// "Herzfrequenz übertragen" (Broadcast Heart Rate) aktiviert ist.

export const bluetoothSupported = () => typeof navigator !== "undefined" && !!navigator.bluetooth;

// Heart Rate Measurement (0x2A37): Bit 0 der Flags entscheidet über 8- oder 16-Bit-Wert
export function parseHeartRate(view) {
  const flags = view.getUint8(0);
  return flags & 0x1 ? view.getUint16(1, true) : view.getUint8(1);
}

export async function connectHeartRate({ onValue, onDisconnect }) {
  if (!bluetoothSupported()) {
    throw new Error("Web Bluetooth wird von diesem Browser nicht unterstützt (Chrome oder Edge am Desktop bzw. Android verwenden).");
  }
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] });
  device.addEventListener("gattserverdisconnected", () => onDisconnect?.());
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService("heart_rate");
  const characteristic = await service.getCharacteristic("heart_rate_measurement");
  characteristic.addEventListener("characteristicvaluechanged", (e) => onValue(parseHeartRate(e.target.value)));
  await characteristic.startNotifications();
  return {
    name: device.name || "Herzfrequenzsensor",
    disconnect: () => device.gatt.connected && device.gatt.disconnect(),
  };
}

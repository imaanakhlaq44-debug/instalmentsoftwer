/** Foreground alert only; the Android bridge is restricted to the trusted app origin. */
export function vibrateForNotification() {
  if (document.visibilityState === 'hidden') return;
  try {
    const bridge = (window as unknown as { AlmasDocument?: { postMessage: (value: string) => void } }).AlmasDocument;
    if (bridge) bridge.postMessage(JSON.stringify({ action: 'vibrate' }));
    else navigator.vibrate?.([120, 80, 120]);
  } catch { /* Haptics are optional on devices that do not support them. */ }
}

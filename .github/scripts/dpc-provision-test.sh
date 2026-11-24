#!/usr/bin/env bash
# Provisions the DPC on an emulator the way a QR scan does, and records what happens.
#
# Android's setup wizard turns a provisioning QR into the intent
# PROVISION_MANAGED_DEVICE_FROM_TRUSTED_SOURCE with PROVISIONING_TRIGGER = QR
# code. Firing that intent as root on a device marked "not set up yet" runs the
# same ManagedProvisioning flow: download, checksum, install, and on Android 12+
# the GET_PROVISIONING_MODE / ADMIN_POLICY_COMPLIANCE hand-off to the app.
#
# Env: APK_URL, CHECKSUM, OUT (artifact dir).
set -u
OUT="${OUT:-out}"
mkdir -p "$OUT/screens"
ADMIN="pk.almassdm.dpc/pk.almassdm.dpc.admin.AlmasDeviceAdminReceiver"

adb root >/dev/null 2>&1 || true
sleep 3
adb wait-for-device
adb shell getprop ro.build.version.release > "$OUT/android-version.txt"

# Make the emulator look like a phone fresh out of a factory reset.
# The settings alone are not enough: DevicePolicyManager remembers "setup
# complete" in device_policies.xml (binary ABX on Android 12+), so clear it
# there too and restart the framework.
adb shell settings put global device_provisioned 0
adb shell settings put secure user_setup_complete 0
adb shell 'f=/data/system/device_policies.xml; [ -f $f ] || exit 0
  if head -c 3 $f | grep -q ABX; then
    abx2xml $f /data/local/tmp/dp.xml && sed -i "s/ setup-complete=\"true\"//g" /data/local/tmp/dp.xml && xml2abx /data/local/tmp/dp.xml $f
  else
    sed -i "s/ setup-complete=\"true\"//g" $f
  fi; chown system:system $f; echo "policies: $(abx2xml $f - 2>/dev/null | head -c 300 || head -c 300 $f)"' 2>&1 | tee "$OUT/reset.txt"
adb shell stop
sleep 2
adb shell start
for i in $(seq 1 90); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 2
done
sleep 10
adb shell settings put global device_provisioned 0
adb shell settings put secure user_setup_complete 0
# Phones in a shop set up on Wi-Fi; keep the emulator's cellular link out of it.
adb shell svc data disable || true
adb shell input keyevent 82 || true
adb logcat -c

adb shell am start -W \
  -a android.app.action.PROVISION_MANAGED_DEVICE_FROM_TRUSTED_SOURCE \
  --ecn android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME "$ADMIN" \
  --es android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION "$APK_URL" \
  --es android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM "$CHECKSUM" \
  --ez android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED true \
  --ez android.app.extra.PROVISIONING_SKIP_ENCRYPTION true \
  --ei android.app.extra.PROVISIONING_TRIGGER 2 \
  2>&1 | tee "$OUT/am-start.txt"

cat > "$OUT/pick.py" <<'PY'
import re, sys, xml.etree.ElementTree as ET
try:
    root = ET.parse(sys.argv[1]).getroot()
except Exception:
    print("none 0 0 <no-ui>"); sys.exit()
nodes = list(root.iter("node"))
label = lambda n: (n.get("text") or n.get("content-desc") or "").strip()
joined = " | ".join(t for t in map(label, nodes) if t).replace("\n", " ")[:600]
low = joined.lower()
for bad in ("something went wrong", "couldn't set up", "can't set up", "cannot set up",
            "already set up", "isn't allowed", "is not allowed"):
    if bad in low:
        print("fail 0 0 " + joined); sys.exit()
# The Wi-Fi picker the wizard opens: we are already on Wi-Fi, so go back to setup.
if "searching for networks" in low or ("wi-fi" in low and "add network" in low):
    print("back 0 0 " + joined); sys.exit()
want = ["accept & continue", "accept and continue", "accept", "agree", "i agree",
        "next", "continue", "ok", "got it", "done", "start"]
for w in want:
    for n in nodes:
        if label(n).lower() == w and n.get("enabled") == "true":
            m = re.findall(r"\d+", n.get("bounds") or "")
            if len(m) == 4:
                x = (int(m[0]) + int(m[2])) // 2; y = (int(m[1]) + int(m[3])) // 2
                print(f"tap {x} {y} " + joined); sys.exit()
print("none 0 0 " + (joined or "<empty>"))
PY

outcome="TIMEOUT"
owner_seen=0
for step in $(seq 1 90); do
  sleep 4
  adb exec-out screencap -p > "$OUT/screens/$(printf '%02d' "$step").png" 2>/dev/null || true
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
  adb exec-out cat /sdcard/ui.xml > "$OUT/ui.xml" 2>/dev/null || true
  read -r action x y texts < <(python3 "$OUT/pick.py" "$OUT/ui.xml")
  echo "[$step] $action :: $texts" | tee -a "$OUT/steps.txt"

  if adb shell dpm list-owners 2>/dev/null | grep -q pk.almassdm.dpc; then
    [ "$owner_seen" = 0 ] && echo "[$step] DEVICE OWNER SET" | tee -a "$OUT/steps.txt"
    owner_seen=1
  fi

  if [ "$action" = "fail" ]; then outcome="FAILED_SCREEN"; break; fi
  if [ "$action" = "tap" ]; then adb shell input tap "$x" "$y"; continue; fi
  if [ "$action" = "back" ]; then
    backs=$((${backs:-0} + 1))
    [ "$backs" -le 3 ] && { adb shell input keyevent 4; continue; }
  fi

  # Done: owner set and the provisioning screens are gone.
  if [ "$owner_seen" = 1 ]; then
    top=$(adb shell dumpsys activity activities 2>/dev/null | grep -m1 -E "topResumedActivity|mResumedActivity" || true)
    echo "[$step] top: $top" >> "$OUT/steps.txt"
    if ! echo "$top" | grep -q managedprovisioning; then outcome="DEVICE_OWNER_OK"; break; fi
  fi
done

adb shell dpm list-owners > "$OUT/owners.txt" 2>&1 || true
adb shell dumpsys device_policy > "$OUT/device_policy.txt" 2>&1 || true
adb logcat -d -v threadtime > "$OUT/logcat.txt" 2>&1 || true
grep -iE "ManagedProvisioning|DevicePolicy|ProvisioningMode|ProvisioningHandoff|AlmasDeviceAdmin|PolicyCompliance|pk\.almassdm|AndroidRuntime|FATAL|DownloadManager|PackageManager" \
  "$OUT/logcat.txt" > "$OUT/logcat-provisioning.txt" || true

echo "OUTCOME=$outcome owner=$owner_seen android=$(tr -d '\r' < "$OUT/android-version.txt")" | tee "$OUT/outcome.txt"
exit 0

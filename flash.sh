#!/bin/sh
# Flash a Lumi light over USB with a released firmware image (macOS or Linux). See "Flash a light over USB" in README.md.
#   sh flash.sh [type] [version]    type: 1-7 from the list below; version: a release number, default the latest
# Needs curl and wchisp (https://github.com/ch32-rs/wchisp): on your PATH, or WCHISP=/path/to/wchisp.
ISP=${WCHISP:-wchisp}
REPO=${REPO:-https://github.com/jason3w/open_lumi/releases}
command -v "$ISP" >/dev/null || { echo "wchisp not found. Get it from https://github.com/ch32-rs/wchisp/releases (or: cargo install wchisp)."; exit 1; }

type=$1
if [ -z "$type" ]; then
  cat <<'LIST'
Which board is in the light? (The remote shows it: Settings, Update boards.)
  1) nanoCH57x                       5) Lumi R3D
  2) nanoCH57x with accelerometer    6) Lumi R3DA
  3) Lumi R3                         7) Lumi R4C / R4S
  4) Lumi R3A
LIST
  printf 'Board number: '; read type
fi
case $type in [1-7]) ;; *) echo "Pick a board from 1 to 7."; exit 1;; esac

img=${TMPDIR:-/tmp}/lumi-$type.hex
echo "Fetching the ${2:+version $2 }image for board $type..."
rel=latest/download; [ -n "$2" ] && rel=download/v$2
curl -fsSL -o "$img" "$REPO/$rel/lumi-$type.hex" || { echo "Couldn't fetch it. Check the version number and your connection."; exit 1; }
grep -q '^:00000001FF' "$img" || { echo "That download isn't a firmware image."; exit 1; }

out=${TMPDIR:-/tmp}/lumi-wchisp.txt
found() { "$ISP" probe 2>&1 | grep -q "Found [1-9]"; }
run() { "$ISP" "$@" 2>&1 | tee "$out"; ! grep -q "Error" "$out"; }   # wchisp prints "Error: ..." when a step fails
isp() { until run "$@"; do echo "Trying again..."; sleep 1; until found; do sleep 0.5; done; done; }   # the first connect often times out
boot() { echo "$1"; until found; do sleep 0.5; done; }

boot "Plug the light into USB and hold its button for 15 seconds (or plug it in with its boot switch on). Waiting for it..."
isp info
until grep -q "CFG_ROM_READ 0xFF" "$out"; do   # a locked chip refuses USB writes: unlock it, then it has to start again
  isp config reset
  echo "Unlocked. Unplug the light."; while found; do sleep 0.5; done
  boot "Now plug it in again with its boot switch on (after the 15 second hold the unlock doesn't always keep). Waiting for it..."
  isp info
done
isp flash "$img"
echo "Done. Unplug the light: it starts with the new firmware."

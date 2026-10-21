#!/bin/sh
set -eu
Xvfb :99 -screen 0 360x640x24 -ac -nolisten tcp -noreset >/tmp/reelparty-xvfb.log 2>&1 &
sleep 1
mkdir -p "$HOME/.config/pulse"
pulseaudio --start --exit-idle-time=-1 --log-target=stderr >/tmp/reelparty-pulse.log 2>&1 || true
sleep 1
pactl load-module module-null-sink sink_name=reelparty sink_properties=device.description=ReelParty >/dev/null 2>&1 || true
pactl set-default-sink reelparty >/dev/null 2>&1 || true
exec node server.js

#!/bin/sh
set -eu

# Railway mounts new volumes as root. Give the application user access
# before Chromium opens its persistent profile.
if [ -d /data ]; then
  chown reelparty:reelparty /data
  if [ -d /data/instagram-profile ]; then
    chown -R reelparty:reelparty /data/instagram-profile
  fi
fi

exec gosu reelparty /app/start.sh

#!/bin/sh
set -e

# Run the standard nginx docker-entrypoint.d scripts (env substitution, etc.)
for f in /docker-entrypoint.d/*.sh; do
  if [ -x "$f" ]; then
    echo "Running entrypoint script: $f"
    "$f"
  fi
done

# Start the jam-sync Node.js server in the background
echo "Starting jam-sync server..."
node /opt/jam-sync-server/index.js &
JAM_PID=$!

# Start nginx in the foreground
echo "Starting nginx..."
exec nginx -g "daemon off;"

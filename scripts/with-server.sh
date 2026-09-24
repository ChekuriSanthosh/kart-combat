#!/bin/sh
# Starts the game server on PORT (default 3100) if it is not already up,
# runs the given command against it, and leaves the server running.
PORT=${PORT:-3100}
if ! curl -s -o /dev/null "http://localhost:$PORT/"; then
  (PORT=$PORT nohup node server.js > /tmp/kc.log 2>&1 < /dev/null &)
  for i in $(seq 1 30); do
    curl -s -o /dev/null "http://localhost:$PORT/" && break
    sleep 0.3
  done
fi
exec "$@"

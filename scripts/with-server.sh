#!/bin/sh
# Runs the given command against a freshly started game server on PORT.
#
# This used to reuse whatever was already listening, which is faster but
# silently wrong: a server left over from an earlier run is running the code
# as it was *then*, so a test can pass or fail for reasons that have nothing
# to do with the working tree. Restarting every time costs about a second —
# most of it building nav grids — and that is far cheaper than debugging a
# result that was never about your changes.
PORT=${PORT:-3100}

# Stop anything already on the port, ours or a previous run's.
PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null)
if [ -n "$PIDS" ]; then
  kill $PIDS 2>/dev/null
  for i in $(seq 1 20); do
    lsof -ti tcp:"$PORT" >/dev/null 2>&1 || break
    sleep 0.1
  done
  # Still holding the port after two seconds: insist.
  PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null)
  [ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null
fi

(PORT=$PORT nohup node server.js > /tmp/kc.log 2>&1 < /dev/null &)
for i in $(seq 1 40); do
  curl -s -o /dev/null "http://localhost:$PORT/" && break
  sleep 0.3
done

exec "$@"

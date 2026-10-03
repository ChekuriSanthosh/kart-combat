#!/bin/sh
# Runs the given command against a freshly started game server on PORT, then
# stops that server again.
#
# This used to reuse whatever was already listening, which is faster but
# silently wrong: a server left over from an earlier run is running the code
# as it was *then*, so a test can pass or fail for reasons that have nothing
# to do with the working tree. Restarting every time costs about a second —
# most of it building nav grids — and that is far cheaper than debugging a
# result that was never about your changes.
#
# For the same reason the server we start never outlives the run (it used to
# keep serving stale code until the next run killed it), each port logs to
# its own file so parallel runs on different ports cannot clobber each other,
# and a server that never came up is reported as such instead of surfacing
# later as a confusing connection error inside the test.
#
#   PORT=3300 ./scripts/with-server.sh node scripts/lobbytest.mjs
#
# Exits with the command's own status, or 1 if the server would not start.
PORT=${PORT:-3100}
export PORT
LOG="/tmp/kc-$PORT.log"
SERVER_PID=

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

stop_server() {
  [ -n "$SERVER_PID" ] || return 0
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
    for i in $(seq 1 20); do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 "$SERVER_PID" 2>/dev/null
  fi
  SERVER_PID=
}
# EXIT covers every way out, including the failures below. A background job
# in a non-interactive shell ignores Ctrl-C, so the server would survive an
# interrupted run unless the signal is turned into an exit here.
trap stop_server EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

node server.js > "$LOG" 2>&1 < /dev/null &
SERVER_PID=$!

up=
for i in $(seq 1 40); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break  # it died (port still taken, syntax error…): no point waiting
  fi
  if curl -sf -o /dev/null "http://localhost:$PORT/"; then
    up=1
    break
  fi
  sleep 0.3
done

if [ -z "$up" ]; then
  echo "with-server: the game server did not come up on port $PORT. Last lines of $LOG:" >&2
  tail -n 40 "$LOG" >&2
  exit 1
fi

"$@"
status=$?
exit $status

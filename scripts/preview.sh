#!/bin/bash
# Bezpieczne uruchamianie serwera podglądu (npm run preview / preview:stop / preview:status).
#
# Po co to zamiast gołego `next start`: serwer Next potrafi na tym Macu rozbiec się do kilkuset
# procent CPU i grzać laptopa, a zapomniany proces potrafi tak wisieć godzinami. Ten skrypt
# pilnuje trzech rzeczy naraz:
#   1. zabija TYLKO proces na naszym porcie (nie `pkill next-server`, bo to ubija też serwery
#      innych projektów - zdarzyło się i zatrzymało cudzą pracę),
#   2. watchdog co 10 s sprawdza CPU i ubija serwer, gdy przekroczy próg trzy razy z rzędu,
#   3. twardy limit czasu życia - serwer sam się wyłącza, nawet jeśli o nim zapomnisz.
#
# Progi można nadpisać zmiennymi: PORT, MAX_CPU (%), MAX_MIN (minuty).

set -u

PORT="${PORT:-3000}"
MAX_CPU="${MAX_CPU:-400}"
MAX_MIN="${MAX_MIN:-30}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$DIR/.next/preview"
LOG="$RUN/server.log"
WLOG="$RUN/watchdog.log"

mkdir -p "$RUN"

# PID procesu faktycznie słuchającego na porcie - `next start` odpala workera o innym PID
# niż npm, więc mierzenie CPU po PID-zie npm pokazywało zawsze 0%.
server_pid() { lsof -ti:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1; }

stop() {
  # Najpierw watchdog, potem serwer - inaczej watchdog zdąży zgłosić ubicie jako swoje.
  if [ -f "$RUN/watchdog.pid" ]; then
    kill "$(cat "$RUN/watchdog.pid")" 2>/dev/null
    rm -f "$RUN/watchdog.pid"
  fi

  local pid
  pid="$(server_pid)"
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null
    sleep 1
    kill -9 "$pid" 2>/dev/null
    echo "zatrzymano serwer (pid $pid, port $PORT)"
  else
    echo "nic nie słuchało na porcie $PORT"
  fi
}

status() {
  local pid
  pid="$(server_pid)"
  if [ -z "$pid" ]; then
    echo "serwer: NIE DZIAŁA (port $PORT wolny)"
    [ -f "$WLOG" ] && echo "ostatni wpis watchdoga: $(tail -1 "$WLOG")"
    return
  fi
  echo "serwer: działa   pid=$pid   port=$PORT"
  ps -o %cpu=,rss=,etime= -p "$pid" | awk '{printf "CPU=%s%%  RAM=%.0f MB  czas życia=%s\n", $1, $2/1024, $3}'
  echo "limity: MAX_CPU=${MAX_CPU}%  MAX_MIN=${MAX_MIN} min"
}

watchdog() {
  local pid="$1" over=0 waited=0
  echo "$(date '+%H:%M:%S') start watchdoga: pid=$pid próg=${MAX_CPU}% limit=${MAX_MIN}min" >> "$WLOG"
  while kill -0 "$pid" 2>/dev/null; do
    sleep 10
    waited=$((waited + 10))

    local cpu
    cpu="$(ps -o %cpu= -p "$pid" 2>/dev/null | tr -d ' ' | tr ',' '.')"
    [ -z "$cpu" ] && break

    # bash nie liczy ułamków - porównanie przez część całkowitą
    if [ "${cpu%%.*}" -ge "$MAX_CPU" ]; then
      over=$((over + 1))
      echo "$(date '+%H:%M:%S') UWAGA CPU=${cpu}% (${over}/3)" >> "$WLOG"
      # Trzy odczyty z rzędu, nie jeden: pojedynczy skok to normalne renderowanie strony,
      # dopiero utrzymujące się obciążenie oznacza rozbieganie.
      if [ "$over" -ge 3 ]; then
        echo "$(date '+%H:%M:%S') UBIJAM - CPU ${cpu}% przez 30 s" >> "$WLOG"
        kill -9 "$pid" 2>/dev/null
        break
      fi
    else
      over=0
    fi

    if [ "$waited" -ge $((MAX_MIN * 60)) ]; then
      echo "$(date '+%H:%M:%S') UBIJAM - minął limit ${MAX_MIN} min" >> "$WLOG"
      kill -9 "$pid" 2>/dev/null
      break
    fi
  done
  rm -f "$RUN/watchdog.pid"
}

case "${1:-start}" in
  stop)   stop ;;
  status) status ;;
  watch)  watchdog "$2" ;;   # tryb wewnętrzny, wołany przez start
  start)
    if [ -n "$(server_pid)" ]; then
      echo "Na porcie $PORT już coś działa - zatrzymuję to najpierw."
      stop
      sleep 1
    fi

    if [ ! -d "$DIR/.next" ] || [ ! -f "$DIR/.next/BUILD_ID" ]; then
      echo "Brak buildu produkcyjnego - uruchom najpierw: npm run build"
      exit 1
    fi

    : > "$LOG"
    # Odpinamy KOMPLETNIE (także stdin), inaczej proces potomny trzyma otwarty potok terminala
    # i `npm run preview` nie oddaje znaku zachęty, mimo że serwer już działa.
    (cd "$DIR" && PORT="$PORT" nohup npx next start > "$LOG" 2>&1 < /dev/null &)

    # Czekamy aż port zacznie odpowiadać, zamiast sztywnego sleep
    for _ in $(seq 1 30); do
      [ -n "$(server_pid)" ] && break
      sleep 1
    done

    pid="$(server_pid)"
    if [ -z "$pid" ]; then
      echo "Serwer nie wstał. Log:"
      tail -20 "$LOG"
      exit 1
    fi

    # PID watchdoga zapisujemy OD RAZU - bez tego `stop` nie miał go jak ubić i po zatrzymaniu
    # serwera zostawał osierocony proces pilnujący nieistniejącego PID-u.
    (nohup bash "${BASH_SOURCE[0]}" watch "$pid" > /dev/null 2>&1 < /dev/null & echo $! > "$RUN/watchdog.pid")
    echo "$pid" > "$RUN/server.pid"

    echo "Serwer działa: http://localhost:$PORT  (pid $pid)"
    echo "Wyłączy się sam po ${MAX_MIN} min albo gdy CPU przekroczy ${MAX_CPU}% przez 30 s."
    echo "Ręcznie: npm run preview:stop   |   podgląd: npm run preview:status"
    ;;
  *)
    echo "użycie: $0 [start|stop|status]"
    exit 1 ;;
esac

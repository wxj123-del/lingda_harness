#!/bin/sh
# Open the `dsh web` running on this machine to a phone on another network.
#
# Starts an ngrok tunnel to the local web port, launches `dsh web` trusting the
# tunnel hostname, and prints a QR code of the public URL carrying the one-time
# browser token. Scanning it is the whole login.
#
# Requires ngrok already authenticated (`ngrok config add-authtoken ...`),
# python3, and qrencode (`brew install qrencode`).
#
# Usage: scripts/dsh-phone.sh [port]
#   port   local port dsh web binds (default 3000)
set -eu

port="${1:-3000}"
here=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

for tool in ngrok python3 qrencode curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "缺少 $tool。ngrok 与 qrencode 都可以用 brew install 安装，ngrok 还要先 config add-authtoken。" >&2
    exit 1
  fi
done

ngrok http "$port" --log stdout > /tmp/dsh-ngrok.log 2>&1 &
ngrok_pid=$!
dsh_pid=""
cleanup() {
  if [ -n "$dsh_pid" ]; then
    kill "$dsh_pid" 2>/dev/null || true
  fi
  kill "$ngrok_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

public_url=""
i=0
while [ "$i" -lt 40 ]; do
  i=$((i + 1))
  public_url=$(curl -fsS http://127.0.0.1:4040/api/tunnels 2>/dev/null \
    | python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
for tunnel in data.get("tunnels", []):
    url = tunnel.get("public_url", "")
    if url.startswith("https://"):
        print(url)
        break' || true)
  if [ -n "$public_url" ]; then
    break
  fi
  sleep 0.5
done

if [ -z "$public_url" ]; then
  echo "ngrok 没有给出公网地址。日志在 /tmp/dsh-ngrok.log" >&2
  exit 1
fi

host=${public_url#https://}
host=${host%%/*}

echo "隧道: $public_url"
echo "正在启动 dsh web，信任 $host"

cd "$here"
pnpm run dsh web -- --port "$port" --no-open --trusted-host "$host" > /tmp/dsh-web.log 2>&1 &
dsh_pid=$!

local_url=""
i=0
while [ "$i" -lt 120 ]; do
  i=$((i + 1))
  local_url=$(sed -n 's/^dsh web: \(http:\/\/[^ ]*\).*/\1/p' /tmp/dsh-web.log | head -n 1 || true)
  if [ -n "$local_url" ]; then
    break
  fi
  if ! kill -0 "$dsh_pid" 2>/dev/null; then
    echo "dsh web 退出了。日志:" >&2
    cat /tmp/dsh-web.log >&2
    exit 1
  fi
  sleep 0.5
done

case "$local_url" in
  *token=*) token=${local_url##*token=} ;;
  *)
    echo "没有从 dsh web 的输出里拿到 token。日志在 /tmp/dsh-web.log" >&2
    exit 1
    ;;
esac
token=${token%%&*}

phone_url="${public_url}/?token=${token}"

echo
echo "用手机扫这个二维码。链接等同于登录钥匙，不要发给别人。"
echo "$phone_url"
echo
qrencode -t ANSIUTF8 "$phone_url"
echo
echo "DSH 和隧道都在运行。按 Ctrl-C 一起停掉。"
wait "$dsh_pid"

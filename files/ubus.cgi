#!/bin/sh
[ "$REQUEST_METHOD" != "POST" ] && printf 'Status: 405\r\n\r\n' && exit

access() {
  local sid=$1
  local obj=$2
  local fun=$3

  local req=$(printf '{ "ubus_rpc_session": "%s", "scope": "ubus", "object": "%s", "function": "%s" }' "$sid" "$obj" "$fun")
  local res=$(ubus call session access "$req" | jsonfilter -e '@.access')

  [ "$res" = "true" ]
}

error() {
  local code=$1
  local mesg=$2

  printf '{ "jsonrpc": "2.0", "id": "%s", "error": { "code": %d, "message": "%s" } }'  \
    "${RPC_ID:-null}" "$code" "$mesg"

  exit 1
}

process() {
  local request=$1

  eval $(jsonfilter -s "$request" \
    -e 'RPC_ID=@.id' \
    -e 'RPC_VERSION=@.jsonrpc' \
    -e 'RPC_METHOD=@.method' \
    -e 'RPC_SESSION_ARG=@.params[3].ubus_rpc_session' \
    -e 'UBUS_SID=@.params[0]' \
    -e 'UBUS_SERVICE=@.params[1]' \
    -e 'UBUS_CMD=@.params[2]')

  if [ -z "$RPC_ID" ] || [ "$RPC_VERSION" != "2.0" ]; then
    error -32600 "Invalid request"
  fi

  case "$RPC_ID$UBUS_SID$UBUS_SERVICE$UBUS_CMD" in
    *[^a-zA-Z0-9_.-]*) error -32600 "Invalid request" ;;
  esac

  case "$RPC_METHOD" in
    call)
      UBUS_PAYLOAD=$(jsonfilter -s "$request" -e '@.params[3]')

      case "$UBUS_PAYLOAD" in
        ""|{*}) : ;;
        *) error -32602 "Invalid parameters" ;;
      esac

      if [ -z "$UBUS_PAYLOAD" ] || [ "$UBUS_PAYLOAD" = "{ }" ]; then
        UBUS_PAYLOAD=$(printf '{ "ubus_rpc_session": "%s" }' "$UBUS_SID")
      else
        UBUS_PAYLOAD=$(printf '{ "ubus_rpc_session": "%s", %s' "$UBUS_SID" "${UBUS_PAYLOAD#\{ }")
      fi

      if [ -n "$RPC_SESSION_ARG" ]; then
        error -32602 "Invalid parameters"
      fi

      if ! access "$UBUS_SID" "$UBUS_SERVICE" "$UBUS_CMD"; then
        error -32002 "Access denied"
      fi

      ubus_reply=$(ubus call "$UBUS_SERVICE" "$UBUS_CMD" "$UBUS_PAYLOAD")
      ubus_status=$?

      printf '{ "jsonrpc": "2.0", "id": "%s", "result": [ %d, %s ] }' \
        "$RPC_ID" "$ubus_status" "${ubus_reply:-null}"
    ;;
    list)
      RPC_PARAMS=$(jsonfilter -s "$request" -e '@.params')

      case "${RPC_PARAMS:-[ ]}" in
        \[*\]) : ;;
        *) error -32602 "Invalid parameters" ;;
      esac

      if [ "${RPC_PARAMS:-[ ]}" = "[ ]" ]; then
        services=''

        for service in $(ubus list); do
          services="${services:+$services, }\"$service\""
        done

        printf '{ "jsonrpc": "2.0", "id": "%s", "result": [ %s ] }' \
          "$RPC_ID" "$services"
      else
        signatures=''

        eval $(jsonfilter -s "$RPC_PARAMS" -e 'indexes=@')

        for i in $indexes; do
          service=$(jsonfilter -s "$RPC_PARAMS" -e "@[$i]")
          signature=''

          IFS=$'\n\t'
          for line in $(ubus -v list "$service" | tail -n +2); do
            signature="${signature:+$signature, }$line"
          done
          IFS=$' \n\t'

          signatures="${signatures:+$signatures, }\"$service\": { $signature }"
        done

        printf '{ "jsonrpc": "2.0", "id": "%s", "result": { %s } }' \
          "$RPC_ID" "$signatures"
      fi
    ;;
    *)
      error -32601 "Method not found"
    ;;
  esac
}

body=$(cat)
type=$(jsonfilter -s "$body" -t '@')

printf 'Content-Type: application/json\r\n\r\n'

if [ "$type" = "array" ]; then
  first=true
  printf '['
  jsonfilter -s "$body" -e '@.*' | while read request ; do
    if ! $first; then
      printf ','
    else
      first=false
    fi
    process "$request"
  done
  printf ']'
else
  process "$body"
fi

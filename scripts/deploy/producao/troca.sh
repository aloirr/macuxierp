# shellcheck shell=bash
# Troca sem parada da api e do web (v0.3.23, decisão 48 A; ADR 0003, adendo 48 A). Carregado com source pelo implantar.sh,
# depois do comum.sh (usa o dc() e a REDE_TUNEL) e de um log(). Testado com docker falso em scripts/deploy/troca.test.mjs.
# O fluxo está no adendo 48 A da ADR 0003. Só mexe em contêiner cujo id veio do `dc ps -q <serviço>` do projeto macuxierp: nunca nome digitado, nunca o FDV.

TROCA_DRENO_S="${MACUXIERP_TROCA_DRENO_S:-10}"
TROCA_ESPERA_S="${MACUXIERP_TROCA_ESPERA_S:-240}"
TROCA_PASSO_S="${MACUXIERP_TROCA_PASSO_S:-2}"
# pico da troca: +512 MiB (api) e +384 MiB (web) por 1 a 2 min; abaixo do piso, publica como antes (recria)
TROCA_MIN_MIB="${MACUXIERP_TROCA_MIN_MIB:-1280}"
TROCA_MEMINFO="${MACUXIERP_MEMINFO:-/proc/meminfo}"

ids_do_servico() { # serviço → ids dos contêineres do projeto macuxierp, um por linha
  dc ps -q "$1" 2>/dev/null | sed '/^$/d'
}

memoria_livre_mib() { # MemAvailable da VM em MiB (vazio se não der para ler)
  local kb
  kb="$(awk '/^MemAvailable:/ { print $2 }' "$TROCA_MEMINFO" 2>/dev/null)"
  [[ "$kb" =~ ^[0-9]+$ ]] && printf '%s\n' $((kb / 1024))
}

memoria_para_troca() { # 0 = MemAvailable da VM ≥ piso; registra o número em toda publicação (medição da 48 A)
  local mib
  mib="$(memoria_livre_mib)"
  log "memória livre da VM (MemAvailable): ${mib:-?} MiB (piso da troca sem parada: ${TROCA_MIN_MIB} MiB)"
  [ -n "$mib" ] && [ "$mib" -ge "$TROCA_MIN_MIB" ]
}

saudavel() { # id → 0 quando o healthcheck do contêiner fica healthy (sem healthcheck: running)
  local t=0 st
  while [ "$t" -lt "$TROCA_ESPERA_S" ]; do
    st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo ausente)"
    case "$st" in
      healthy | running) return 0 ;;
      unhealthy | exited | dead | ausente) return 1 ;;
    esac
    sleep "$TROCA_PASSO_S"
    t=$((t + TROCA_PASSO_S))
  done
  return 1
}

todas_ok() { # serviço função [args] → 0 = há réplica e a função passa em todas (o id vai como 1º argumento)
  local svc="$1" f="$2" ids id
  shift 2
  ids="$(ids_do_servico "$svc")"
  [ -n "$ids" ] || return 1
  for id in $ids; do "$f" "$id" "$@" || return 1; done
}

remover_replica() { # id [dreno] → sai do túnel, drena, para (SIGTERM, até 30 s) e é removido
  local dreno="${2:-$TROCA_DRENO_S}"
  docker network disconnect "$REDE_TUNEL" "$1" >/dev/null 2>&1 || true
  [ "$dreno" -gt 0 ] && sleep "$dreno"
  docker stop -t 30 "$1" >/dev/null 2>&1 || true
  docker rm -f "$1" >/dev/null 2>&1 || true
}

# ---------- laço de curl pelo domínio durante a troca (v0.3.24; ADR 0003, adendo 48 A, "Laço durante a troca") ----------
# GET <base>/login e <base>/v1/saude a cada MACUXIERP_TROCA_LACO_PASSO_S (1 s), do "réplica nova ao lado da velha" até a
# velha sair do túnel e drenar. Base: MACUXIERP_URL_PUBLICA (ambiente ou .env; não é segredo), padrão o domínio do ERP.
# Os resultados ficam num mktemp -d apagado no fim; o laço e o curl em curso morrem no fim, na falha e na saída do script.
TROCA_URL_PADRAO=https://erp.macuxifdv.com.br
TROCA_LACO_PASSO_S="${MACUXIERP_TROCA_LACO_PASSO_S:-1}"
TROCA_LACO_TIMEOUT_S="${MACUXIERP_TROCA_LACO_TIMEOUT_S:-3}"
TROCA_LACO_PID=""
TROCA_LACO_DIR=""

laco_url_base() { # → base pública do ERP, sem barra no fim
  local b="${MACUXIERP_URL_PUBLICA:-$(valor_env .env MACUXIERP_URL_PUBLICA)}"
  b="${b:-$TROCA_URL_PADRAO}"
  printf '%s\n' "${b%/}"
}

laco_iniciar() { # 0 = laço no ar (TROCA_LACO_PID, TROCA_LACO_DIR)
  local base
  command -v curl >/dev/null 2>&1 || { echo "[implantar] curl ausente na VM: sem o laço de conferência da troca" >&2; return 1; }
  base="$(laco_url_base)"
  TROCA_LACO_DIR="$(mktemp -d "${TMPDIR:-/tmp}/macuxierp-laco.XXXXXX")" || { TROCA_LACO_DIR=""; return 1; }
  trap 'laco_parar' EXIT
  trap 'laco_parar; exit 130' INT
  trap 'laco_parar; exit 143' TERM
  (
    c=""
    trap '[ -n "$c" ] && kill "$c" 2>/dev/null; exit 0' TERM
    trap '' INT
    while :; do
      for p in login v1/saude; do
        curl -s -o /dev/null -m "$TROCA_LACO_TIMEOUT_S" -w '%{http_code} %{time_total}' "$base/$p" >"$TROCA_LACO_DIR/r" 2>/dev/null &
        c=$!
        wait "$c" || true
        c=""
        r="$(cat "$TROCA_LACO_DIR/r" 2>/dev/null || true)"
        printf '%s\n' "${r:-000 0}" >>"$TROCA_LACO_DIR/${p//\//_}"
      done
      sleep "$TROCA_LACO_PASSO_S" &
      c=$!
      wait "$c" || true
      c=""
    done
  ) &
  TROCA_LACO_PID=$!
}

laco_parar() { # mata o laço (e o curl em curso), espera e apaga o mktemp; idempotente
  trap - EXIT INT TERM
  if [ -n "$TROCA_LACO_PID" ]; then
    kill -TERM "$TROCA_LACO_PID" 2>/dev/null || true
    wait "$TROCA_LACO_PID" 2>/dev/null || true
    TROCA_LACO_PID=""
  fi
  if [ -n "$TROCA_LACO_DIR" ]; then
    rm -rf -- "$TROCA_LACO_DIR"
    TROCA_LACO_DIR=""
  fi
}

laco_resumo() { # arquivo rótulo → a linha do laço; 0 = ao menos uma chamada e todas 200
  LC_ALL=C awk -v rot="$2" -v hora="$(TZ=America/Manaus date +%H:%M:%S)" '
    NF { n++; cod[$1]++; t = $2; gsub(",", ".", t); ms = int(t * 1000 + 0.5); if (ms > max) max = ms }
    END {
      k = 0; for (x in cod) chaves[++k] = x
      for (i = 2; i <= k; i++) { v = chaves[i]; j = i - 1; while (j > 0 && chaves[j] > v) { chaves[j + 1] = chaves[j]; j-- } chaves[j + 1] = v }
      lista = ""; for (i = 1; i <= k; i++) lista = lista (i > 1 ? ", " : "") chaves[i] ": " cod[chaves[i]]
      printf "[implantar] %s laço %s durante a troca: %d chamadas, códigos {%s}, maior tempo %d ms\n", hora, rot, n, lista, max + 0
      exit (n > 0 && cod["200"] == n) ? 0 : 1
    }' "$1"
}

laco_encerrar() { # → as duas linhas do laço; 0 = todas as chamadas 200. Espera ao menos uma medição de cada URL.
  local ok=0 t=0 limite
  [ -n "$TROCA_LACO_DIR" ] || return 1
  limite=$(( (2 * TROCA_LACO_TIMEOUT_S + TROCA_LACO_PASSO_S + 1) * 5 ))
  while { [ ! -s "$TROCA_LACO_DIR/login" ] || [ ! -s "$TROCA_LACO_DIR/v1_saude" ]; } && [ "$t" -lt "$limite" ]; do
    sleep 0.2
    t=$((t + 1))
  done
  kill -TERM "$TROCA_LACO_PID" 2>/dev/null || true
  wait "$TROCA_LACO_PID" 2>/dev/null || true
  TROCA_LACO_PID=""
  touch "$TROCA_LACO_DIR/login" "$TROCA_LACO_DIR/v1_saude"
  laco_resumo "$TROCA_LACO_DIR/login" /login || ok=1
  laco_resumo "$TROCA_LACO_DIR/v1_saude" /v1/saude || ok=1
  laco_parar
  return "$ok"
}

# trocar_servico <serviço> [conferência extra da réplica nova: função que recebe o id]
# 0 = a nova está no ar, a velha saiu e o laço pelo domínio só viu 200; 1 = a nova não ficou saudável (foi removida; a
# velha segue no túnel) ou o laço viu código diferente de 200 (o implantar.sh volta atrás pelo mesmo caminho).
trocar_servico() {
  local svc="$1" extra="${2:-}" velho novo="" id rc=0
  velho="$(ids_do_servico "$svc")"
  if [ -z "$velho" ]; then
    log "$svc: sem réplica no ar; sobe direto"
    dc up -d --no-deps --wait --wait-timeout "$TROCA_ESPERA_S" "$svc"
    return
  fi
  if [ "$(printf '%s\n' "$velho" | wc -l)" -ne 1 ]; then
    echo "[implantar] $svc com mais de uma réplica antes da troca (sobra de uma troca interrompida?): confira com dc ps" >&2
    return 1
  fi
  laco_iniciar || { laco_parar; echo "[implantar] $svc: o laço de conferência pelo domínio não subiu; nada foi trocado" >&2; return 1; }
  log "$svc: réplica nova ao lado da velha"
  dc up -d --no-deps --no-recreate --scale "$svc=2" "$svc" >/dev/null || true
  for id in $(ids_do_servico "$svc"); do
    [ "$id" = "$velho" ] || novo="$id"
  done
  if [ -z "$novo" ] || ! saudavel "$novo" || { [ -n "$extra" ] && ! "$extra" "$novo"; }; then
    echo "[implantar] $svc: a réplica nova não ficou saudável; ela sai e a velha continua no ar" >&2
    [ -n "$novo" ] && remover_replica "$novo" 0
    dc up -d --no-deps --no-recreate --scale "$svc=1" "$svc" >/dev/null 2>&1 || true
    laco_encerrar || true
    return 1
  fi
  log "$svc: nova saudável; a velha sai do túnel e drena ${TROCA_DRENO_S} s"
  remover_replica "$velho"
  dc up -d --no-deps --no-recreate --scale "$svc=1" "$svc" >/dev/null || rc=1
  if ! laco_encerrar; then
    echo "[implantar] $svc: o laço pelo domínio viu código diferente de 200 durante a troca: volta atrás" >&2
    rc=1
  fi
  return "$rc"
}

# ---------- conferência de dentro do contêiner (sem porta no host) ----------
# O alerta-saude.sh tem uma cópia deste fetch (roda sozinho na VM, sem o troca.sh): as duas mudam juntas.
saude_api() { # id → o corpo do /v1/saude da réplica
  docker exec "$1" node -e "fetch('http://127.0.0.1:8100/v1/saude').then((r)=>r.text()).then((t)=>process.stdout.write(t),()=>process.exit(1))" 2>/dev/null
}
api_na_versao() { # id versão → 0 = banco ok e a versão pedida
  local corpo
  corpo="$(saude_api "$1" || true)"
  printf '%s' "$corpo" | grep -q '"banco":"ok"' && printf '%s' "$corpo" | grep -q "\"versao\":\"$2\""
}
web_responde() { # id → 0 = /login 200 na réplica
  docker exec "$1" node -e "fetch('http://127.0.0.1:3100/login').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1
}

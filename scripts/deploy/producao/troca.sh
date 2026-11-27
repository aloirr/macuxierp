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

# trocar_servico <serviço> [conferência extra da réplica nova: função que recebe o id]
# 0 = a nova está no ar e a velha saiu; 1 = a nova não ficou saudável (foi removida; a velha segue no túnel).
trocar_servico() {
  local svc="$1" extra="${2:-}" velho novo="" id
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
  log "$svc: réplica nova ao lado da velha"
  dc up -d --no-deps --no-recreate --scale "$svc=2" "$svc" >/dev/null || true
  for id in $(ids_do_servico "$svc"); do
    [ "$id" = "$velho" ] || novo="$id"
  done
  if [ -z "$novo" ] || ! saudavel "$novo" || { [ -n "$extra" ] && ! "$extra" "$novo"; }; then
    echo "[implantar] $svc: a réplica nova não ficou saudável; ela sai e a velha continua no ar" >&2
    [ -n "$novo" ] && remover_replica "$novo" 0
    dc up -d --no-deps --no-recreate --scale "$svc=1" "$svc" >/dev/null 2>&1 || true
    return 1
  fi
  log "$svc: nova saudável; a velha sai do túnel e drena ${TROCA_DRENO_S} s"
  remover_replica "$velho"
  dc up -d --no-deps --no-recreate --scale "$svc=1" "$svc" >/dev/null
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

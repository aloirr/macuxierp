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

sair_do_tunel() { # id [dreno] → sai do túnel e drena (sleep)
  local dreno="${2:-$TROCA_DRENO_S}"
  docker network disconnect "$REDE_TUNEL" "$1" >/dev/null 2>&1 || true
  [ "$dreno" -gt 0 ] && sleep "$dreno"
  return 0
}

parar_replica() { # id → para (SIGTERM, até 30 s) e é removido
  docker stop -t 30 "$1" >/dev/null 2>&1 || true
  docker rm -f "$1" >/dev/null 2>&1 || true
}

remover_replica() { # id [dreno] → sai do túnel, drena, para e é removido
  sair_do_tunel "$1" "${2:-$TROCA_DRENO_S}"
  parar_replica "$1"
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
        h="$(date -u +%H:%M:%S)"
        : >"$TROCA_LACO_DIR/r"
        curl -s -o /dev/null -m "$TROCA_LACO_TIMEOUT_S" -w '%{http_code} %{time_total} %{time_connect} %{errormsg}' "$base/$p" >"$TROCA_LACO_DIR/r" 2>/dev/null &
        c=$!
        s=0
        wait "$c" || s=$?
        c=""
        r="$(cat "$TROCA_LACO_DIR/r" 2>/dev/null || true)"
        printf '%s %s %s\n' "$h" "$s" "${r:-000 0 0}" >>"$TROCA_LACO_DIR/${p//\//_}"
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

laco_resumo() { # arquivo rótulo → as linhas de diagnóstico e a do laço; 0 = passou (todas 200, ou 000 isolado com aviso)
  # Linha do arquivo: hora(UTC) saída_do_curl código tempo_total tempo_connect errormsg...
  # Regra (v0.3.25): 000 isolado (sem outro 000 logo antes ou depois na mesma URL) = aviso; 000 seguido, qualquer outro
  # código diferente de 200 ou nenhuma chamada = falha. Cada chamada diferente de 200 sai numa linha de diagnóstico com o
  # %{errormsg} do curl (curl sem a variável, ou mensagem vazia: a saída do curl). Carimbo em UTC, como o log().
  LC_ALL=C awk -v rot="$2" -v hora="$(date -u +%H:%M:%S)" '
    function ms(t) { gsub(",", ".", t); return int(t * 1000 + 0.5) }
    NF {
      n++; c = $3; cod[c]++; m = ms($4); if (m > max) max = m
      if (c == "000") { if (ant == "000") seguido = 1; n000++ } else if (c != "200") outro = 1
      ant = c
      if (c != "200") {
        msg = ""; for (i = 6; i <= NF; i++) msg = msg (i > 6 ? " " : "") $i
        if (msg == "" || msg ~ /%\{/) msg = "curl saída " $2
        diag[++nd] = sprintf("[implantar] %s laço %s: %s em %d ms (%s, connect %d ms)", $1, rot, c, m, msg, ms($5))
      }
    }
    END {
      for (i = 1; i <= nd; i++) print diag[i]
      k = 0; for (x in cod) chaves[++k] = x
      for (i = 2; i <= k; i++) { v = chaves[i]; j = i - 1; while (j > 0 && chaves[j] > v) { chaves[j + 1] = chaves[j]; j-- } chaves[j + 1] = v }
      lista = ""; for (i = 1; i <= k; i++) lista = lista (i > 1 ? ", " : "") chaves[i] ": " cod[chaves[i]]
      passou = (n > 0 && !outro && !seguido)
      aviso = (passou && n000 > 0) ? " (aviso: 000 isolado tolerado)" : ""
      printf "[implantar] %s laço %s durante a troca: %d chamadas, códigos {%s}, maior tempo %d ms%s\n", hora, rot, n, lista, max + 0, aviso
      exit passou ? 0 : 1
    }' "$1"
}

laco_encerrar() { # → as linhas do laço; 0 = as duas URLs passaram (laco_resumo). Espera ao menos uma medição de cada URL.
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

# ---------- dreno da réplica velha e conferência pela instância (v0.3.25; ADR 0003, adendo 48 A, "Dreno e conferência") ----------
# Toda resposta da api e do web da v0.3.25 em diante traz x-macuxierp-instancia (8 hex aleatórios da partida do processo;
# apps/api/src/dreno.ts e apps/web/dreno.cjs), e o SIGUSR2 põe a réplica em dreno (Connection: close e keep-alive ocioso
# fechado). A instância de cada réplica é lida de dentro do contêiner (docker exec pelo id do dc ps -q); a do domínio, pelo
# mesmo URL base do laço (/v1/saude para a api, /login para o web).
TROCA_USR2_S="${MACUXIERP_TROCA_USR2_S:-10}"         # dreno pedido: tempo mínimo antes do disconnect (além do TROCA_DRENO_S)
TROCA_USR2_MAX_S="${MACUXIERP_TROCA_USR2_MAX_S:-30}" # sem a nova vista até aqui: segue com aviso (a conferência decide)
TROCA_CONFERE_N="${MACUXIERP_TROCA_CONFERE_N:-5}"
TROCA_CONFERE_PASSO_S="${MACUXIERP_TROCA_CONFERE_PASSO_S:-0.5}"
TROCA_CABECALHO_INSTANCIA=x-macuxierp-instancia

caminho_do_servico() { # serviço → caminho público respondido por ele
  case "$1" in
    *api) printf 'v1/saude\n' ;;
    *) printf 'login\n' ;;
  esac
}

porta_do_servico() { # serviço → porta dentro do contêiner
  case "$1" in
    *api) printf '8100\n' ;;
    *) printf '3100\n' ;;
  esac
}

instancia_do_conteiner() { # serviço id → a instância da réplica (vazio = versão sem o cabeçalho ou sem resposta)
  local url
  url="http://127.0.0.1:$(porta_do_servico "$1")/$(caminho_do_servico "$1")"
  docker exec "$2" node -e "fetch('$url').then((r)=>process.stdout.write(r.headers.get('$TROCA_CABECALHO_INSTANCIA')||''),()=>process.exit(1))" 2>/dev/null |
    tr -dc '0-9a-zA-Z' || true
}

instancia_pelo_dominio() { # serviço → "<código http> <instância ou ->", por uma chamada ao domínio
  local url
  url="$(laco_url_base)/$(caminho_do_servico "$1")"
  curl -s -o /dev/null -D - -m "$TROCA_LACO_TIMEOUT_S" -w '\n%{http_code}\n' "$url" 2>/dev/null |
    LC_ALL=C awk -v cab="$TROCA_CABECALHO_INSTANCIA" '
      { sub(/\r$/, "") }
      index($0, ":") { k = tolower(substr($0, 1, index($0, ":") - 1)); if (k == cab) { v = substr($0, index($0, ":") + 1); gsub(/[^0-9A-Za-z]/, "", v); inst = v } }
      NF { ult = $0 }
      END { if (ult !~ /^[0-9][0-9][0-9]$/) ult = "000"; printf "%s %s\n", ult, (inst == "" ? "-" : inst) }'
}

da_nova() { # instância_lida velha nova → 0 = a resposta veio da réplica nova
  # nova sem o cabeçalho (volta atrás para versão sem dreno): conta como nova toda resposta que não for da velha
  if [ -n "$3" ]; then [ "$1" = "$3" ]; else [ "$1" != "$2" ]; fi
}

agora_ms() { # relógio em ms (EPOCHREALTIME do bash 5; sem ele, SECONDS)
  local t="${EPOCHREALTIME:-}"
  if [ -n "$t" ]; then t="${t/[.,]/}"; printf '%s\n' $((10#$t / 1000)); else printf '%s\n' $((SECONDS * 1000)); fi
}

esperar_nova() { # serviço velha nova → 0 = a nova foi vista pelo domínio e o prazo do dreno pedido passou
  local svc="$1" r inst vista=1 ini d
  ini="$(agora_ms)"
  while :; do
    r="$(instancia_pelo_dominio "$svc")"
    inst="${r#* }"
    if [ "${r%% *}" = 200 ] && { [ "$inst" != - ] || [ -z "$3" ]; } && da_nova "$inst" "$2" "$3"; then vista=0; fi
    d=$(($(agora_ms) - ini))
    [ "$vista" -eq 0 ] && [ "$d" -ge $((TROCA_USR2_S * 1000)) ] && return 0
    [ "$d" -ge $((TROCA_USR2_MAX_S * 1000)) ] && return 1
    sleep "$TROCA_CONFERE_PASSO_S"
  done
}

conferir_pelo_dominio() { # serviço velha nova → 0 = TROCA_CONFERE_N respostas seguidas, todas 200 e da nova
  local svc="$1" i=0 ok=0 velha=0 sem=0 r inst
  while [ "$i" -lt "$TROCA_CONFERE_N" ]; do
    [ "$i" -gt 0 ] && sleep "$TROCA_CONFERE_PASSO_S"
    i=$((i + 1))
    r="$(instancia_pelo_dominio "$svc")"
    inst="${r#* }"
    if [ "${r%% *}" != 200 ] || { [ "$inst" = - ] && [ -n "$3" ]; }; then
      sem=$((sem + 1))
    elif da_nova "$inst" "$2" "$3"; then
      ok=$((ok + 1))
    else
      velha=$((velha + 1))
    fi
  done
  log "$svc: conferência pelo domínio: $ok de $TROCA_CONFERE_N da nova (da velha: $velha; sem 200 ou sem cabeçalho: $sem)"
  [ "$ok" -eq "$TROCA_CONFERE_N" ]
}

# trocar_servico <serviço> [conferência extra da réplica nova: função que recebe o id]
# 0 = a nova está no ar, a velha saiu e o laço pelo domínio passou (só 200, ou 000 isolado com aviso); 1 = a nova não
# ficou saudável (foi removida; a velha segue no túnel), o laço falhou (000 seguido, ou código diferente de 200 e 000) ou
# a conferência pela instância viu a velha (ou resposta sem o cabeçalho) depois do disconnect: o implantar.sh volta atrás
# pelo mesmo caminho. Velha sem o cabeçalho (versão anterior à v0.3.25): sem SIGUSR2 nem conferência, como na v0.3.24.
trocar_servico() {
  local svc="$1" extra="${2:-}" velho novo="" id rc=0 inst_velha inst_nova
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
  inst_velha="$(instancia_do_conteiner "$svc" "$velho")"
  inst_nova="$(instancia_do_conteiner "$svc" "$novo")"
  if [ -n "$inst_velha" ]; then
    # dreno pedido antes do disconnect: Connection: close e keep-alive ocioso fechado, para o cloudflared refazer a conexão
    docker kill -s USR2 "$velho" >/dev/null 2>&1 || true
    log "$svc: dreno pedido à réplica velha (instância $inst_velha; nova ${inst_nova:-sem cabeçalho})"
    if esperar_nova "$svc" "$inst_velha" "$inst_nova"; then
      log "$svc: instância nova vista pelo domínio (${inst_nova:-sem cabeçalho}); dreno pedido há ${TROCA_USR2_S} s ou mais"
    else
      echo "[implantar] $svc: a instância nova não apareceu pelo domínio em ${TROCA_USR2_MAX_S} s; segue, e a conferência decide" >&2
    fi
  else
    echo "[implantar] $svc: aviso: a réplica velha não tem o cabeçalho $TROCA_CABECALHO_INSTANCIA (versão sem dreno); sem SIGUSR2, sem espera e sem conferência pela instância" >&2
  fi
  log "$svc: nova saudável; a velha sai do túnel e drena ${TROCA_DRENO_S} s"
  sair_do_tunel "$velho"
  if [ -n "$inst_velha" ] && ! conferir_pelo_dominio "$svc" "$inst_velha" "$inst_nova"; then
    echo "[implantar] $svc: a conferência pelo domínio viu a réplica velha ou resposta sem o cabeçalho depois do disconnect: volta atrás" >&2
    rc=1
  fi
  parar_replica "$velho"
  dc up -d --no-deps --no-recreate --scale "$svc=1" "$svc" >/dev/null || rc=1
  if ! laco_encerrar; then
    echo "[implantar] $svc: o laço pelo domínio falhou durante a troca (000 seguido ou código diferente de 200 e 000): volta atrás" >&2
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

/**
 * T-0057: `/entrada/v1` falsa, em memória, para os testes dos dublês e para os esqueletos de E3/E4 enquanto o plugin do
 * engenheiro não sai. Não substitui a API real: a prova de pronto de E2 a E4 roda contra o plugin montado por
 * `montarDependenciasProducao` (regra R-20261123-172506, item 3), pelo `alvoEntrada()` com `MACUXI_CENARIO_B_ALVO=real`.
 *
 * Implementa as respostas do engenheiro e do cadastros às premissas do plano (docs/testes/T-0057.md, P-1 a P-12):
 * - P-1/P-10: `Authorization: Bearer <chave>` + `X-Macuxi-Conector-Id`; JWT de usuário, Bearer inválido, chave de outro
 *   tenant e conector desconhecido dão o MESMO 401 neutro (`detalhes.codigo = 'credencial_invalida'`);
 * - P-2/P-4: o 202 é o `LoteAceito` do FDV; a `Idempotency-Key` é obrigatória (`^[A-Za-z0-9_.:-]{8,128}$`); mesma chave e
 *   mesmo corpo = o mesmo `LoteAceito` com `repetido: true` e o cabeçalho `idempotency-replayed`; outro corpo = 409
 *   `CONFLITO` com `detalhes.codigo = 'idempotencia_conflito'`;
 * - P-6: `POST /notas/:chave/retorno` com `{ situacao: 'gravada'|'rejeitada', codigo? }`, 200, idempotente pela chave;
 * - P-9: a trava vale acima de 30% e aparece em `LoteResultado.inativacao`, com `inativadas` 0 até a confirmação;
 * - P-10: 422 `entidade_fora_da_fase` e `entidade_dono_erp`;
 * - P-11: teto de 8 MiB (413);
 * - P-12: o processamento do lote é o `processar()` desta falsa, chamado só pelo `alvoEntrada()` (um ponto só).
 *
 * O log da falsa (`log`) imita o do Fastify só com método, rota, status e `conector_id` (nunca corpo nem cabeçalho), para o
 * caso E3-4 ter o mesmo formato de conferência nos dois alvos.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  CABECALHO_CONECTOR_ID,
  CAMINHOS_ENTRADA_V1,
  ENTIDADES_F2,
  FORMATO_IDEMPOTENCIA,
  MAX_BYTES_LOTE_ENTRADA,
  caminho,
  type EnvelopeLocal,
} from './conector-simulado';

/** Percentual acima do qual a carga completa não inativa sem confirmação (P-9: `> 30`). */
export const TRAVA_INATIVACAO_PERCENTUAL = 30;

export interface RetornoVisto {
  tenant: string;
  recurso: 'pedidos' | 'notas' | 'clientes';
  id: string;
  corpo: Record<string, unknown>;
}

export interface CredencialFalsa {
  tenant: string;
  conectorId: string;
  chave: string;
}

export interface PendentesFalsa {
  pedidos: Record<string, unknown>[];
  notas: Record<string, unknown>[];
  clientes: Record<string, unknown>[];
}

export interface LoteFalso {
  tenant: string;
  conectorId: string;
  chave: string;
  hash: string;
  envelope: EnvelopeLocal;
  aceito: Record<string, unknown>;
  status: 'recebido' | 'concluido';
  resultado: Record<string, unknown> | null;
}

export interface EntradaFalsa {
  fetch: typeof fetch;
  /** Lotes aceitos por `lote_id` (o corpo fica só aqui, em memória do teste). */
  readonly lotes: ReadonlyMap<string, LoteFalso>;
  /** Retornos aceitos que mudaram algo (a repetição idempotente não entra de novo). */
  readonly retornos: readonly RetornoVisto[];
  /** Todas as chamadas de retorno aceitas (com as repetições). */
  readonly chamadasRetorno: number;
  /** Pendentes do primeiro tenant (atalho dos testes do arnês). */
  readonly pendentes: PendentesFalsa;
  pendentesDe(tenant: string): PendentesFalsa;
  /** As próximas `n` chamadas de retorno respondem 503 (para provar a repetição). */
  falharRetornos(n: number): void;
  /** Dublê do `criarExecutorEntradaLote(deps)` (P-12): processa os lotes `recebido` em ordem de chegada. */
  processar(): number;
  /** Ativos por tenant e entidade depois do processamento. */
  ativos(tenant: string, entidade: string): string[];
  /** Troca a chave do conector do tenant: a anterior deixa de valer na hora (§4). */
  trocarChave(tenant: string, nova: string): void;
  /** Linhas de log (JSON), sem corpo nem cabeçalho. */
  readonly log: readonly string[];
}

export interface OpcoesEntradaFalsa {
  /** Atalho de um tenant só (`tenant: 'padrao'`). */
  chave?: string;
  conectorId?: string;
  credenciais?: CredencialFalsa[];
  /** Entidades com dono `erp` (§14): o lote delas é 422 `entidade_dono_erp`. */
  donoErp?: readonly string[];
  /** Forma da lista de pendentes (P-5, em aberto): `objeto` = `{ pedidos: [...] }`; `array` = a lista direta. */
  formaPendentes?: 'objeto' | 'array';
}

const json = (status: number, corpo: unknown, extras: Record<string, string> = {}) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json', ...extras },
  });

const erro = (status: number, codigo: string, mensagem: string, detalhe?: string) =>
  json(status, { codigo, mensagem, ...(detalhe ? { detalhes: { codigo: detalhe } } : {}) });

/** O 401 neutro (P-10): o mesmo corpo para JWT, chave errada, chave de outro tenant e conector desconhecido. */
const recusa401 = () => erro(401, 'NAO_AUTENTICADO', 'Credencial inválida.', 'credencial_invalida');

const CAMPO_ID = { pedidos: 'pedido_uuid', notas: 'chave', clientes: 'cliente_uuid' } as const;

export function criarEntradaFalsa(o: OpcoesEntradaFalsa): EntradaFalsa {
  const credenciais: CredencialFalsa[] = [
    ...(o.chave && o.conectorId ? [{ tenant: 'padrao', conectorId: o.conectorId, chave: o.chave }] : []),
    ...(o.credenciais ?? []),
  ];
  if (!credenciais.length) throw new Error('entrada falsa: sem credencial.');
  const p = CAMINHOS_ENTRADA_V1.prefixo;
  const donoErp = new Set(o.donoErp ?? []);
  const porChave = new Map<string, string>(); // `${tenant}|${idempotency-key}` → lote_id
  const lotes = new Map<string, LoteFalso>();
  const retornos: RetornoVisto[] = [];
  const vistosRetorno = new Set<string>();
  const pendentes = new Map<string, PendentesFalsa>();
  const ativos = new Map<string, Set<string>>(); // `${tenant}|${entidade}`
  const log: string[] = [];
  let chamadasRetorno = 0;
  let falhas = 0;

  const pendentesDe = (tenant: string) => {
    let x = pendentes.get(tenant);
    if (!x) pendentes.set(tenant, (x = { pedidos: [], notas: [], clientes: [] }));
    return x;
  };
  for (const c of credenciais) pendentesDe(c.tenant);

  function autenticar(cab: Headers): CredencialFalsa | null {
    const auth = cab.get('authorization') ?? '';
    const id = cab.get(CABECALHO_CONECTOR_ID);
    const c = credenciais.find((x) => x.conectorId === id);
    // compara sempre (mesmo sem conector), para o desconhecido e a chave errada terem o mesmo caminho
    const ok = c !== undefined && auth === `Bearer ${c.chave}`;
    return ok ? c : null;
  }

  function processar(): number {
    let n = 0;
    for (const [lote_id, l] of lotes) {
      if (l.status !== 'recebido') continue;
      n++;
      const e = l.envelope;
      const chaveAtivos = `${l.tenant}|${e.entidade}`;
      const set = ativos.get(chaveAtivos) ?? new Set<string>();
      ativos.set(chaveAtivos, set);
      let novas = 0;
      let atualizadas = 0;
      for (const r of e.registros) {
        if (set.has(r.external_id)) atualizadas++;
        else novas++;
        if (r.ativo) set.add(r.external_id);
        else set.delete(r.external_id);
      }
      let inativacao: Record<string, unknown> | null = null;
      let inativadas = 0;
      if (e.modo === 'completo' && e.sessao?.ultimo) {
        const daSessao = new Set(
          [...lotes.values()]
            .filter((x) => x.tenant === l.tenant && x.envelope.sessao?.id === e.sessao!.id)
            .flatMap((x) => x.envelope.registros.map((r) => r.external_id)),
        );
        const base = set.size; // ativos antes de inativar
        const candidatos = [...set].filter((id) => !daSessao.has(id));
        const percentual = base === 0 ? 0 : (100 * candidatos.length) / base;
        if (candidatos.length === 0) inativacao = { situacao: 'nao_aplicavel', candidatos: 0, percentual: 0 };
        else if (percentual > TRAVA_INATIVACAO_PERCENTUAL)
          inativacao = { situacao: 'aguardando_confirmacao', candidatos: candidatos.length, percentual };
        else {
          for (const id of candidatos) set.delete(id);
          inativadas = candidatos.length;
          inativacao = { situacao: 'aplicada', candidatos: candidatos.length, percentual };
        }
      }
      const ultimo = e.registros.at(-1);
      l.status = 'concluido';
      l.resultado = {
        lote_id,
        entidade: e.entidade,
        modo: e.modo,
        status: 'concluido',
        contagens: {
          recebidas: e.registros.length,
          duplicadas_no_lote: 0,
          com_erro: e.linhas_invalidas.length,
          novas,
          atualizadas,
          inalteradas: 0,
          obsoletas: 0,
        },
        erros: [],
        avisos: [],
        cursor: ultimo ? { alterado_em: ultimo.alterado_em, external_id: ultimo.external_id } : null,
        inativacao,
        inativadas,
        recebido_em: e.enviado_em,
        concluido_em: e.enviado_em,
      };
    }
    return n;
  }

  async function atender(url: URL, metodo: string, cab: Headers, corpo: string): Promise<Response> {
    const rota = url.pathname.startsWith(p) ? url.pathname.slice(p.length) : null;
    if (rota === null) return erro(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
    const cred = autenticar(cab);
    if (!cred) return recusa401();
    const pend = pendentesDe(cred.tenant);

    if (metodo === 'POST' && rota === CAMINHOS_ENTRADA_V1.lotes) {
      if (Buffer.byteLength(corpo) > MAX_BYTES_LOTE_ENTRADA)
        return erro(413, 'CORPO_GRANDE', 'Lote acima do teto.', 'lote_grande');
      const chave = cab.get('idempotency-key');
      if (!chave || !FORMATO_IDEMPOTENCIA.test(chave))
        return erro(400, 'VALIDACAO', 'Idempotency-Key ausente ou fora do padrão.', 'idempotencia_invalida');
      let envelope: EnvelopeLocal;
      try {
        envelope = JSON.parse(corpo) as EnvelopeLocal;
      } catch {
        return erro(400, 'VALIDACAO', 'Corpo inválido.');
      }
      if (!(ENTIDADES_F2 as readonly string[]).includes(envelope.entidade))
        return erro(422, 'REGRA', 'Entidade fora da fase.', 'entidade_fora_da_fase');
      if (donoErp.has(envelope.entidade))
        return erro(422, 'REGRA', 'A entidade é mantida no ERP.', 'entidade_dono_erp');
      const hash = createHash('sha256').update(corpo).digest('hex');
      const jaId = porChave.get(`${cred.tenant}|${chave}`);
      if (jaId) {
        const ja = lotes.get(jaId)!;
        if (ja.hash !== hash)
          return erro(409, 'CONFLITO', 'Idempotency-Key já usada com outro corpo.', 'idempotencia_conflito');
        return json(202, { ...ja.aceito, repetido: true }, { 'idempotency-replayed': 'true' });
      }
      const lote_id = randomUUID();
      const aceito = {
        lote_id,
        status: 'recebido',
        entidade: envelope.entidade,
        modo: envelope.modo,
        // `recebidos` = registros + inválidas + omitidas, sempre >= 1 (LoteAceito do FDV)
        recebidos: Math.max(
          1,
          envelope.registros.length + envelope.linhas_invalidas.length + envelope.linhas_invalidas_omitidas,
        ),
        repetido: false,
        consulta: p + caminho(CAMINHOS_ENTRADA_V1.lote, { id: lote_id }),
      };
      porChave.set(`${cred.tenant}|${chave}`, lote_id);
      lotes.set(lote_id, {
        tenant: cred.tenant,
        conectorId: cred.conectorId,
        chave,
        hash,
        envelope,
        aceito,
        status: 'recebido',
        resultado: null,
      });
      return json(202, aceito);
    }

    const mLote = /^\/lotes\/([^/]+)$/.exec(rota);
    if (metodo === 'GET' && mLote) {
      const l = lotes.get(decodeURIComponent(mLote[1]!));
      // lote de outro tenant ou conector = 404 (não diz que existe)
      if (!l || l.tenant !== cred.tenant || l.conectorId !== cred.conectorId)
        return erro(404, 'NAO_ENCONTRADO', 'Lote não encontrado.');
      return json(200, l.resultado ?? { ...l.aceito, status: 'recebido' });
    }

    const m = /^\/(pedidos|notas|clientes)\/(pendentes|([^/]+)\/retorno)$/.exec(rota);
    if (m) {
      const recurso = m[1] as RetornoVisto['recurso'];
      if (metodo === 'GET' && m[2] === 'pendentes')
        return json(200, o.formaPendentes === 'array' ? pend[recurso] : { [recurso]: pend[recurso] });
      if (metodo === 'POST' && m[3]) {
        if (falhas > 0) {
          falhas--;
          return erro(503, 'INDISPONIVEL', 'Tente de novo.');
        }
        const id = decodeURIComponent(m[3]);
        const dados = JSON.parse(corpo) as Record<string, unknown>;
        if (recurso === 'notas' && !['gravada', 'rejeitada'].includes(String(dados.situacao)))
          return erro(400, 'VALIDACAO', 'situacao: gravada ou rejeitada.');
        chamadasRetorno++;
        // idempotente: a nota pela chave (P-6); o pedido por uuid + status
        const chaveVisto =
          recurso === 'notas' ? `${cred.tenant}|notas|${id}` : `${cred.tenant}|${recurso}|${id}|${String(dados.status)}`;
        if (!vistosRetorno.has(chaveVisto)) {
          vistosRetorno.add(chaveVisto);
          retornos.push({ tenant: cred.tenant, recurso, id, corpo: dados });
        }
        // o pendente sai da fila só quando o retorno é aceito
        if (recurso !== 'clientes' || dados.status === 'vinculado')
          pend[recurso] = pend[recurso].filter((x) => x[CAMPO_ID[recurso]] !== id);
        return json(200, { aceito: true });
      }
    }
    return erro(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
  }

  return {
    lotes,
    retornos,
    get chamadasRetorno() {
      return chamadasRetorno;
    },
    get pendentes() {
      return pendentesDe(credenciais[0]!.tenant);
    },
    pendentesDe,
    falharRetornos: (n) => void (falhas = n),
    processar,
    ativos: (tenant, entidade) => [...(ativos.get(`${tenant}|${entidade}`) ?? [])].sort(),
    trocarChave(tenant, nova) {
      const c = credenciais.find((x) => x.tenant === tenant);
      if (!c) throw new Error('entrada falsa: tenant sem credencial.');
      c.chave = nova;
    },
    log,
    fetch: async (entrada, init) => {
      const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
      const metodo = init?.method ?? 'GET';
      const cab = new Headers(init?.headers);
      const corpo = typeof init?.body === 'string' ? init.body : '';
      const r = await atender(url, metodo, cab, corpo);
      log.push(
        JSON.stringify({
          level: 30,
          req: { method: metodo, url: url.pathname },
          res: { statusCode: r.status },
          conector_id: cab.get(CABECALHO_CONECTOR_ID),
        }),
      );
      return r;
    },
  };
}

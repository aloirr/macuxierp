/**
 * T-0012: emissor mínimo do contrato do Hub, SÓ do arnês (adaptador `emissor-minimo` da porta `LadoErp`). Não é o
 * conector do ERP: serve para separar defeito do ERP de defeito do arnês e para mandar ao Hub o que o ERP nunca manda
 * (ex.: um lote de 5.001 sem dividir). Faz o mínimo que o contrato exige:
 *  - cabeçalhos `Authorization`, `X-Macuxi-Conector-Id`, `X-Macuxi-Conector-Versao: 1.4.0` e
 *    `User-Agent: macuxierp/<versão do ERP>` (P-2, opção A);
 *  - registros em ordem (`alterado_em`, `external_id` binário), lotes de até `limiteRegistros`; carga completa numa
 *    sessão com partes; `Idempotency-Key` pelo conteúdo e pela geração;
 *  - espera o `Retry-After` exato, com teto de 1 h (sem ele, 1 s, 2 s, 4 s…);
 *  - lê o corpo da resposta até 4 MiB; acima disso, descarta e responde `resposta_grande` (como o SDK).
 * As contas são escritas aqui de propósito, sem importar o SDK nem o domain: o emissor é oráculo independente (RD-0221).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { CredencialHub } from './config';
import { exigirLeitura, guardarFetch, travaAtiva } from './trava-escrita';
import {
  emFatias,
  LIMITE_REGISTROS_LOTE,
  VERSAO_CONECTOR,
  VERSAO_CONTRATO,
  type EnvelopeLote,
  type RegistroHub,
} from './contrato-hub';
import {
  criarLadoErp,
  type LadoErp,
  type LoteParaEnviar,
  type Montador,
  type OpcoesLado,
  type RespostaTransporte,
  type Transporte,
} from './lado-erp';

export interface OpcoesEmissor extends OpcoesLado {
  /** Base com `/integracao/v1`. */
  url: string;
  credencial: CredencialHub;
  versaoErp: string;
  limiteRegistros?: number;
}

function codigoDe(corpo: unknown): string | null {
  const c = (corpo as { codigo?: unknown } | null)?.codigo;
  return typeof c === 'string' && /^[a-z0-9_]{1,64}$/.test(c) ? c : null;
}

/** Teto do `Retry-After` (1 h): um valor maior do Hub não prende o arnês por horas. */
export const RETRY_AFTER_TETO_MS = 60 * 60 * 1000;
/** Maior corpo de resposta lido do Hub (4 MiB). */
export const LIMITE_RESPOSTA_BYTES = 4 * 1024 * 1024;

/** `Retry-After` em segundos ou data HTTP → ms, de 0 a `RETRY_AFTER_TETO_MS`. Ausente ou ilegível → null. */
export function retryAfterMs(valor: string | null, agoraMs: number): number | null {
  if (!valor) return null;
  const v = valor.trim();
  if (/^\d+$/.test(v)) return Math.min(RETRY_AFTER_TETO_MS, Number(v) * 1000);
  const d = Date.parse(v);
  return Number.isNaN(d) ? null : Math.min(RETRY_AFTER_TETO_MS, Math.max(0, d - agoraMs));
}

/** Corpo como texto até `limite` bytes (pelo `content-length` declarado e contando o fluxo); acima → null. */
async function lerCorpoLimitado(r: Response, limite: number): Promise<string | null> {
  const declarado = r.headers.get('content-length')?.trim();
  if (declarado && /^\d+$/.test(declarado) && Number(declarado) > limite) {
    await r.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!r.body) return '';
  const leitor = r.body.getReader();
  const pedacos: Uint8Array[] = [];
  let lidos = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    lidos += value.byteLength;
    if (lidos > limite) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    pedacos.push(value);
  }
  return Buffer.concat(pedacos).toString('utf8');
}

export function transporteFetch(
  o: Pick<OpcoesEmissor, 'url' | 'credencial' | 'versaoErp' | 'relogio'>,
): Transporte {
  // trava de escrita (R-20261122-020834), no pedido e no `fetch`: fora do dublê local, sem a escrita liberada ou com
  // o Conector macuxierp
  const travado = travaAtiva(o.url, o.credencial);
  const buscar: typeof fetch = travado ? guardarFetch() : (entrada, init) => fetch(entrada, init);
  return {
    async chamar(metodo, caminho, corpo, chave): Promise<RespostaTransporte> {
      if (travado) exigirLeitura(metodo, caminho);
      const headers: Record<string, string> = {
        Authorization: o.credencial.autorizacao(),
        'X-Macuxi-Conector-Id': o.credencial.conectorId,
        'X-Macuxi-Conector-Versao': VERSAO_CONECTOR,
        'User-Agent': `macuxierp/${o.versaoErp}`,
        Accept: 'application/json',
      };
      if (corpo !== undefined) headers['Content-Type'] = 'application/json';
      if (chave) headers['Idempotency-Key'] = chave;
      let r: Response;
      try {
        r = await buscar(`${o.url}${caminho}`, {
          method: metodo,
          headers,
          body: corpo === undefined ? undefined : JSON.stringify(corpo),
          redirect: 'manual',
        });
      } catch {
        // erro de rede: a mensagem do fetch não sai daqui (pode citar URL)
        return { tipo: 'retentar', status: null, codigo: 'rede', retryAfterMs: null };
      }
      const retentavel = r.status === 429 || r.status >= 500;
      const espera = () => retryAfterMs(r.headers.get('retry-after'), o.relogio.agora().getTime());
      const texto = await lerCorpoLimitado(r, LIMITE_RESPOSTA_BYTES);
      if (texto === null)
        return retentavel
          ? { tipo: 'retentar', status: r.status, codigo: 'resposta_grande', retryAfterMs: espera() }
          : { tipo: 'recusa', status: r.status, codigo: 'resposta_grande' };
      let json: unknown = null;
      try {
        json = texto ? (JSON.parse(texto) as unknown) : null;
      } catch {
        json = null;
      }
      if (r.status >= 200 && r.status < 300)
        return {
          tipo: 'ok',
          status: r.status,
          corpo: json,
          replay: r.headers.get('idempotent-replay')?.toLowerCase() === 'true',
        };
      if (retentavel)
        return { tipo: 'retentar', status: r.status, codigo: codigoDe(json), retryAfterMs: espera() };
      if (r.status === 426)
        return { tipo: 'pausar_entidade', status: r.status, codigo: codigoDe(json), motivo: 'versao' };
      if (r.status === 422 && codigoDe(json) === 'entidade_de_outro_conector')
        return {
          tipo: 'pausar_entidade',
          status: r.status,
          codigo: 'entidade_de_outro_conector',
          motivo: 'topologia',
        };
      return { tipo: 'recusa', status: r.status, codigo: codigoDe(json) };
    },
  };
}

function montadorMinimo(o: Pick<OpcoesEmissor, 'credencial' | 'limiteRegistros'>): Montador {
  const limite = o.limiteRegistros ?? LIMITE_REGISTROS_LOTE;
  return {
    esperaMs: (n, ra) => ra ?? 1000 * 2 ** (n - 1),
    montar(e, enviadoEm): LoteParaEnviar[] {
      const ordenados = [...e.registros].sort((a, b) => {
        const dt = Date.parse(a.alterado_em) - Date.parse(b.alterado_em);
        return dt !== 0 ? dt : Buffer.compare(Buffer.from(a.external_id), Buffer.from(b.external_id));
      });
      const partes: RegistroHub[][] = emFatias(ordenados, limite);
      const sessaoId = e.modo === 'completo' ? randomUUID() : null;
      return partes.map((registros, i) => {
        const sessao = sessaoId ? { id: sessaoId, parte: i + 1, ultimo: i === partes.length - 1 } : null;
        const ultimo = registros[registros.length - 1]!;
        const corpo: EnvelopeLote = {
          versao_contrato: VERSAO_CONTRATO,
          entidade: e.entidade,
          modo: e.modo,
          enviado_em: enviadoEm,
          cursor: { alterado_em: ultimo.alterado_em, external_id: ultimo.external_id },
          ...(sessao ? { sessao } : {}),
          conector_id: o.credencial.conectorId,
          versao_conector: VERSAO_CONECTOR,
          registros,
          linhas_invalidas: [],
          linhas_invalidas_omitidas: 0,
        };
        const chave = createHash('sha256')
          .update(
            JSON.stringify({
              entidade: e.entidade,
              modo: e.modo,
              sessao,
              registros,
              geracao: e.geracao ?? 1,
            }),
          )
          .digest('hex');
        return {
          parte: sessao?.parte ?? null,
          ultimo: sessao?.ultimo ?? null,
          registros: registros.length,
          chave,
          corpo,
        };
      });
    },
  };
}

export function criarEmissorMinimo(o: OpcoesEmissor): LadoErp {
  return criarLadoErp('emissor-minimo', montadorMinimo(o), transporteFetch(o), o);
}

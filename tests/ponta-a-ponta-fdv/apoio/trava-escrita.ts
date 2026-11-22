/**
 * T-0012/T-0017: trava de escrita no Hub REAL (recado R-20261122-020834-gerente-projetos, 22/11/2026 02h08 de Manaus).
 * O Alexandre ativou todos os módulos no Conector `macuxierp`: fica proibida qualquer escrita no Hub real com essa chave
 * (`POST /lotes`, `GET /pedidos/pendentes`, que marca o pedido como enviado, e qualquer retorno) até o ERP estar em
 * produção, a carga conferida e o ok do PO. Os testes rodam só contra o dublê; só a leitura de cursor é permitida.
 *
 * Duas barreiras:
 *  1. configuração (`config.ts`): com o alvo real, a escrita só sai liberada com `MACUXI_HUB_LIBERA_ESCRITA=1` E um perfil
 *     que NÃO seja o da chave macuxierp (`thathyany-seguro` ou qualquer perfil com o Conector `macuxierp`); o
 *     `exigirCenario` recusa todo cenário que escreve;
 *  2. transporte (aqui): com a trava ativa (`travaAtiva`: fora do dublê local, sem a escrita liberada na credencial ou
 *     com o Conector `macuxierp`), todo `fetch` passa por `guardarFetch`, que recusa, antes de qualquer rede, tudo o que
 *     não for `GET /cursores/{entidade}` (`LEITURAS_PERMITIDAS`). O cliente do SDK e o emissor mínimo também conferem
 *     antes de chamar (`exigirLeitura`), para o erro chegar ao teste (o SDK e o emissor transformam erro de `fetch` em
 *     "rede").
 * O dublê (http://127.0.0.1:<porta>, em processo) não tem restrição nenhuma.
 */
import { ORDEM_CARGA_HUB } from './contrato-hub';

export const RECADO_TRAVA_ESCRITA = 'R-20261122-020834-gerente-projetos';
const QUANDO_TRAVA = '22/11/2026 02h08 de Manaus';
/** Começo de toda mensagem de recusa da trava (transporte e `exigirCenario`). */
export const PREFIXO_TRAVA = `Recusado pela trava de escrita no Hub real (recado ${RECADO_TRAVA_ESCRITA}, ${QUANDO_TRAVA})`;

export class ErroTravaEscrita extends Error {
  override readonly name = 'ErroTravaEscrita';
}

/** Por que a escrita está travada numa configuração do alvo real (`null` = liberada). */
export type MotivoTravaEscrita = 'sem-libera-escrita' | 'chave-macuxierp';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Lista FECHADA do que passa no Hub real com a escrita travada: só a leitura de cursor. O resto (qualquer POST, PUT,
 * PATCH, DELETE, HEAD, o `GET /pedidos/pendentes`, qualquer rota de lote, rota desconhecida, consulta) é recusado.
 */
export const LEITURAS_PERMITIDAS: readonly {
  metodo: 'GET';
  rota: string;
  padrao: RegExp;
  consulta: Readonly<Record<string, RegExp>>;
}[] = [
  {
    metodo: 'GET',
    rota: '/cursores/{entidade}',
    padrao: new RegExp(`^/cursores/(?:${ORDEM_CARGA_HUB.join('|')})$`),
    consulta: {},
  },
];

/** Caminho sem identificador (uuid vira `:id`), para a mensagem não citar pedido nem lote. */
const rotaSemId = (caminho: string) =>
  caminho
    .replace(new RegExp(UUID, 'gi'), ':id')
    .replace(/[?#].*$/, '')
    .slice(0, 80);

/** `caminho` relativo a `/integracao/v1`, com a consulta opcional (`/cursores/filial`; hoje nenhuma consulta passa). */
export function ehLeituraPermitida(metodo: string, caminho: string): boolean {
  if (!caminho.startsWith('/') || caminho.includes('%') || caminho.includes('#')) return false;
  const [rota = '', consulta = ''] = caminho.split('?', 2);
  if (caminho.split('?').length > 2) return false;
  const leitura = LEITURAS_PERMITIDAS.find(
    (l) => l.metodo === metodo.toUpperCase() && l.padrao.test(rota),
  );
  if (!leitura) return false;
  const params = new URLSearchParams(consulta);
  const vistos = new Set<string>();
  for (const [nome, valor] of params) {
    const regra = leitura.consulta[nome];
    if (!regra || vistos.has(nome) || !regra.test(valor)) return false;
    vistos.add(nome);
  }
  return true;
}

function mensagemTrava(metodo: string, caminho: string): string {
  return (
    `${PREFIXO_TRAVA}: ` +
    `${metodo.toUpperCase()} ${rotaSemId(caminho)} não é leitura de cursor. ` +
    'Só GET /cursores/{entidade} passa; a escrita só com MACUXI_HUB_LIBERA_ESCRITA=1 ' +
    'e fora da chave do Conector macuxierp.'
  );
}

/** Lança `ErroTravaEscrita` se o pedido não estiver na lista fechada de leitura. */
export function exigirLeitura(metodo: string, caminho: string): void {
  if (!ehLeituraPermitida(metodo, caminho)) throw new ErroTravaEscrita(mensagemTrava(metodo, caminho));
}

/** O dublê do arnês roda em processo, em `http://127.0.0.1:<porta>`; todo o resto é tratado como Hub real. */
export function ehDubleLocal(url: string): boolean {
  return /^http:\/\/127\.0\.0\.1:\d+(?:\/|$)/.test(url);
}

/** "Da chave macuxierp": o perfil thathyany-seguro ou qualquer Conector `macuxierp` (sem maiúsculas nem espaços). */
export function ehChaveMacuxierp(perfil: string, conectorId: string): boolean {
  return perfil === 'thathyany-seguro' || conectorId.replace(/\s+/g, '').toLowerCase() === 'macuxierp';
}

/**
 * A trava vale neste transporte? Fora do dublê local, sempre que a credencial não trouxer a escrita liberada e, como
 * defesa em profundidade (mesmo liberada), quando o Conector for o `macuxierp`.
 */
export function travaAtiva(url: string, credencial: { readonly conectorId: string; readonly escritaLiberada: boolean }): boolean {
  return !ehDubleLocal(url) && (!credencial.escritaLiberada || ehChaveMacuxierp('', credencial.conectorId));
}

/** Motivo da trava (ou `null`, liberada) para o alvo real. */
export function motivoTravaEscrita(
  libera: string | undefined,
  perfil: string,
  conectorId: string,
): MotivoTravaEscrita | null {
  if (ehChaveMacuxierp(perfil, conectorId)) return 'chave-macuxierp';
  if (libera !== '1') return 'sem-libera-escrita';
  return null;
}

/**
 * Guarda do `fetch` do alvo real: confere método e caminho (relativo a `/integracao/v1`) contra a lista fechada de
 * leitura e lança `ErroTravaEscrita` ANTES de chamar o `fetch` de baixo. GET com corpo também é recusado.
 */
export function guardarFetch(
  base: typeof fetch = (entrada, init) => globalThis.fetch(entrada, init),
): typeof fetch {
  return (entrada: string | URL | Request, init?: RequestInit) => {
    const ehPedido = typeof Request !== 'undefined' && entrada instanceof Request;
    const metodo = (init?.method ?? (ehPedido ? entrada.method : 'GET')).toUpperCase();
    const bruta = ehPedido ? entrada.url : String(entrada);
    let caminho = '';
    try {
      const u = new URL(bruta);
      const i = u.pathname.indexOf('/integracao/v1/');
      caminho = i === -1 ? u.pathname : `${u.pathname.slice(i + '/integracao/v1'.length)}${u.search}`;
      if (i === -1 || u.hash) caminho = `#fora-do-hub${caminho}`;
    } catch {
      caminho = '#url-invalida';
    }
    const temCorpo = (init?.body !== undefined && init.body !== null) || (ehPedido && entrada.body !== null);
    if (temCorpo || !ehLeituraPermitida(metodo, caminho))
      return Promise.reject(new ErroTravaEscrita(mensagemTrava(metodo, caminho)));
    return base(entrada, init);
  };
}

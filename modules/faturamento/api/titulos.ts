/**
 * Títulos a receber (RF-FAT-07, RN-FAT-06): geração na autorização da nota (mesma transação do `nota.autorizada@1`), cancelamento com a nota, baixa e estorno.
 * As regras são do `domain/titulos.ts`; aqui só a orquestração sobre as portas. Sem dado pessoal em log. Ver docs/modulos/faturamento/titulos.md.
 */
import { classeForma } from '@macuxierp/cadastros/contracts';
import { erros, type Transacao } from '@macuxierp/platform-sdk';
import { TituloBaixadoPayload, TituloGeradoPayload, type BaixarTituloEntrada, type BaixaTituloResumo, type TituloResumo } from '../contracts';
import { baixar, cancelarTitulosDaNota, contaComoReal, dataCivilManaus, ErroViolacao, estornarBaixa, gerarParcelas, payloadTituloBaixado, payloadTituloGerado, prazosDaNota, violacao, type ConteudoNota, type NotaParaTitulos } from '../domain';
import type { NotaRegistro, RepositorioNotas, RepositorioTitulos } from './portas';
import { erroDeViolacoes } from './util';

export const EVENTO_TITULO_GERADO = 'faturamento.titulo.gerado@1' as const;
export const EVENTO_TITULO_BAIXADO = 'faturamento.titulo.baixado@1' as const;

export interface DepsTitulos {
  titulos: RepositorioTitulos;
  notas: Pick<RepositorioNotas, 'lerConteudo' | 'publicarEvento' | 'obter'>;
}

/** Log sem dado pessoal (só ids, códigos e motivos de regra): a divergência de título com baixa e a geração pendente não podem sumir. */
export type LogFaturamento = (e: { evento: string; tenant_id?: string; nota_id?: string; titulos_divergentes?: number; motivo?: string }) => void;

/**
 * `conta_como_real` da nota: o valor calculado na EMISSÃO (bandeira da filial E homologação) e guardado no conteúdo (`nota.pagamento`); a nota autorizada não muda
 * mais (0013), então todos os eventos leem este valor e não a bandeira de agora (RN-FAT-04). Nota sem o campo (antiga) = false. Em produção, sempre false.
 */
export const contaComoRealDaNota = (conteudo: Pick<ConteudoNota, 'conta_como_real'> | null, nota: Pick<NotaRegistro, 'ambiente'>): boolean =>
  contaComoReal(nota.ambiente, conteudo?.conta_como_real === true);

/** Trata a violação do domain como 422 da API (um lugar só). */
function comoErroDaApi<T>(fn: () => T): T {
  try {
    return fn();
  } catch (x) {
    if (x instanceof ErroViolacao) throw erroDeViolacoes(x.violacoes);
    throw x;
  }
}

const paraDomain = (n: NotaRegistro, status = n.status): NotaParaTitulos => ({
  id: n.id, pedido_id: n.pedido_id, cliente_id: n.cliente_id, ambiente: n.ambiente, numero: n.numero, serie: n.serie, total_centavos: n.total_centavos, emissao: new Date(n.emitida_em), status,
});

/**
 * Chamada logo depois do `nota.autorizada@1`, na MESMA tx. Só o boleto gera título (uma parcela por prazo da condição gravada na nota); cartão, à vista e
 * forma desconhecida não geram. Idempotente: parcela já gravada não é regravada nem republicada. Publica um `titulo.gerado@1` por parcela (agregado = `titulo.id`).
 */
export async function gerarTitulosDaNota(tx: Transacao, deps: DepsTitulos, nota: NotaRegistro): Promise<TituloResumo[]> {
  const conteudo = await deps.notas.lerConteudo(tx, nota.id);
  if (!conteudo) return [];
  const tpag = conteudo.pagamentos[0]?.tPag;
  const classe = tpag ? classeForma(tpag) : null;
  if (classe !== 'boleto') return [];
  const dominio = paraDomain(nota, 'autorizada');
  const comoReal = contaComoRealDaNota(conteudo, nota);
  const parcelas = gerarParcelas(dominio, { prazos_dias: prazosDaNota(conteudo.prazos_dias, conteudo.cobranca, dominio.emissao) }, classe);
  const novos = await deps.titulos.inserirParcelas(tx, { id: nota.id, filial_id: nota.filial_id, cliente_id: nota.cliente_id, conta_como_real: comoReal }, parcelas);
  for (const t of novos) {
    const payload = TituloGeradoPayload.parse(payloadTituloGerado(dominio, t, comoReal));
    await deps.notas.publicarEvento(tx, { nome: EVENTO_TITULO_GERADO, agregado_id: t.id, payload });
  }
  return novos;
}

const motivoDaFalha = (e: unknown): string => {
  if (e instanceof ErroViolacao) return e.violacoes.map((v) => `${v.rn}@${v.campo}: ${v.mensagem}`).join('; ').slice(0, 255);
  const codigo = (e as { code?: unknown } | null)?.code;
  return `falha_inesperada${typeof codigo === 'string' ? ` (${codigo})` : e instanceof Error ? ` (${e.name})` : ''}`;
};

/**
 * RN-FAT-03: a geração roda num SAVEPOINT depois da guarda do nfeProc. Qualquer falha (prazos vazios, total menor que as parcelas, tabela inexistente...) desfaz só
 * a geração, registra a pendência (log sem dado pessoal e `motivo` no resultado) e a nota segue autorizada com o nfeProc guardado. A varredura gera depois.
 */
export async function gerarTitulosSeguro(tx: Transacao, deps: DepsTitulos, nota: NotaRegistro, log: LogFaturamento): Promise<{ ok: true; titulos: TituloResumo[] } | { ok: false; motivo: string }> {
  const r = await deps.titulos.emSavepoint(tx, () => gerarTitulosDaNota(tx, deps, nota));
  if (r.ok) return { ok: true, titulos: r.valor };
  const motivo = motivoDaFalha(r.erro);
  log({ evento: 'faturamento.titulo.geracao_pendente', tenant_id: nota.tenant_id, nota_id: nota.id, motivo });
  return { ok: false, motivo };
}

export interface ResultadoVarreduraTitulos {
  verificadas: number;
  geradas: number;
  pendentes: number;
  /** Notas que atingiram o teto de tentativas nesta varredura (saem dela; ficam no log para o suporte). */
  desistidas: number;
}

/** Teto padrão de tentativas de geração por nota na varredura. */
export const MAX_TENTATIVAS_GERACAO_TITULOS = 5;

/**
 * Varredura (worker, por tenant): as notas autorizadas de boleto, sem título, autorizadas há ao menos `ha_minutos`, geram os títulos de novo. Idempotente pelo
 * `titulo_parcela_uq` (parcela existente não é regravada nem republicada). Cada nota tem o próprio savepoint: uma falha não impede as outras.
 * RN-FAT-03: as mais antigas na última tentativa vêm primeiro (nunca tentadas, antes de todas) e, no teto de tentativas (`max_tentativas`, padrão 5), a nota sai
 * da varredura com `faturamento.titulo.geracao_desistida` no log. O controle é da instância (memória do worker): a nota autorizada não aceita mais gravação
 * (0013: só status, updated_at e cancelada_em mudam), então um contador persistente pede coluna ou tabela própria (pedido ao banco-dados); reiniciar o worker o zera.
 */
export function criarVarreduraTitulos(deps: DepsTitulos & { log: LogFaturamento }, config: { max_tentativas?: number } = {}) {
  const max = config.max_tentativas ?? MAX_TENTATIVAS_GERACAO_TITULOS;
  const controle = new Map<string, { tentativas: number; ordem: number }>();
  let relogio = 0;
  return async function varrer(tx: Transacao, opcoes: { ha_minutos: number; limite?: number }): Promise<ResultadoVarreduraTitulos> {
    const desistidas = [...controle].filter(([, c]) => c.tentativas >= max).map(([id]) => id);
    const achadas = await deps.titulos.notasBoletoSemTitulo(tx, { ha_minutos: opcoes.ha_minutos, limite: opcoes.limite ?? 50, excluir: desistidas });
    const ids = [...achadas].sort((a, b) => (controle.get(a)?.ordem ?? 0) - (controle.get(b)?.ordem ?? 0));
    const r: ResultadoVarreduraTitulos = { verificadas: 0, geradas: 0, pendentes: 0, desistidas: 0 };
    for (const id of ids) {
      const nota = await deps.notas.obter(tx, id, { travar: true });
      if (nota?.status !== 'autorizada') continue;
      r.verificadas++;
      const g = await gerarTitulosSeguro(tx, deps, nota, deps.log);
      if (g.ok) {
        r.geradas += g.titulos.length;
        controle.delete(id);
        continue;
      }
      r.pendentes++;
      const tentativas = (controle.get(id)?.tentativas ?? 0) + 1;
      controle.set(id, { tentativas, ordem: ++relogio });
      if (tentativas >= max) {
        r.desistidas++;
        deps.log({ evento: 'faturamento.titulo.geracao_desistida', tenant_id: nota.tenant_id, nota_id: id, motivo: `${tentativas} tentativas: ${g.motivo}`.slice(0, 255) });
      }
    }
    return r;
  };
}

export interface ResultadoCancelamentoTitulos {
  cancelados: number;
  /** Parcelas com baixa: ficam como estão; o financeiro trata (RN-FAT-06). */
  divergentes: { id: string; parcela: number }[];
}

/** Chamada depois da guarda do `procEventoNFe`, na mesma tx. Nunca bloqueia o cancelamento da nota (a SEFAZ já cancelou). */
export async function cancelarTitulosDaNotaCancelada(tx: Transacao, deps: Pick<DepsTitulos, 'titulos'>, nota_id: string): Promise<ResultadoCancelamentoTitulos> {
  const titulos = await deps.titulos.listarDaNota(tx, nota_id, { travar: true });
  const r = cancelarTitulosDaNota(titulos);
  await deps.titulos.cancelar(tx, r.cancelar);
  return { cancelados: r.cancelar.length, divergentes: r.divergentes };
}

export function criarServicoTitulos(deps: DepsTitulos, agora: () => Date = () => new Date()) {
  const naoAchou = (): never => { throw erros.naoEncontrado('Título'); };
  const doNota = async (tx: Transacao, t: TituloResumo): Promise<NotaRegistro> => (await deps.notas.obter(tx, t.nota_id)) ?? naoAchou();

  return {
    /** Baixa parcial ou total: INSERT em `titulo_baixa` (o gatilho abate o saldo na mesma tx) e `titulo.baixado@1` com o título já com o saldo novo. */
    async baixar(tx: Transacao, titulo_id: string, e: BaixarTituloEntrada, usuario_id: string | null): Promise<{ baixa: BaixaTituloResumo; titulo: TituloResumo }> {
      const antes = (await deps.titulos.obter(tx, titulo_id, { travar: true })) ?? naoAchou();
      const agoraD = agora();
      const data = e.data_baixa ?? dataCivilManaus(agoraD);
      if (data > dataCivilManaus(agoraD)) throw erroDeViolacoes([violacao('RN-FAT-06', 'data_baixa', 'a data da baixa não pode ser futura')]);
      const baixadoEm = e.data_baixa ? new Date(`${e.data_baixa}T12:00:00-04:00`) : agoraD;
      comoErroDaApi(() => baixar(antes, e.valor_centavos, data));
      const baixa = await deps.titulos.registrarBaixa(tx, titulo_id, { valor_centavos: e.valor_centavos, forma: e.forma, usuario_id, baixado_em: baixadoEm });
      const depois = (await deps.titulos.obter(tx, titulo_id)) ?? naoAchou();
      const nota = await doNota(tx, depois);
      // O `conta_como_real` é o da nota (calculado na emissão), não a bandeira de agora: o `titulo.baixado@1` sai coerente com o `titulo.gerado@1`.
      const comoReal = contaComoRealDaNota(await deps.notas.lerConteudo(tx, nota.id), nota);
      const payload = TituloBaixadoPayload.parse(payloadTituloBaixado(paraDomain(nota), depois, e.valor_centavos, data, comoReal));
      await deps.notas.publicarEvento(tx, { nome: EVENTO_TITULO_BAIXADO, agregado_id: depois.id, payload });
      return { baixa, titulo: depois };
    },

    /** Estorno: marca a baixa (o gatilho devolve o saldo e reabre o título baixado). Sem evento próprio na v1 (pendência: `titulo.estornado@1`, ver titulos.md). */
    async estornar(tx: Transacao, titulo_id: string, baixa_id: string): Promise<{ titulo: TituloResumo }> {
      const t = (await deps.titulos.obter(tx, titulo_id, { travar: true })) ?? naoAchou();
      const baixas = await deps.titulos.baixasDoTitulo(tx, titulo_id);
      comoErroDaApi(() => estornarBaixa(t, baixas.map((b) => ({ id: b.id, valor_centavos: b.valor_centavos, estornada: b.estornada_em !== null })), baixa_id));
      await deps.titulos.estornarBaixa(tx, baixa_id, agora());
      return { titulo: (await deps.titulos.obter(tx, titulo_id)) ?? naoAchou() };
    },
  };
}

/** Porta do pedido (`ConsultaTitulosPedido`, RN-PED-04): saldo de títulos abertos do cliente, de produção ou `conta_como_real` (decisão do Alexandre de 22/11). O apps/api a liga: `consultaTitulosPedido(repos.titulos)`. */
export const consultaTitulosPedido = (titulos: Pick<RepositorioTitulos, 'saldoAbertoCliente'>): { saldoAbertoCliente(tx: Transacao, cliente_id: string): Promise<number> } => ({
  saldoAbertoCliente: (tx, cliente_id) => titulos.saldoAbertoCliente(tx, cliente_id),
});

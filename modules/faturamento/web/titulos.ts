/**
 * Títulos a receber (RF-FAT-06/07), contra as rotas do lote 5: `GET /titulos`, `GET /titulos/:id` (com baixas), `POST /titulos/:id/baixas` e
 * `POST /titulos/:id/baixas/:baixa_id/estornar` (sem corpo; a baixa e o estorno exigem `Idempotency-Key` no POST da baixa).
 */
import type { Perfil } from '@macuxierp/platform-sdk';
import { formatarCentavos, formatarDataHora, formatarQuantidade, interpretarCentavos, interpretarQuantidade } from '@macuxierp/platform-sdk/formatar';
import { BaixarTituloEntrada, DataCivil, StatusTitulo, type TituloResumo } from '../contracts';
import { podeBaixarTitulo } from '../domain';
import { dataCivilManaus } from '../domain/fuso';
import { BASE_API, FAIXA_TITULO_HOMOLOGACAO, comChave, exigirChave, falha, type Montagem, type Selo } from './notas';

const CAMINHO_BAIXAR = `${BASE_API}/titulos/:id/baixas`;
const CAMINHO_ESTORNAR = `${BASE_API}/titulos/:id/baixas/:baixa_id/estornar`;

export const ROTULO_STATUS_TITULO: Readonly<Record<StatusTitulo, string>> = { aberto: 'Em aberto', baixado: 'Baixado', cancelado: 'Cancelado' };

const MS_DIA = 86_400_000;
/** Dias de atraso entre duas datas civis (`hoje` no fuso do tenant); 0 ou negativo = não venceu. */
const diasDeAtraso = (vencimento: string, hoje: string): number => Math.round((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${vencimento}T00:00:00Z`)) / MS_DIA);

/** Data civil de hoje (AAAA-MM-DD) no fuso da filial emissora (Manaus, RD-0617): a conta vive só em `dataCivilManaus`. */
export const hojeCivil = (agora: Date = new Date()): string => dataCivilManaus(agora);

/** Situação para a coluna "Status": título aberto e vencido vira "Vencido há N dias" no tom `erro` que já existe. */
export function situacaoDoTitulo(t: Pick<TituloResumo, 'status' | 'vencimento'>, hoje: string): Selo {
  if (t.status === 'aberto') {
    const d = diasDeAtraso(t.vencimento, hoje);
    if (d > 0) return { texto: `Vencido há ${d} ${d === 1 ? 'dia' : 'dias'}`, tom: 'erro' };
  }
  return { texto: ROTULO_STATUS_TITULO[t.status], tom: t.status === 'baixado' ? 'ok' : 'neutro' };
}

interface AcoesDoTitulo {
  baixar: boolean;
  estornar: boolean;
}

/** `baixas` vem do detalhe (`GET /titulos/:id`); na lista (sem baixas) o estorno fica oculto. */
export function acoesDoTitulo(perfil: Perfil, t: { status: StatusTitulo; saldo_centavos: number; baixas?: readonly { id: string; estornada_em: string | null }[] }): AcoesDoTitulo {
  const age = podeBaixarTitulo(perfil);
  return {
    baixar: age && t.status === 'aberto' && t.saldo_centavos > 0,
    estornar: age && t.status !== 'cancelado' && (t.baixas ?? []).some((b) => b.estornada_em === null),
  };
}

export type ResultadoBaixa = ({ ok: true } & Pick<BaixarTituloEntrada, 'valor_centavos' | 'data_baixa'>) | { ok: false; erro: string };

/** Valor digitado em R$ ("1.234,56", sem float) e data civil: maior que zero, até o saldo, sem data futura (`hoje` no fuso do tenant). A API revalida. */
export function formularioBaixa(e: { valor: string; data: string; saldo_centavos: number; hoje: string }): ResultadoBaixa {
  const valor = interpretarCentavos(e.valor);
  if (valor === null || valor <= 0) return { ok: false, erro: 'Informe o valor da baixa em reais, maior que zero (ex.: 1.234,56).' };
  if (valor > e.saldo_centavos) return { ok: false, erro: `O valor da baixa não pode passar do saldo do título. Saldo: ${formatarCentavos(e.saldo_centavos)}` };
  if (!DataCivil.safeParse(e.data).success) return { ok: false, erro: 'Informe a data da baixa.' };
  if (e.data > e.hoje) return { ok: false, erro: 'A data da baixa não pode ser futura.' };
  return { ok: true, valor_centavos: valor, data_baixa: e.data };
}

/** `forma` opcional (até 30 caracteres; a API assume `manual`). Valida a Idempotency-Key e o corpo como as demais requisições. */
export function requisicaoBaixa(titulo_id: string, b: Pick<BaixarTituloEntrada, 'valor_centavos' | 'data_baixa'> & { forma?: string }, chave: string): Montagem {
  const semChave = exigirChave(chave);
  if (semChave) return semChave;
  const v = BaixarTituloEntrada.safeParse({ valor_centavos: b.valor_centavos, data_baixa: b.data_baixa, ...(b.forma ? { forma: b.forma } : {}) });
  if (!v.success) return falha('Confira o valor e a data da baixa.');
  return { ok: true, requisicao: { metodo: 'POST', caminho: CAMINHO_BAIXAR.replace(':id', titulo_id), cabecalhos: comChave(chave), corpo: { valor_centavos: v.data.valor_centavos, data_baixa: v.data.data_baixa, ...(b.forma ? { forma: v.data.forma } : {}) } } };
}

/** Estorno sem corpo: só confirmação (a API abate o saldo de volta e audita). */
export function requisicaoEstornar(titulo_id: string, baixa_id: string, chave: string): Montagem {
  return exigirChave(chave) ?? { ok: true, requisicao: { metodo: 'POST', caminho: CAMINHO_ESTORNAR.replace(':id', titulo_id).replace(':baixa_id', baixa_id), cabecalhos: comChave(chave) } };
}

/** "Estornar a baixa de R$ X feita em dd/mm?" (confirmação simples; sem motivo, a API não pede). */
export function dialogoEstornar(baixa: { valor_centavos?: number; baixado_em?: string }, fuso: string): { titulo: string; aviso: string; rotuloConfirmar: string; textoCarregando: string } {
  const valor = baixa.valor_centavos === undefined ? '' : ` de ${formatarCentavos(baixa.valor_centavos)}`;
  const dia = baixa.baixado_em ? ` feita em ${formatarDataHora(baixa.baixado_em, fuso).slice(0, 5)}` : '';
  return { titulo: `Estornar a baixa${valor}${dia}?`, aviso: 'O saldo do título volta a subir pelo valor da baixa.', rotuloConfirmar: 'Estornar a baixa', textoCarregando: 'Estornando…' };
}

/** Faixa do detalhe do título quando a nota é de homologação; produção não tem faixa. */
export const faixaDoTitulo = (t: { ambiente: 'homologacao' | 'producao' }): string | null => (t.ambiente === 'homologacao' ? FAIXA_TITULO_HOMOLOGACAO : null);

/** Rótulo da forma de baixa na tela: primeira letra maiúscula ("manual" vira "Manual"). O valor enviado à API não muda. */
export const rotuloDaForma = (forma: string): string => {
  const f = forma.trim();
  return f === '' ? '' : f.charAt(0).toLocaleUpperCase('pt-BR') + f.slice(1);
};

/** Campo do formulário de nota parcial: um por item com saldo. `valorInicial` = o saldo inteiro, como o usuário digitaria ("12,5"). */
export interface CampoParcial {
  sequencia: number;
  rotulo: string;
  /** Saldo em qtd4 (quantidade × 10^4). */
  saldo: number;
  saldoTexto: string;
  valorInicial: string;
}

export type ResultadoParcial =
  | { ok: true; itens?: { sequencia: number; quantidade: string; qtd4: number }[] }
  | { ok: false; erros: Record<number, string>; geral?: string };

const semMilhar = (texto: string): string => texto.replaceAll('.', '');
/** Aceita o ponto de milhar bem formado ("1.200,5"); qualquer outro ponto segue inválido. Sai quando o `interpretarQuantidade` do SDK aceitar milhar (PR do engenheiro). */
const tirarMilhar = (texto: string): string => (/^\d{1,3}(\.\d{3})+(,\d{1,4})?$/.test(texto) ? semMilhar(texto) : texto);

/** Fonte única do texto: erro geral do `validar` e `motivoBotaoDesligado` (botão de emitir desligado). */
export const MOTIVO_SEM_ITEM = 'Informe a quantidade de pelo menos um item';

export interface FormularioParcial {
  campos: CampoParcial[];
  /** Texto do botão de emitir desligado (nenhum item com quantidade). */
  motivoBotaoDesligado: string;
  /** `false` só com todos os campos vazios; "0" ou texto inválido ligam o botão e o `validar` mostra o erro no campo. */
  emitirHabilitado(valores: Readonly<Record<number, string | undefined>>): boolean;
  validar(valores: Readonly<Record<number, string | undefined>>): ResultadoParcial;
}

/**
 * Formulário da nota parcial (RF-FAT-01), no molde de `formularioBaixa`. `itens` vem do `PedidoAFaturarDetalhe` (item sem saldo não ganha campo).
 * Regra única: campo vazio = item FORA da nota (quantidade 0), nunca inválido. Preenchido: maior que zero, até o saldo, em qtd4
 * (vírgula decimal, até 4 casas). Pelo menos um item precisa ficar na nota. Saída `ok`: `itens` (só os que entram, `quantidade` no texto que o
 * `requisicaoEmitir` aceita e `qtd4` já em número) ou, se todos os itens com saldo foram pelo saldo inteiro, `itens` AUSENTE: nota total
 * (`requisicaoEmitir` sem `itens`). Os erros saem por `sequencia`. A API revalida.
 */
export function formularioParcial(e: { itens: readonly { sequencia: number; descricao: string | null; saldo: number }[] }): FormularioParcial {
  const comSaldo = e.itens.filter((i) => i.saldo > 0);
  const campos = comSaldo.map((i) => {
    const saldoTexto = formatarQuantidade(i.saldo); // exibição, com milhar (RD-0793: calculado uma vez)
    return {
      sequencia: i.sequencia,
      rotulo: i.descricao && i.descricao.trim() !== '' ? `${i.sequencia} - ${i.descricao}` : `Item ${i.sequencia}`,
      saldo: i.saldo,
      saldoTexto,
      valorInicial: semMilhar(saldoTexto), // campo editável e `requisicaoEmitir` não aceitam ponto de milhar
    };
  });
  return {
    campos,
    motivoBotaoDesligado: MOTIVO_SEM_ITEM,
    emitirHabilitado: (valores) => campos.some((c) => (valores[c.sequencia] ?? '').trim() !== ''),
    validar(valores) {
      const erros: Record<number, string> = {};
      const entram: { sequencia: number; quantidade: string; qtd4: number }[] = [];
      let todosInteiros = true;
      for (const c of campos) {
        const texto = (valores[c.sequencia] ?? '').trim();
        if (texto === '') { todosInteiros = false; continue; }
        const q = interpretarQuantidade(tirarMilhar(texto));
        if (q === null) erros[c.sequencia] = 'Informe a quantidade com até 4 casas decimais (ex.: 1,5).';
        else if (q <= 0) erros[c.sequencia] = 'Informe uma quantidade maior que zero ou deixe em branco.';
        else if (q > c.saldo) erros[c.sequencia] = `Máximo ${c.saldoTexto}.`;
        else {
          entram.push({ sequencia: c.sequencia, quantidade: semMilhar(formatarQuantidade(q)), qtd4: q });
          if (q !== c.saldo) todosInteiros = false;
        }
      }
      if (Object.keys(erros).length > 0) return { ok: false, erros };
      if (entram.length === 0) return { ok: false, erros, geral: MOTIVO_SEM_ITEM };
      return todosInteiros ? { ok: true } : { ok: true, itens: entram };
    },
  };
}

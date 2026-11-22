/**
 * Títulos a receber (RF-FAT-06/07), contra as rotas do lote 5: `GET /titulos`, `GET /titulos/:id` (com baixas), `POST /titulos/:id/baixas` e
 * `POST /titulos/:id/baixas/:baixa_id/estornar` (sem corpo; a baixa e o estorno exigem `Idempotency-Key` no POST da baixa).
 */
import type { Perfil } from '@macuxierp/platform-sdk';
import { formatarCentavos, formatarDataHora, interpretarCentavos } from '@macuxierp/platform-sdk/formatar';
import { BaixarTituloEntrada, DataCivil, StatusTitulo, type TituloResumo } from '../contracts';
import { BASE_API, CHAVE_OK, comChave, type Montagem, type Requisicao } from './notas';

const CAMINHO_BAIXAR = `${BASE_API}/titulos/:id/baixas`;
const CAMINHO_ESTORNAR = `${BASE_API}/titulos/:id/baixas/:baixa_id/estornar`;

export const ROTULO_STATUS_TITULO: Readonly<Record<StatusTitulo, string>> = { aberto: 'Em aberto', baixado: 'Baixado', cancelado: 'Cancelado' };

const MS_DIA = 86_400_000;
/** Dias de atraso entre duas datas civis (`hoje` no fuso do tenant); 0 ou negativo = não venceu. */
export const diasDeAtraso = (vencimento: string, hoje: string): number => Math.round((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${vencimento}T00:00:00Z`)) / MS_DIA);

/** Data civil de hoje no fuso do tenant (AAAA-MM-DD). */
export const hojeCivil = (fuso: string, agora: Date = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);

/** Situação para a coluna "Status": título aberto e vencido vira "Vencido há N dias" no tom `erro` que já existe. */
export function situacaoDoTitulo(t: Pick<TituloResumo, 'status' | 'vencimento'>, hoje: string): { texto: string; tom: 'ok' | 'alerta' | 'erro' | 'neutro' } {
  if (t.status === 'aberto') {
    const d = diasDeAtraso(t.vencimento, hoje);
    if (d > 0) return { texto: `Vencido há ${d} ${d === 1 ? 'dia' : 'dias'}`, tom: 'erro' };
  }
  return { texto: ROTULO_STATUS_TITULO[t.status], tom: t.status === 'baixado' ? 'ok' : 'neutro' };
}

export interface AcoesDoTitulo {
  baixar: boolean;
  estornar: boolean;
}

/** Baixa e estorno só para administrador, gerente e faturista (RN-FAT-06); a API confere o mesmo (403). Fiscal, leitura e vendedor não agem. */
const PERFIS_BAIXA: readonly Perfil[] = ['administrador', 'gerente', 'faturista'];

/** `baixas` vem do detalhe (`GET /titulos/:id`); na lista (sem baixas) o estorno fica oculto. */
export function acoesDoTitulo(perfil: Perfil, t: { status: StatusTitulo; saldo_centavos: number; baixas?: readonly { id: string; estornada_em: string | null }[] }): AcoesDoTitulo {
  const age = PERFIS_BAIXA.includes(perfil);
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

/** `forma` opcional (até 30 caracteres; a API assume `manual`). */
export const requisicaoBaixa = (titulo_id: string, b: Pick<BaixarTituloEntrada, 'valor_centavos' | 'data_baixa'> & { forma?: string }, chave: string): Requisicao => ({
  metodo: 'POST', caminho: CAMINHO_BAIXAR.replace(':id', titulo_id), cabecalhos: comChave(chave),
  corpo: { valor_centavos: b.valor_centavos, data_baixa: b.data_baixa, ...(b.forma ? { forma: b.forma } : {}) },
});

/** Estorno sem corpo: só confirmação (a API abate o saldo de volta e audita). */
export function requisicaoEstornar(titulo_id: string, baixa_id: string, chave: string): Montagem {
  if (!CHAVE_OK.test(chave)) return { ok: false, erro: 'Não foi possível identificar a operação. Recarregue a página e tente de novo.' };
  return { ok: true, requisicao: { metodo: 'POST', caminho: CAMINHO_ESTORNAR.replace(':id', titulo_id).replace(':baixa_id', baixa_id), cabecalhos: comChave(chave) } };
}

/** "Estornar a baixa de R$ X feita em dd/mm?" (confirmação simples; sem motivo, a API não pede). */
export function dialogoEstornar(baixa: { valor_centavos?: number; baixado_em?: string }, fuso: string): { titulo: string; aviso: string; rotuloConfirmar: string; textoCarregando: string } {
  const valor = baixa.valor_centavos === undefined ? '' : ` de ${formatarCentavos(baixa.valor_centavos)}`;
  const dia = baixa.baixado_em ? ` feita em ${formatarDataHora(baixa.baixado_em, fuso).slice(0, 5)}` : '';
  return { titulo: `Estornar a baixa${valor}${dia}?`, aviso: 'O saldo do título volta a subir pelo valor da baixa.', rotuloConfirmar: 'Estornar a baixa', textoCarregando: 'Estornando…' };
}

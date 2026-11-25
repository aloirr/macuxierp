/**
 * Tela dos prazos de pagamento e o campo do cliente (T-0085, RN-CAD-15 e RN-CAD-16), descritos como dados e funções puras:
 * o shell (apps/web) desenha a lista agrupada por forma e o formulário com "+ Parcela". A permissão e as regras aqui só
 * orientam a digitação; a API revalida tudo (RN-CORE-02).
 */
import { MAX_DIAS, NOME_FORMA, PrazoMedioDias, classeForma, type CondicaoPagamento } from '../contracts';
import { MAX_PARCELAS_DA_CLASSE, MOTIVO_PRAZO_MEDIO, validarCondicaoPagamento } from '../domain/condicao';

/** Formas aceitas (RN-CAD-09), na ordem do seletor "Forma". */
export const FORMAS_DO_PRAZO: readonly { tpag: string; rotulo: string }[] = (['01', '17', '04', '03', '15'] as const).map((tpag) => ({ tpag, rotulo: NOME_FORMA[tpag] }));

export const ROTULO_PRAZO_MEDIO = 'Prazo médio (dias)';
/** RN-CAD-15 (decisão 14 A): ajuda do campo no formulário do prazo. */
export const AJUDA_PRAZO_MEDIO = 'Vazio: o ERP calcula a média das parcelas.';
/** A lista dos prazos se agrupa por este campo (o `agruparPor` da página das condições, em `paginas.ts`). */
export const AGRUPAR_PRAZOS_POR = 'forma_tpag';

export const rotuloDaForma = (tpag: string): string => FORMAS_DO_PRAZO.find((f) => f.tpag === tpag)?.rotulo ?? 'Outra forma';
/** "30/60/90" (à vista "0"). */
export const diasDoPrazo = (dias: readonly number[]): string => dias.join('/');
/** "Prazo médio" na lista: o legado sem prazo médio aparece como "Incompleto" (RN-CAD-15). */
export const prazoMedioNaLista = (v: unknown): string => (typeof v === 'number' ? `${v}` : 'Incompleto');

type LinhaPrazo = Pick<CondicaoPagamento, 'codigo' | 'descricao' | 'forma_tpag' | 'prazos_dias' | 'prazo_medio_dias'> & { id?: string; inativo?: boolean };

export interface PrazoNaLista { id: string | undefined; codigo: string; descricao: string; dias: string; prazo_medio: string; inativo: boolean }
export interface GrupoDePrazos { forma_tpag: string; forma: string; prazos: PrazoNaLista[] }

/** Lista agrupada por forma (a ordem das formas é a do seletor; dentro da forma, por prazo médio e código). Legado sem prazo médio vai ao fim com a marca "Incompleto". */
export function agruparPrazosPorForma(linhas: readonly LinhaPrazo[]): GrupoDePrazos[] {
  const ordemForma = (t: string): number => { const i = FORMAS_DO_PRAZO.findIndex((f) => f.tpag === t); return i < 0 ? FORMAS_DO_PRAZO.length : i; };
  const grupos = new Map<string, GrupoDePrazos>();
  for (const l of [...linhas].sort((a, b) => ordemForma(a.forma_tpag) - ordemForma(b.forma_tpag) || (a.prazo_medio_dias ?? 1e6) - (b.prazo_medio_dias ?? 1e6) || a.codigo.localeCompare(b.codigo))) {
    const g = grupos.get(l[AGRUPAR_PRAZOS_POR]) ?? { forma_tpag: l[AGRUPAR_PRAZOS_POR], forma: rotuloDaForma(l[AGRUPAR_PRAZOS_POR]), prazos: [] };
    g.prazos.push({
      id: l.id, codigo: l.codigo, descricao: l.descricao, dias: diasDoPrazo(l.prazos_dias), prazo_medio: prazoMedioNaLista(l.prazo_medio_dias), inativo: l.inativo === true,
    });
    grupos.set(l[AGRUPAR_PRAZOS_POR], g);
  }
  return [...grupos.values()];
}

/** Estado do formulário do prazo: tudo texto, como digitado. */
export interface FormularioPrazo { codigo: string; descricao: string; forma_tpag: string; parcelas: string[]; prazo_medio_dias: string }

export const formularioPrazoVazio = (): FormularioPrazo => ({ codigo: '', descricao: '', forma_tpag: '15', parcelas: [''], prazo_medio_dias: '' });
/** Rótulos "Parcela 1", "Parcela 2"… */
export const rotulosDasParcelas = (n: number): string[] => Array.from({ length: n }, (_, i) => `Parcela ${i + 1}`);
/** Máximo de parcelas da forma (à vista 1, cartão 12, boleto 24). */
export const maxParcelasDaForma = (tpag: string): number => MAX_PARCELAS_DA_CLASSE[classeForma(tpag) ?? 'boleto'];
export const podeAdicionarParcela = (f: FormularioPrazo): boolean => f.parcelas.length < maxParcelasDaForma(f.forma_tpag);
export const podeRemoverParcela = (f: FormularioPrazo): boolean => f.parcelas.length > 1;
export const adicionarParcela = (f: FormularioPrazo): FormularioPrazo => (podeAdicionarParcela(f) ? { ...f, parcelas: [...f.parcelas, ''] } : f);
export const removerParcela = (f: FormularioPrazo, indice: number): FormularioPrazo =>
  podeRemoverParcela(f) ? { ...f, parcelas: f.parcelas.filter((_, i) => i !== indice) } : f;
/** Trocar para uma forma à vista deixa uma só parcela com 0 dia e prazo médio 0 (RN-CAD-15); o cartão corta nas 12 primeiras. */
export function trocarForma(f: FormularioPrazo, tpag: string): FormularioPrazo {
  if (classeForma(tpag) === 'a_vista') return { ...f, forma_tpag: tpag, parcelas: ['0'], prazo_medio_dias: '0' };
  return { ...f, forma_tpag: tpag, parcelas: f.parcelas.slice(0, maxParcelasDaForma(tpag)) };
}

const inteiro = (t: string): number | null => (/^\d+$/.test(t.trim()) ? Number(t.trim()) : null);

export type ErrosDoPrazo = Partial<Record<'codigo' | 'descricao' | 'prazos_dias' | 'prazo_medio_dias' | 'forma_tpag', string>>;

/** O corpo do POST/PUT e os erros por campo (mesma regra da API: RN-CAD-15). `corpo` só vem quando não há erro. */
export function montarPrazo(f: FormularioPrazo): { corpo?: { codigo: string; descricao: string; forma_tpag: string; prazos_dias: number[]; prazo_medio_dias: number | null }; erros: ErrosDoPrazo } {
  const erros: ErrosDoPrazo = {};
  if (f.codigo.trim() === '') erros.codigo = 'Informe o código';
  if (f.descricao.trim() === '') erros.descricao = 'Informe a descrição';
  const dias = f.parcelas.map(inteiro);
  // vazio vai como null e o ERP calcula (decisão 14 A); digitado é validado de 0 a 365
  const vazio = f.prazo_medio_dias.trim() === '';
  const medio = vazio ? null : inteiro(f.prazo_medio_dias);
  if (dias.some((d) => d === null)) erros.prazos_dias = `Informe os dias de cada parcela (0 a ${MAX_DIAS})`;
  if (!vazio && medio === null) erros.prazo_medio_dias = MOTIVO_PRAZO_MEDIO;
  if (Object.keys(erros).length === 0) {
    const prazos = dias as number[];
    for (const v of validarCondicaoPagamento({ forma_tpag: f.forma_tpag, prazos_dias: prazos, prazo_medio_dias: medio })) erros[v.campo as keyof ErrosDoPrazo] = v.mensagem;
    if (Object.keys(erros).length === 0) return { corpo: { codigo: f.codigo.trim(), descricao: f.descricao.trim(), forma_tpag: f.forma_tpag, prazos_dias: prazos, prazo_medio_dias: medio }, erros };
  }
  return { erros };
}

/** Da condição gravada para o formulário (o legado sem prazo médio abre com o campo vazio, para o usuário completar). */
export const formularioDoPrazo = (c: LinhaPrazo): FormularioPrazo => ({
  codigo: c.codigo, descricao: c.descricao, forma_tpag: c.forma_tpag, parcelas: c.prazos_dias.map(String), prazo_medio_dias: c.prazo_medio_dias === null ? '' : String(c.prazo_medio_dias),
});

/** Cliente (RN-CAD-16): só o campo "Prazo médio (dias)", opcional; sem lista de prazos liberados. Vazio = sem restrição (nulo). */
export const CAMPO_PRAZO_MEDIO_DO_CLIENTE = { campo: 'prazo_medio_dias', rotulo: ROTULO_PRAZO_MEDIO, opcional: true, min: 0, max: MAX_DIAS } as const;
export function prazoMedioDoCliente(texto: string): { valor: number | null; erro?: string } {
  if (texto.trim() === '') return { valor: null };
  const n = inteiro(texto);
  return n === null || !PrazoMedioDias.safeParse(n).success ? { valor: null, erro: MOTIVO_PRAZO_MEDIO } : { valor: n };
}

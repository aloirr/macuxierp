/**
 * Tela dos prazos de pagamento e o campo do cliente (T-0085, RN-CAD-15 e RN-CAD-16), descritos como dados e funções puras:
 * o shell (apps/web) desenha a lista agrupada por forma e o formulário com "+ Parcela". A permissão e as regras aqui só
 * orientam a digitação; a API revalida tudo (RN-CORE-02).
 */
import { MAX_DIAS, NOME_FORMA, PrazoMedioDias, classeForma, type CondicaoPagamento } from '../contracts';
import { soOQueMudou } from './edicao';
import { MAX_PARCELAS_DA_CLASSE, MOTIVO_PRAZO_MEDIO, validarCondicaoPagamento } from '../domain/condicao';

/** Formas aceitas (RN-CAD-09), na ordem do seletor "Forma". */
export const FORMAS_DO_PRAZO: readonly { tpag: string; rotulo: string }[] = (['01', '17', '04', '03', '15'] as const).map((tpag) => ({ tpag, rotulo: NOME_FORMA[tpag] }));

export const ROTULO_PRAZO_MEDIO = 'Prazo médio (dias)';
/** A lista dos prazos se agrupa por este campo (o `agruparPor` da página das condições, em `paginas.ts`). */
export const AGRUPAR_PRAZOS_POR = 'forma_tpag';

export const rotuloDaForma = (tpag: string): string => FORMAS_DO_PRAZO.find((f) => f.tpag === tpag)?.rotulo ?? 'Outra forma';
/** "30/60/90" (à vista "0"). */
export const diasDoPrazo = (dias: readonly number[]): string => dias.join('/');
/** "Prazo médio" na lista: o legado sem prazo médio aparece como "Incompleto" (RN-CAD-15). */
export const prazoMedioNaLista = (v: unknown): string => (typeof v === 'number' ? `${v}` : 'Incompleto');

type LinhaPrazo = Pick<CondicaoPagamento, 'codigo' | 'descricao' | 'forma_tpag' | 'prazos_dias' | 'prazo_medio_dias' | 'prazo_medio_calculado'> & { id?: string; inativo?: boolean };

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

/**
 * Estado do formulário do prazo: tudo texto, como digitado. `prazo_medio_sugerido` é só a dica (placeholder) do prazo médio
 * CALCULADO gravado (T-0108, decisão 17 B): nunca é enviado, nem vira valor do campo.
 */
export interface FormularioPrazo { codigo: string; descricao: string; forma_tpag: string; parcelas: string[]; prazo_medio_dias: string; prazo_medio_sugerido: string }

export const formularioPrazoVazio = (): FormularioPrazo => ({ codigo: '', descricao: '', forma_tpag: '15', parcelas: [''], prazo_medio_dias: '', prazo_medio_sugerido: '' });
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
  // RN-CAD-15 (decisão 14 A): vazio vai como null (`completarPrazoMedio`); digitado é validado de 0 a 365
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

/**
 * Da condição gravada para o formulário. O legado sem prazo médio abre com o campo vazio, para o usuário completar. T-0108 (decisão 17 B,
 * RN-CAD-15): o prazo médio CALCULADO (`prazo_medio_calculado === true`) também abre vazio, com o valor em `prazo_medio_sugerido` (dica);
 * assim salvar sem mexer não o converte em digitado. O digitado abre no campo.
 */
export function formularioDoPrazo(c: LinhaPrazo): FormularioPrazo {
  const medio = c.prazo_medio_dias === null ? '' : String(c.prazo_medio_dias);
  const calculado = c.prazo_medio_calculado === true;
  return {
    codigo: c.codigo, descricao: c.descricao, forma_tpag: c.forma_tpag, parcelas: c.prazos_dias.map(String),
    prazo_medio_dias: calculado ? '' : medio, prazo_medio_sugerido: calculado ? medio : '',
  };
}

/**
 * Corpo do PATCH do prazo (T-0108, 17 B): a base é `montarPrazo`; só segue o que mudou. Se o prazo médio gravado era CALCULADO e o campo
 * continua vazio, o campo NÃO vai (omitido, e não `null`): assim, sem mudar as parcelas, nada muda; mudando as parcelas, o
 * `completarPrazoMedio` da API vê `prazo_medio_dias === undefined` com a marca true e recalcula, mantendo a marca. Número digitado vai como digitado;
 * campo apagado de um digitado vai `null` (a API recalcula e marca calculado).
 */
export function corpoDoPatchDoPrazo(f: FormularioPrazo, original: LinhaPrazo): { corpo?: Record<string, unknown>; erros: ErrosDoPrazo } {
  const r = montarPrazo(f);
  if (!r.corpo) return r;
  const novo: Record<string, unknown> = { ...r.corpo };
  if (r.corpo.prazo_medio_dias === null && original.prazo_medio_calculado === true) delete novo.prazo_medio_dias;
  return { corpo: soOQueMudou(novo, original), erros: r.erros };
}

/** Cliente (RN-CAD-16): só o campo "Prazo médio (dias)", opcional; sem lista de prazos liberados. Vazio = sem restrição (nulo). */
export const CAMPO_PRAZO_MEDIO_DO_CLIENTE = { campo: 'prazo_medio_dias', rotulo: ROTULO_PRAZO_MEDIO, opcional: true, min: 0, max: MAX_DIAS } as const;
export function prazoMedioDoCliente(texto: string): { valor: number | null; erro?: string } {
  if (texto.trim() === '') return { valor: null };
  const n = inteiro(texto);
  return n === null || !PrazoMedioDias.safeParse(n).success ? { valor: null, erro: MOTIVO_PRAZO_MEDIO } : { valor: n };
}

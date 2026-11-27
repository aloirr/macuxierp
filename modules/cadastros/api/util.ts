import { ErroApi, erros, type CamposErro, type EntradaRota } from '@macuxierp/platform-sdk';
import { PADRAO_UUID } from '@macuxierp/platform-sdk';
import type { FilialDados, RegimePisCofins } from '../contracts';
import { externalIdColideComId, type Violacao } from '../domain';
import type { Repositorios, TabelaChave } from './portas';

/** Regra de negócio violada → 422 com o código da RN; decisões "D*" (configuração) → 400 de validação. */
export function erroDeViolacoes(v: readonly Violacao[]): ErroApi {
  const primeira = v[0];
  if (!primeira) throw new RangeError('erroDeViolacoes sem violação');
  const campos: CamposErro = Object.fromEntries(v.map((x) => [x.campo, x.mensagem]));
  return /^RN-[A-Z]+-\d{2}$/.test(primeira.rn) ? erros.regra(primeira.rn, primeira.mensagem, campos) : erros.validacao(campos);
}

export function exigir(v: readonly Violacao[]): void {
  if (v.length > 0) throw erroDeViolacoes(v);
}

export function idDe(e: EntradaRota<unknown, unknown>, nome = 'id'): string {
  const id = e.params[nome];
  if (!id || !PADRAO_UUID.test(id)) throw erros.naoEncontrado('Registro');
  return id;
}

export const dataIso = (d: Date): string => d.toISOString().slice(0, 10);

/** Guarda RD-0317 (ver domain/external-id.ts): a rota exige (422 RN-CORE-05) e a carga vira CARGA_CONFLITO da linha. */
export const violacaoExternalId = (r: Repositorios, tabela: TabelaChave, externalId: unknown): Promise<Violacao | null> =>
  externalIdColideComId(externalId, (id) => r.chaves.existeId(tabela, id));

/** Copia só as chaves listadas: o que não está na lista (custo, e-mail, contatos) nunca sai. */
export function escolher<T extends object, K extends keyof T>(obj: T, campos: readonly K[]): Pick<T, K> {
  const saida = {} as Pick<T, K>;
  for (const k of campos) saida[k] = obj[k];
  return saida;
}

export type CrtCadastros = 1 | 2 | 3 | 4;
/** CRT do cadastro (texto) -> número da NF-e; um lugar só para as consultas do faturamento e do fiscal. */
export const CRT: Record<FilialDados['crt'], CrtCadastros> = { '1': 1, '2': 2, '3': 3, '4': 4 };

/** Dados fiscais da filial como as consultas os entregam; ausente no cadastro = padrão de criação (false / null). */
export function dadosFiscaisDaFilial(f: { crt: FilialDados['crt']; industrial_ipi?: boolean; regime_pis_cofins?: RegimePisCofins | null }): {
  crt: CrtCadastros; industrial_ipi: boolean; regime_pis_cofins: RegimePisCofins | null;
} {
  return { crt: CRT[f.crt], industrial_ipi: f.industrial_ipi ?? false, regime_pis_cofins: f.regime_pis_cofins ?? null };
}

/** Código do PostgreSQL para "permission denied": o papel não lê a tabela (RN-CAD-16: contagem de clientes indisponível). */
export const SEM_PERMISSAO_LEITURA = '42501';

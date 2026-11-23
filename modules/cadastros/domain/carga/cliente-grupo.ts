/**
 * T-0058: o cliente e os endereços dele vêm no mesmo cliente.csv, uma linha por endereço, todas com o mesmo `external_id`.
 * Funções puras: conferem que os dados do cliente são iguais nas linhas do grupo, agrupam as linhas, derivam o `external_id`
 * do endereço e leem o `seq`. Mensagens fixas, sem valor de célula (D9).
 */
import { celulaInteiro } from '@macuxierp/platform-sdk';
import type { LinhaCliente } from '../../contracts';
import { erroLinha, type ErroLinha } from './erros';

type Celulas = Readonly<Record<string, string>>;
type TipoEnd = LinhaCliente['enderecos'][number]['tipo'];

/** Limites do `seq` do endereço (1 a 999): a MESMA regra do mapeamento da coluna e do Substituir tudo. */
export const LIMITES_SEQ_ENDERECO = { min: 1, max: 999 } as const;

/** O `seq` da célula, ou `undefined` se vazio ou fora da regra (o mapeamento é quem recusa a linha). */
export function lerSeqEndereco(bruto: string | undefined): number | undefined {
  const r = celulaInteiro((bruto ?? '').trim(), LIMITES_SEQ_ENDERECO);
  return r.ok ? r.valor : undefined;
}

/** `<cliente>` + `:<tipo>` e, havendo `seq`, `:<seq>`. O limite de 64 caracteres (D3) é conferido por quem chama. */
export const derivarExternalIdEndereco = (cliente: string, tipo: TipoEnd, seq: number | undefined): string =>
  seq === undefined ? `${cliente}:${tipo}` : `${cliente}:${tipo}:${seq}`;

/** Colunas que podem variar de uma linha do cliente para outra: o endereço, o tipo e a seq dele. */
const colunaLivre = (coluna: string): boolean => coluna.startsWith('endereco.') || coluna === 'tipo_endereco' || coluna === 'seq';

const normalizar = (v: string | undefined): string => (v ?? '').trim();

/**
 * Os dados do cliente valem pela 1ª linha do `external_id`. Outra linha com qualquer coluna (fora as de endereço,
 * `tipo_endereco` e `seq`) diferente da 1ª sai com erro e é recusada inteira. Linha sem `external_id` não entra no grupo.
 */
export function conferirDadosDoCliente(linhas: readonly { numero: number; celulas: Celulas }[]): { erros: ErroLinha[]; recusadas: Set<number> } {
  const primeira = new Map<string, { numero: number; celulas: Celulas }>();
  const erros: ErroLinha[] = [];
  const recusadas = new Set<number>();
  for (const l of linhas) {
    const ext = normalizar(l.celulas.external_id);
    if (ext === '') continue;
    const base = primeira.get(ext);
    if (!base) {
      primeira.set(ext, l);
      continue;
    }
    const colunas = new Set([...Object.keys(base.celulas), ...Object.keys(l.celulas)].filter((c) => !colunaLivre(c)));
    if ([...colunas].some((c) => normalizar(base.celulas[c]) !== normalizar(l.celulas[c]))) {
      erros.push(erroLinha(l.numero, null, 'CARGA_CONFLITO', `Dados do cliente diferentes da linha ${base.numero}: deixe iguais em todas as linhas do cliente`));
      recusadas.add(l.numero);
    }
  }
  return { erros, recusadas };
}

/** Junta as linhas já mapeadas do mesmo `external_id` em um cliente só (dados e refs da 1ª linha; endereços de todas). */
export function agruparClientes(linhas: readonly LinhaCliente[]): { clientes: LinhaCliente[]; erros: ErroLinha[] } {
  const grupos = new Map<string, LinhaCliente>();
  const erros: ErroLinha[] = [];
  for (const l of linhas) {
    let g = grupos.get(l.external_id);
    if (!g) {
      g = { ...l, enderecos: [], avisos: [...l.avisos], linhas: [] };
      grupos.set(l.external_id, g);
    } else g.avisos.push(...l.avisos.filter((a) => !g?.avisos.includes(a)));
    let aceita = l.enderecos.length === 0;
    for (const e of l.enderecos) {
      if (g.enderecos.some((x) => x.external_id === e.external_id)) {
        erros.push(erroLinha(e.linha, 'seq', 'CARGA_DUPLICADO', 'Endereço repetido: use outra seq para o mesmo tipo de endereço do cliente'));
      } else if (e.tipo === 'principal' && g.enderecos.some((x) => x.tipo === 'principal')) {
        erros.push(erroLinha(e.linha, 'tipo_endereco', 'RN-CAD-03', 'Só um endereço principal por cliente: troque o tipo_endereco desta linha'));
      } else {
        g.enderecos.push(e);
        aceita = true;
      }
    }
    // A linha recusada pelo agrupamento não conta entre as linhas do cliente (fica como recusada no relatório).
    if (aceita) g.linhas?.push(l.linha);
  }
  const clientes = [...grupos.values()];
  for (const c of clientes) {
    const primeiro = c.enderecos[0];
    if (primeiro && !c.enderecos.some((e) => e.tipo === 'principal')) {
      c.enderecos[0] = { ...primeiro, tipo: 'principal', seq: undefined, external_id: derivarExternalIdEndereco(c.external_id, 'principal', undefined) };
      c.avisos.push('Nenhum endereço principal no cliente: o primeiro endereço virou o principal');
    }
  }
  return { clientes, erros };
}

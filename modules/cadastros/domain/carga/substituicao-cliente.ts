/**
 * T-0058 (RN-CAD-10): "Substituir tudo" do cliente. Os endereços moram no cliente.csv, então os que não vierem no arquivo são
 * inativados junto (nunca apagados): os de carga (com `external_id`) dos clientes que ficam, e todos os dos clientes inativados.
 * Mesmo critério do `planoSubstituicao` para registro sem `external_id`: não dá para dizer que saiu do arquivo, então fica e só é contado.
 * Funções puras; sem valor de célula.
 */
import { TipoEndereco } from '../../contracts';
import { derivarExternalIdEndereco, lerSeqEndereco } from './cliente-grupo';
import { planoSubstituicao, type ExistenteSubstituicao, type PlanoSubstituicao } from './substituicao';

interface EnderecoExistente extends ExistenteSubstituicao {
  /** id do cliente dono. */
  pai_id: string | null;
}

export interface PlanoSubstituicaoCliente extends PlanoSubstituicao {
  /** ids de endereço a inativar (nunca apagar). */
  enderecos_inativar: string[];
  /** endereços ativos sem external_id de clientes que ficam: não saíram do arquivo por regra, não são inativados. */
  enderecos_sem_chave: number;
}

/**
 * Os `external_id` de endereço que o arquivo traz, de TODA linha lida (a recusada também protege o gravado, como no cliente).
 * A linha tem endereço se traz alguma coluna `endereco.*` ou o `tipo_endereco`; tipo vazio = principal. Cliente sem linha
 * principal tem a 1ª linha promovida a principal (aviso do agrupamento): o `<cliente>:principal` fica protegido também.
 */
export function externosEnderecoDoArquivo(linhas: readonly { celulas: Readonly<Record<string, string | undefined>> }[]): Set<string> {
  const saida = new Set<string>();
  const comPrincipal = new Set<string>();
  const comEndereco = new Set<string>();
  for (const l of linhas) {
    const cliente = (l.celulas.external_id ?? '').trim();
    if (cliente === '') continue;
    const tipoBruto = (l.celulas.tipo_endereco ?? '').trim().toLowerCase();
    const temEndereco = tipoBruto !== '' || Object.entries(l.celulas).some(([c, v]) => c.startsWith('endereco.') && (v ?? '').trim() !== '');
    if (!temEndereco) continue;
    const tipo = TipoEndereco.options.find((o) => o === (tipoBruto === '' ? 'principal' : tipoBruto));
    if (tipo === undefined) continue;
    saida.add(derivarExternalIdEndereco(cliente, tipo, lerSeqEndereco(l.celulas.seq)));
    comEndereco.add(cliente);
    if (tipo === 'principal') comPrincipal.add(cliente);
  }
  for (const c of comEndereco) if (!comPrincipal.has(c)) saida.add(derivarExternalIdEndereco(c, 'principal', undefined));
  return saida;
}

/** Os endereços gravados do cliente que o arquivo não trouxe (os sem `external_id` não são da carga e ficam). */
function enderecosAusentes<E extends { external_id: string | null }>(gravados: readonly E[], externosDoArquivo: ReadonlySet<string>): E[] {
  return gravados.filter((e) => e.external_id !== null && !externosDoArquivo.has(e.external_id));
}

export function planoSubstituicaoCliente(p: {
  modo: 'adicionar' | 'substituir_tudo';
  externos_cliente: readonly string[];
  externos_endereco: ReadonlySet<string>;
  clientes: readonly ExistenteSubstituicao[];
  enderecos: readonly EnderecoExistente[];
  em_uso: ReadonlySet<string>;
}): PlanoSubstituicaoCliente {
  const plano = planoSubstituicao({ modo: p.modo, entidade: 'cliente', externos_do_arquivo: p.externos_cliente, existentes: p.clientes, em_uso: p.em_uso });
  if (p.modo !== 'substituir_tudo') return { ...plano, enderecos_inativar: [], enderecos_sem_chave: 0 };
  const saem = new Set(plano.inativar);
  const vindos = new Set(p.externos_cliente);
  const ficam = new Set(p.clientes.filter((c) => !c.inativo && c.external_id !== null && vindos.has(c.external_id)).map((c) => c.id));
  const ativos = p.enderecos.filter((e) => !e.inativo && e.pai_id !== null);
  const acompanham = ativos.filter((e) => saem.has(e.pai_id as string)).map((e) => e.id);
  const dosQueFicam = ativos.filter((e) => ficam.has(e.pai_id as string));
  const ausentes = enderecosAusentes(dosQueFicam, p.externos_endereco).map((e) => e.id);
  return {
    ...plano,
    enderecos_inativar: [...acompanham, ...ausentes],
    enderecos_sem_chave: dosQueFicam.filter((e) => e.external_id === null).length,
  };
}

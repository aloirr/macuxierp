/**
 * Validação do cliente na criação e na edição (RN-CAD-01, RN-CAD-02, RN-CAD-03 e as referências), a mesma do
 * `POST/PATCH /v1/cadastros/clientes` e do `CriadorClienteFdv` (pré-cadastro do FDV, T-0059): um caminho só.
 */
import {
  validarDocumentoCliente, validarEnderecoPrincipal, validarIndIeDest, validarMunicipio, violacao, type Violacao,
} from '../domain';
import type { Repositorios } from './portas';
import type { ClienteDados, EnderecoCliente } from '../contracts';

/** RN-CAD-03: o IBGE existe e pertence à UF do endereço; `campo` é o caminho devolvido na violação. */
export const verificarMunicipioEndereco = (e: { municipio_ibge: string; uf: string }, campo: string): Violacao[] => {
  const m = validarMunicipio(e.municipio_ibge, e.uf);
  return m.ok ? [] : [{ ...m.violacao, campo }];
};

/** `parcial === null` é a criação (valida também o endereço principal e os municípios); no PATCH `cli` é o cliente já mesclado. */
export async function validarCliente(r: Repositorios, cli: Record<string, unknown>, parcial: Record<string, unknown> | null): Promise<Violacao[]> {
  const v: Violacao[] = [];
  const doc = validarDocumentoCliente(cli.tipo_pessoa as 'PJ' | 'PF', cli.documento as string);
  if (!doc.ok) v.push(doc.violacao);
  const novos = (cli.enderecos as EnderecoCliente[] | undefined) ?? [];
  if (parcial === null) {
    const principal1 = validarEnderecoPrincipal(novos);
    if (!principal1.ok) v.push(principal1.violacao);
    novos.forEach((x, i) => v.push(...verificarMunicipioEndereco(x, `enderecos.${i}`)));
  }
  const gravados = typeof cli.id === 'string' ? await r.clientes.enderecos.listar(cli.id) : [];
  const principal = [...novos, ...gravados].find((x) => x.tipo === 'principal');
  const ie = validarIndIeDest({ ind_ie_dest: cli.ind_ie_dest as '1' | '2' | '9', ie: (cli.ie as string | null) ?? null, uf: principal?.uf ?? '' });
  if (!ie.ok) v.push(ie.violacao);
  const refs: [string, string | null, { obter(id: string): Promise<unknown> }][] = [
    ['filial_id', cli.filial_id as string, r.filiais], ['vendedor_id', (cli.vendedor_id as string | null) ?? null, r.vendedores],
    ['condicao_pagamento_id', (cli.condicao_pagamento_id as string | null) ?? null, r.condicoesPagamento],
    ['tabela_preco_id', (cli.tabela_preco_id as string | null) ?? null, r.tabelasPreco],
  ];
  for (const [campo, id, repo] of refs) if (id !== null && !(await repo.obter(id))) v.push(violacao('REF', campo, 'Cadastro inexistente'));
  return v;
}

/** Cliente novo (POST e pré-cadastro do FDV): as violações de `validarCliente` sem `parcial`. */
export const validarClienteNovo = (r: Repositorios, dados: ClienteDados): Promise<Violacao[]> => validarCliente(r, dados as unknown as Record<string, unknown>, null);

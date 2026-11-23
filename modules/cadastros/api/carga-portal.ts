/**
 * Carga de cadastros pelo portal `/config` (T-0058, v0.3.5a; contrato em `packages/platform-sdk/src/portal-cargas.ts`).
 * O plugin de plataforma (só superadmin) liga estas funções às rotas `.../cargas/:cadastro/validar` e `/gravar`, entregando
 * o `ContextoRota` do tenant ESCOLHIDO (transação com `app.tenant_id` = empresa da rota, perfil `administrador` do papel
 * de execução) e o arquivo (multipart, campo `arquivo`). Reaproveita o `executarCarga` do BKO: mesma validação, mesma
 * gravação, mesmos eventos.
 *
 * - `adicionar`: a carga de hoje (acrescenta e atualiza, sem tirar nada).
 * - `substituir_tudo` (RN-CAD-10): a API revalida a frase (`normalizarFrase`); grava o arquivo; depois, na MESMA transação,
 *   inativa (`deleted_at`, como a D6; nunca apaga) os ativos que não vieram no arquivo e publica `cadastros.*.alterado@1`
 *   com `inativo: true`, que é o que leva a inativação ao FDV. Em uso (`ConsultaUsoCadastros`) também é inativado e só
 *   conta em `mantidos_em_uso` (o histórico fica). Formas de pagamento (a forma vive na condição) e estoque (saldo, não
 *   cadastro) não têm o que inativar.
 * - Nada de valor de célula nem dado pessoal em erro, aviso ou auditoria: só contagens.
 */
import {
  ArquivoRecebido, CadastroCargaPortal, DEPENDENCIAS_CARGA_PORTAL, ErroApi, FRASE_SUBSTITUIR_TUDO, GravarCargaPlataformaResposta, LIMITE_LINHAS_ERRO_VALIDACAO,
  MENSAGENS_CARGA_PORTAL, MENSAGEM_FRASE_SUBSTITUIR, ValidarCargaPlataformaResposta, efeitoSubstituir, erros, lerCsv, normalizarFrase,
  type ContextoRota, type EfeitoSubstituir, type ModoGravarCarga,
} from '@macuxierp/platform-sdk';
import type { RelatorioCarga, ResultadoEntidade } from '../contracts';
import { LAYOUT, planoSubstituicao } from '../domain';
import { executarCarga } from './carga';
import { eventoCliente, eventoFilial, eventoPreco, eventoProduto, eventoSimples, publicarPronto } from './eventos';
import type { Dependencias, TabelaSubstituivel } from './portas';

/** Tabela que o "Substituir tudo" inativa em cada cadastro; `null` = nada a inativar (forma e estoque). */
const TABELA_SUBSTITUIVEL: Record<CadastroCargaPortal, TabelaSubstituivel | null> = {
  filial: 'filial', vendedor: 'vendedor', forma_pagamento: null, prazo_pagamento: 'condicao_pagamento', produto: 'produto',
  produto_unidade: 'produto_unidade', preco: 'tabela_preco_item', estoque: null, cliente: 'cliente', cliente_endereco: 'cliente_endereco',
};

const ACAO_LINHA = 'Corrija a linha no arquivo e envie de novo.';
const ACAO_ARQUIVO = 'Corrija o arquivo e envie de novo.';

export interface EntradaCargaPortal {
  cadastro: CadastroCargaPortal;
  modo: ModoGravarCarga;
  /** Campo `frase` do multipart (só no `substituir_tudo`). */
  frase?: string;
  /** Campo `arquivo` do multipart, com o nome que o navegador mandou: o serviço o renomeia para `<cadastro>.csv`. */
  arquivo: ArquivoRecebido;
}

const conflito = (mensagem: string, codigo: string): ErroApi => new ErroApi(409, 'CONFLITO', mensagem, undefined, { codigo });

/** RN-CAD-10: a frase é revalidada aqui, com a mesma normalização da tela (422; nada é lido nem gravado). */
export function exigirFraseSubstituir(frase: string | undefined): void {
  if (frase === undefined || normalizarFrase(frase) !== FRASE_SUBSTITUIR_TUDO) {
    throw erros.regra('RN-CAD-10', MENSAGEM_FRASE_SUBSTITUIR, { frase: MENSAGEM_FRASE_SUBSTITUIR }, { codigo: 'frase_nao_confere' });
  }
}

/** RF-CAD-11: 409 se algum cadastro de que este depende ainda não tem registro ativo (a forma vive na condição: fica de fora). */
async function exigirDependencias(deps: Dependencias, c: ContextoRota, cadastro: CadastroCargaPortal): Promise<void> {
  const r = deps.repositorios(c.tx);
  for (const dep of DEPENDENCIAS_CARGA_PORTAL[cadastro]) {
    const tabela = TABELA_SUBSTITUIVEL[dep];
    if (tabela && !(await r.substituicao.temAtivos(tabela))) throw conflito(MENSAGENS_CARGA_PORTAL.dependenciaPendente, 'dependencia_pendente');
  }
}

const arquivoDoCadastro = (e: EntradaCargaPortal): ArquivoRecebido => new ArquivoRecebido(e.arquivo.campo, `${e.cadastro}.csv`, e.arquivo.tipo, e.arquivo.conteudo());

/** Os `external_id` do arquivo, de TODA linha lida (a recusada também protege o existente de ser inativado). */
function externosDoArquivo(cadastro: CadastroCargaPortal, a: ArquivoRecebido): string[] {
  const layout = LAYOUT[cadastro];
  const lido = lerCsv(a.conteudo(), { aceitas: [...layout.usadas, ...layout.ignoradas], obrigatorias: layout.obrigatorias });
  if (!lido.ok) return [];
  return lido.linhas.map((l) => (l.celulas.external_id ?? '').trim()).filter((x) => x !== '');
}

async function planejar(deps: Dependencias, c: ContextoRota, cadastro: CadastroCargaPortal, a: ArquivoRecebido) {
  const tabela = TABELA_SUBSTITUIVEL[cadastro];
  const r = deps.repositorios(c.tx);
  const existentes = tabela ? await r.substituicao.existentes(tabela) : [];
  const ativos = existentes.filter((e) => !e.inativo);
  // ids candidatos = ativos sem o external_id no arquivo (o `planoSubstituicao` decide; o em uso só informa)
  const externos = externosDoArquivo(cadastro, a);
  const vindos = new Set(externos);
  const candidatos = ativos.filter((e) => e.external_id === null || !vindos.has(e.external_id)).map((e) => e.id);
  const uso = deps.usoCadastros && candidatos.length > 0 ? await deps.usoCadastros.emUso(c.tx, cadastro, candidatos) : new Map<string, string>();
  const plano = planoSubstituicao({
    modo: 'substituir_tudo', entidade: cadastro, externos_do_arquivo: externos,
    existentes: existentes.map((e) => ({ id: e.id, external_id: e.external_id, inativo: e.inativo })), em_uso: new Set(uso.keys()),
  });
  return { tabela, existentes, total: ativos.length, plano };
}

/** Publica `cadastros.*.alterado@1` com `inativo: true` dos inativados (o que leva a inativação ao FDV). Filha: republica o pai. */
async function publicarInativados(deps: Dependencias, c: ContextoRota, tabela: TabelaSubstituivel, ids: readonly string[], paiDe: ReadonlyMap<string, string | null>): Promise<void> {
  const r = deps.repositorios(c.tx);
  const paisUnicos = [...new Set(ids.map((id) => paiDe.get(id)).filter((x): x is string => !!x))];
  switch (tabela) {
    case 'filial':
      for (const id of ids) { const f = await r.filiais.obter(id); if (f) await publicarPronto(c, await eventoFilial(r, f)); }
      break;
    case 'vendedor':
      for (const id of ids) { const v = await r.vendedores.obter(id); if (v) await publicarPronto(c, eventoSimples('cadastros.vendedor.alterado@1', v as { id: string; inativo: boolean })); }
      break;
    case 'condicao_pagamento':
      for (const id of ids) { const v = await r.condicoesPagamento.obter(id); if (v) await publicarPronto(c, eventoSimples('cadastros.condicao_pagamento.alterada@1', v)); }
      break;
    case 'produto':
      for (const id of ids) { const p = await r.produtos.obter(id); if (p) await publicarPronto(c, await eventoProduto(r, p)); }
      break;
    case 'produto_unidade':
      for (const id of paisUnicos) { const p = await r.produtos.obter(id); if (p) await publicarPronto(c, await eventoProduto(r, p)); }
      break;
    case 'cliente':
      for (const id of ids) { const x = await r.clientes.obter(id); if (x) await publicarPronto(c, await eventoCliente(r, x)); }
      break;
    case 'cliente_endereco':
      for (const id of paisUnicos) { const x = await r.clientes.obter(id); if (x) await publicarPronto(c, await eventoCliente(r, x)); }
      break;
    case 'tabela_preco_item':
      for (const item of await r.substituicao.itensPreco(ids)) {
        const t = await r.tabelasPreco.obter(item.tabela_preco_id);
        if (t) await publicarPronto(c, eventoPreco(item, { ...t, inativo: true }));
      }
      break;
  }
}

function resultadoDoCadastro(rel: RelatorioCarga, cadastro: CadastroCargaPortal): ResultadoEntidade {
  const r = rel.entidades.find((e) => e.entidade === cadastro);
  if (!r) throw new Error('carga do portal: o relatório não trouxe o cadastro enviado');
  return r;
}

/**
 * `POST .../cargas/:cadastro/gravar` (RN-CAD-10). Erros: 422 `RN-CAD-10` (frase), 409 `dependencia_pendente`, 409 `nada_a_gravar`
 * (nenhuma linha pronta: a transação desfaz tudo). O 409 `carga_em_andamento` (MXC01) é do `portal_carga_iniciar` do banco.
 */
export async function gravarCargaPortal(deps: Dependencias, c: ContextoRota, e: EntradaCargaPortal): Promise<GravarCargaPlataformaResposta> {
  const cadastro = CadastroCargaPortal.parse(e.cadastro);
  const substituir = e.modo === 'substituir_tudo';
  if (substituir) exigirFraseSubstituir(e.frase);
  else if (e.frase !== undefined) throw erros.validacao({ frase: 'A frase é só do Substituir tudo' });
  await exigirDependencias(deps, c, cadastro);

  const arquivo = arquivoDoCadastro(e);
  const rel = await executarCarga(deps, c, 'gravar', [arquivo], cadastro);
  const res = resultadoDoCadastro(rel, cadastro);
  const gravadas = res.inseridas + res.atualizadas + res.sem_mudanca;
  if (res.situacao !== 'processado' || gravadas === 0) throw conflito(MENSAGENS_CARGA_PORTAL.nadaAGravar, 'nada_a_gravar');
  if (!substituir) return GravarCargaPlataformaResposta.parse({ cadastro, modo: e.modo, gravadas, com_erro: res.recusadas });

  const { tabela, existentes, total, plano } = await planejar(deps, c, cadastro, arquivo);
  let inativados: string[] = [];
  if (tabela) {
    const r = deps.repositorios(c.tx);
    inativados = await r.substituicao.inativarEmLote(tabela, plano.inativar);
    await publicarInativados(deps, c, tabela, inativados, new Map(existentes.map((x) => [x.id, x.pai_id])));
  }
  if (plano.mantidos_em_uso > 0) res.avisos.push(`${plano.mantidos_em_uso} inativado(s) em uso: ficam no histórico`);
  res.inativadas = inativados.length;
  await c.auditar({
    acao: 'cadastros.carga.substituir_tudo', entidade: 'carga', entidade_id: rel.lote_id, antes: null,
    depois: { cadastro, inativadas: inativados.length, mantidos_em_uso: plano.mantidos_em_uso, total_ativos: total },
  });
  return GravarCargaPlataformaResposta.parse({
    cadastro, modo: e.modo, gravadas, com_erro: res.recusadas, inativadas: inativados.length,
    efeito: efeitoSubstituir({ total: Math.max(total, inativados.length), a_inativar: inativados.length }),
  });
}

/** `POST .../cargas/:cadastro/validar`: só lê (modo `validar` do `executarCarga`), com o efeito previsto do Substituir tudo. */
export async function validarCargaPortal(deps: Dependencias, c: ContextoRota, e: EntradaCargaPortal): Promise<ValidarCargaPlataformaResposta> {
  const cadastro = CadastroCargaPortal.parse(e.cadastro);
  const arquivo = arquivoDoCadastro(e);
  const rel = await executarCarga(deps, c, 'validar', [arquivo], cadastro);
  const res = resultadoDoCadastro(rel, cadastro);
  const prontas = res.inseridas + res.atualizadas + res.sem_mudanca;
  const lista = rel.erros.map((x) => ({ linha: x.linha, motivo: x.motivo, acao: x.linha === null ? ACAO_ARQUIVO : ACAO_LINHA }));
  const linhas = lista.slice(0, LIMITE_LINHAS_ERRO_VALIDACAO);
  const comErro = res.situacao === 'processado' ? res.recusadas : Math.max(1, res.lidas);
  let efeito: EfeitoSubstituir | undefined;
  if (e.modo === 'substituir_tudo') {
    const p = await planejar(deps, c, cadastro, arquivo);
    efeito = efeitoSubstituir({ total: p.total, a_inativar: p.plano.inativar.length });
  }
  return ValidarCargaPlataformaResposta.parse({
    cadastro, modo: e.modo, prontas, com_erro: Math.max(comErro, linhas.length > 0 ? 1 : 0),
    linhas, linhas_omitidas: Math.max(0, lista.length + rel.erros_omitidos - linhas.length), ...(efeito ? { efeito } : {}),
  });
}

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
  ArquivoRecebido, CadastroCargaPortal, ErroApi, FRASE_SUBSTITUIR_TUDO, GravarCargaPlataformaResposta, LIMITE_LINHAS_ERRO_VALIDACAO,
  MENSAGENS_CARGA_PORTAL, MENSAGEM_FRASE_SUBSTITUIR, MENSAGEM_SUBSTITUIR_NAO_PERMITIDO, ValidarCargaPlataformaResposta, efeitoSubstituir, erros, normalizarFrase, substituirPermitido,
  type ContextoRota, type EfeitoSubstituir, type ModoGravarCarga,
} from '@macuxierp/platform-sdk';
import type { EntidadeCarga, ErroCarga, RelatorioCarga, ResultadoEntidade } from '../contracts';
import { planoSubstituicao } from '../domain';
import { executarCarga } from './carga';
import { lerCsvDoLayout } from './carga-reativar';
import { eventoCliente, eventoFilial, eventoPreco, eventoProduto, eventoSimples, publicarPronto } from './eventos';
import type { Dependencias, TabelaSubstituivel } from './portas';

/** Tabela que o "Substituir tudo" inativa em cada cadastro; `null` = nada a inativar (estoque). */
const TABELA_SUBSTITUIVEL: Record<CadastroCargaPortal, TabelaSubstituivel | null> = {
  filial: 'filial', vendedor: 'vendedor', condicao_pagamento: 'condicao_pagamento', produto: 'produto',
  produto_unidade: 'produto_unidade', preco: 'tabela_preco_item', estoque: null, cliente: 'cliente',
};
/**
 * Ponte de nomes até o pipeline de carga adotar os 8 do SDK (cadastros-c): o `executarCarga` ainda fala as 10 entidades
 * do kit. `condicao_pagamento` segue como `prazo_pagamento` e `cliente` como `cliente` (o endereço acompanha o cliente).
 */
export const ENTIDADE_DO_PIPELINE: Record<CadastroCargaPortal, EntidadeCarga> = {
  filial: 'filial', vendedor: 'vendedor', condicao_pagamento: 'prazo_pagamento', produto: 'produto',
  produto_unidade: 'produto_unidade', preco: 'preco', estoque: 'estoque', cliente: 'cliente',
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

/** `substituir_tudo` só onde o SDK permite (o estoque só aceita o Adicionar): 400 `VALIDACAO` no campo `modo`. */
function exigirModoPermitido(cadastro: CadastroCargaPortal, modo: ModoGravarCarga): void {
  if (modo === 'substituir_tudo' && !substituirPermitido(cadastro)) throw erros.validacao({ modo: MENSAGEM_SUBSTITUIR_NAO_PERMITIDO });
}

const arquivoDoCadastro = (e: EntradaCargaPortal): ArquivoRecebido => new ArquivoRecebido(e.arquivo.campo, `${ENTIDADE_DO_PIPELINE[e.cadastro]}.csv`, e.arquivo.tipo, e.arquivo.conteudo());

/** Os `external_id` do arquivo, de TODA linha lida (a recusada também protege o existente de ser inativado). */
function externosDoArquivo(cadastro: CadastroCargaPortal, a: ArquivoRecebido): string[] {
  const lido = lerCsvDoLayout(ENTIDADE_DO_PIPELINE[cadastro], a.conteudo());
  if (!lido.ok) return [];
  return lido.linhas.map((l) => (l.celulas.external_id ?? '').trim()).filter((x) => x !== '');
}

/**
 * O plano do Substituir tudo, calculado UMA vez, sobre os existentes de ANTES da gravação (os que voltam no arquivo têm o
 * external_id nele e não entram; os registros sem external_id só contam em `sem_chave`). O `emUso` só olha o que será inativado.
 * O total do percentual é o de ativos COM chave: o mesmo do validar e do gravar.
 */
async function planejar(deps: Dependencias, c: ContextoRota, cadastro: CadastroCargaPortal, a: ArquivoRecebido) {
  const tabela = TABELA_SUBSTITUIVEL[cadastro];
  const r = deps.repositorios(c.tx);
  const existentes = tabela ? await r.substituicao.existentes(tabela) : [];
  const base = { modo: 'substituir_tudo', entidade: ENTIDADE_DO_PIPELINE[cadastro], externos_do_arquivo: externosDoArquivo(cadastro, a), existentes: existentes.map((e) => ({ id: e.id, external_id: e.external_id, inativo: e.inativo })) } as const;
  const semUso = planoSubstituicao({ ...base, em_uso: new Set() });
  const uso = deps.usoCadastros && semUso.inativar.length > 0 ? await deps.usoCadastros.emUso(c.tx, cadastro, semUso.inativar) : new Map<string, string>();
  const plano = planoSubstituicao({ ...base, em_uso: new Set(uso.keys()) });
  const total = existentes.filter((e) => !e.inativo && e.external_id !== null).length;
  return { tabela, existentes, total, plano };
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
    case 'tabela_preco_item':
      for (const item of await r.substituicao.itensPreco(ids)) {
        const t = await r.tabelasPreco.obter(item.tabela_preco_id);
        if (t) await publicarPronto(c, eventoPreco(item, { ...t, inativo: true }));
      }
      break;
  }
}

function resultadoDoCadastro(rel: RelatorioCarga, cadastro: CadastroCargaPortal): ResultadoEntidade {
  const r = rel.entidades.find((e) => e.entidade === ENTIDADE_DO_PIPELINE[cadastro]);
  if (!r) throw new Error('carga do portal: o relatório não trouxe o cadastro enviado');
  return r;
}

/**
 * `POST .../cargas/:cadastro/gravar` (RN-CAD-10). Erros: 422 `RN-CAD-10` (frase), 409 `nada_a_gravar`
 * (nenhuma linha pronta: a transação desfaz tudo). O 409 `carga_em_andamento` (MXC01) é do `portal_carga_iniciar` do banco.
 */
export async function gravarCargaPortal(deps: Dependencias, c: ContextoRota, e: EntradaCargaPortal): Promise<GravarCargaPlataformaResposta> {
  const cadastro = CadastroCargaPortal.parse(e.cadastro);
  exigirModoPermitido(cadastro, e.modo);
  const substituir = e.modo === 'substituir_tudo';
  if (substituir) exigirFraseSubstituir(e.frase);
  else if (e.frase !== undefined) throw erros.validacao({ frase: 'A frase é só do Substituir tudo' });

  const arquivo = arquivoDoCadastro(e);
  const previsto = substituir ? await planejar(deps, c, cadastro, arquivo) : null; // antes da gravação: sobre os existentes de agora
  const rel = await executarCarga(deps, c, 'gravar', [arquivo], ENTIDADE_DO_PIPELINE[cadastro]);
  const res = resultadoDoCadastro(rel, cadastro);
  const gravadas = res.inseridas + res.atualizadas + res.sem_mudanca;
  if (res.situacao !== 'processado' || gravadas === 0) throw conflito(MENSAGENS_CARGA_PORTAL.nadaAGravar, 'nada_a_gravar');
  if (!substituir) return GravarCargaPlataformaResposta.parse({ cadastro, modo: e.modo, gravadas, com_erro: res.recusadas });

  const { tabela, existentes, total, plano } = previsto!;
  let inativados: string[] = [];
  if (tabela) {
    const r = deps.repositorios(c.tx);
    inativados = await r.substituicao.inativarEmLote(tabela, plano.inativar);
    await publicarInativados(deps, c, tabela, inativados, new Map(existentes.map((x) => [x.id, x.pai_id])));
  }
  if (plano.sem_chave > 0) res.avisos.push(`${plano.sem_chave} ativo(s) sem external_id: não foram inativados`);
  if (plano.mantidos_em_uso > 0) res.avisos.push(`${plano.mantidos_em_uso} inativado(s) em uso: ficam no histórico`);
  res.inativadas = inativados.length;
  res.sem_chave = plano.sem_chave;
  await c.auditar({
    acao: 'cadastros.carga.substituir_tudo', entidade: 'carga', entidade_id: rel.lote_id, antes: null,
    depois: { cadastro, inativadas: inativados.length, mantidos_em_uso: plano.mantidos_em_uso, total_ativos: total },
  });
  return GravarCargaPlataformaResposta.parse({
    cadastro, modo: e.modo, gravadas, com_erro: res.recusadas, inativadas: inativados.length,
    efeito: efeitoSubstituir({ total, a_inativar: inativados.length, sem_chave: plano.sem_chave }),
  });
}

/** `POST .../cargas/:cadastro/validar`: só lê (modo `validar` do `executarCarga`), com o efeito previsto do Substituir tudo. */
export async function validarCargaPortal(deps: Dependencias, c: ContextoRota, e: EntradaCargaPortal): Promise<ValidarCargaPlataformaResposta> {
  const cadastro = CadastroCargaPortal.parse(e.cadastro);
  exigirModoPermitido(cadastro, e.modo);
  const arquivo = arquivoDoCadastro(e);
  const rel = await executarCarga(deps, c, 'validar', [arquivo], ENTIDADE_DO_PIPELINE[cadastro]);
  const res = resultadoDoCadastro(rel, cadastro);
  const prontas = res.inseridas + res.atualizadas + res.sem_mudanca;
  const lista = rel.erros.map((x) => ({ linha: x.linha, motivo: x.motivo, acao: x.linha === null ? ACAO_ARQUIVO : ACAO_LINHA }));
  const linhas = lista.slice(0, LIMITE_LINHAS_ERRO_VALIDACAO);
  const comErro = res.situacao === 'processado' ? res.recusadas : Math.max(1, res.lidas);
  let efeito: EfeitoSubstituir | undefined;
  if (e.modo === 'substituir_tudo') {
    const p = await planejar(deps, c, cadastro, arquivo);
    efeito = efeitoSubstituir({ total: p.total, a_inativar: p.plano.inativar.length, sem_chave: p.plano.sem_chave });
  }
  return ValidarCargaPlataformaResposta.parse({
    cadastro, modo: e.modo, prontas, com_erro: Math.max(comErro, linhas.length > 0 ? 1 : 0),
    linhas, linhas_omitidas: Math.max(0, lista.length + rel.erros_omitidos - linhas.length), ...(efeito ? { efeito } : {}),
  });
}

/**
 * RF-CAD-11: os erros do arquivo para o CSV do `erros` (linha, campo, código e motivo; nunca o valor da célula, D9). Roda o
 * mesmo `executarCarga` em `validar` do `validarCargaPortal`, sem gravar nada; os erros vêm do relatório (até o teto dele).
 */
export async function errosCargaPortal(deps: Dependencias, c: ContextoRota, e: EntradaCargaPortal): Promise<ErroCarga[]> {
  const cadastro = CadastroCargaPortal.parse(e.cadastro);
  const rel = await executarCarga(deps, c, 'validar', [arquivoDoCadastro(e)], ENTIDADE_DO_PIPELINE[cadastro]);
  return rel.erros;
}

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
 *   conta em `mantidos_em_uso` (o histórico fica). A inativação e os eventos ficam no
 *   `carga-substituir.ts`; a forma vive na condição e o estoque é saldo, não cadastro: não têm o que inativar.
 * - Nada de valor de célula nem dado pessoal em erro ou aviso: só contagens.
 */
import {
  ArquivoRecebido, CadastroCargaPortal, ErroApi, FRASE_SUBSTITUIR_TUDO, GravarCargaPlataformaResposta, LIMITE_LINHAS_ERRO_VALIDACAO,
  MENSAGENS_CARGA_PORTAL, MENSAGEM_FRASE_SUBSTITUIR, MENSAGEM_SUBSTITUIR_NAO_PERMITIDO, ValidarCargaPlataformaResposta, efeitoSubstituir, erros, fraseConfere, substituirPermitido,
  type ContextoRota, type EfeitoSubstituir, type ModoGravarCarga,
} from '@macuxierp/platform-sdk';
import { CODIGO_FRASE_NAO_CONFERE, EntidadeCarga, type ErroCarga, type RelatorioCarga, type ResultadoEntidade } from '../contracts';
import { executarCarga } from './carga';
import { aplicarSubstituicao, planejarSubstituicao } from './carga-substituir';
import type { Dependencias } from './portas';

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
  if (frase === undefined || !fraseConfere(frase, FRASE_SUBSTITUIR_TUDO)) {
    throw erros.regra('RN-CAD-10', MENSAGEM_FRASE_SUBSTITUIR, { frase: MENSAGEM_FRASE_SUBSTITUIR }, { codigo: CODIGO_FRASE_NAO_CONFERE });
  }
}

/** `substituir_tudo` só onde o SDK permite (o estoque só aceita o Adicionar): 400 `VALIDACAO` no campo `modo`. */
function exigirModoPermitido(cadastro: CadastroCargaPortal, modo: ModoGravarCarga): void {
  if (modo === 'substituir_tudo' && !substituirPermitido(cadastro)) throw erros.validacao({ modo: MENSAGEM_SUBSTITUIR_NAO_PERMITIDO });
}

const arquivoDoCadastro = (e: EntradaCargaPortal, entidade: EntidadeCarga): ArquivoRecebido => new ArquivoRecebido(e.arquivo.campo, `${entidade}.csv`, e.arquivo.tipo, e.arquivo.conteudo());

/** A entidade da carga do cadastro do portal (400 `VALIDACAO` se o nome não é de nenhuma). */
function entidadeDe(cadastro: string): EntidadeCarga {
  const e = EntidadeCarga.safeParse(cadastro);
  if (!e.success) throw erros.validacao({ cadastro: 'Cadastro desconhecido' });
  return e.data;
}

/**
 * O plano do Substituir tudo, calculado UMA vez, sobre os existentes de ANTES da gravação (`planejarSubstituicao`: os que voltam
 * no arquivo têm o external_id nele e não entram; os sem external_id só contam em `sem_chave`). O "em uso" só olha o que será inativado.
 */
function planejar(deps: Dependencias, c: ContextoRota, cadastro: CadastroCargaPortal, entidade: EntidadeCarga, a: ArquivoRecebido) {
  const emUso = async (ids: readonly string[]): Promise<ReadonlySet<string>> =>
    deps.usoCadastros ? new Set((await deps.usoCadastros.emUso(c.tx, cadastro, ids)).keys()) : new Set<string>();
  return planejarSubstituicao(deps, c, entidade, a, emUso);
}

function resultadoDoCadastro(rel: RelatorioCarga, entidade: EntidadeCarga): ResultadoEntidade {
  const r = rel.entidades.find((e) => e.entidade === entidade);
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
  const entidade = entidadeDe(cadastro);

  const arquivo = arquivoDoCadastro(e, entidade);
  const previsto = substituir ? await planejar(deps, c, cadastro, entidade, arquivo) : null; // antes da gravação: sobre os existentes de agora
  const rel = await executarCarga(deps, c, 'gravar', [arquivo], entidade);
  const res = resultadoDoCadastro(rel, entidade);
  const gravadas = res.inseridas + res.atualizadas + res.sem_mudanca;
  if (res.situacao !== 'processado' || gravadas === 0) throw conflito(MENSAGENS_CARGA_PORTAL.nadaAGravar, 'nada_a_gravar');
  if (!substituir) return GravarCargaPlataformaResposta.parse({ cadastro, modo: e.modo, gravadas, com_erro: res.recusadas });

  const { plano, total } = previsto!;
  const { inativados, enderecos_inativados: enderecos } = await aplicarSubstituicao(deps, c, entidade, previsto!);
  if (plano.sem_chave > 0) res.avisos.push(`${plano.sem_chave} ativo(s) sem external_id: não foram inativados`);
  if (plano.mantidos_em_uso > 0) res.avisos.push(`${plano.mantidos_em_uso} inativado(s) em uso: ficam no histórico`);
  res.inativadas = inativados.length;
  const doCliente = entidade === 'cliente' ? { enderecos_inativados: enderecos.length } : undefined; // só o cliente tem endereços: nos demais cadastros as chaves nem existem
  if (doCliente) res.enderecos_inativados = doCliente.enderecos_inativados;
  res.sem_chave = plano.sem_chave;
  return GravarCargaPlataformaResposta.parse({
    cadastro, modo: e.modo, gravadas, com_erro: res.recusadas, inativadas: inativados.length,
    ...doCliente,
    efeito: efeitoSubstituir({
      total, a_inativar: inativados.length, sem_chave: plano.sem_chave,
      ...(doCliente && { enderecos_a_inativar: plano.enderecos_inativar.length }),
    }),
  });
}

/** `POST .../cargas/:cadastro/validar`: só lê (modo `validar` do `executarCarga`), com o efeito previsto do Substituir tudo. */
export async function validarCargaPortal(deps: Dependencias, c: ContextoRota, e: EntradaCargaPortal): Promise<ValidarCargaPlataformaResposta> {
  const cadastro = CadastroCargaPortal.parse(e.cadastro);
  exigirModoPermitido(cadastro, e.modo);
  const entidade = entidadeDe(cadastro);
  const arquivo = arquivoDoCadastro(e, entidade);
  const rel = await executarCarga(deps, c, 'validar', [arquivo], entidade);
  const res = resultadoDoCadastro(rel, entidade);
  const prontas = res.inseridas + res.atualizadas + res.sem_mudanca;
  const lista = rel.erros.map((x) => ({ linha: x.linha, motivo: x.motivo, acao: x.linha === null ? ACAO_ARQUIVO : ACAO_LINHA }));
  const linhas = lista.slice(0, LIMITE_LINHAS_ERRO_VALIDACAO);
  const comErro = res.situacao === 'processado' ? res.recusadas : Math.max(1, res.lidas);
  let efeito: EfeitoSubstituir | undefined;
  if (e.modo === 'substituir_tudo') {
    const p = await planejar(deps, c, cadastro, entidade, arquivo);
    efeito = efeitoSubstituir({
      total: p.total, a_inativar: p.plano.inativar.length, sem_chave: p.plano.sem_chave,
      ...(entidade === 'cliente' ? { enderecos_a_inativar: p.plano.enderecos_inativar.length } : {}),
    });
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
  const entidade = entidadeDe(cadastro);
  const rel = await executarCarga(deps, c, 'validar', [arquivoDoCadastro(e, entidade)], entidade);
  return rel.erros;
}

/**
 * Plugin de plataforma do core: rotas de empresa do portal `/config` (`/v1/plataforma/empresas*`, ADR 0012, seção 2).
 * Ordem de checagem: ver apps/api/src/plataforma/rotas.ts. As funções da 0033 e da 0035 gravam a auditoria com o
 * `superadmin_id` (por isso nenhuma rota chama `auditar`).
 * Sem perfil e sem licença de tenant; nada de dado de negócio. Logs nunca recebem corpo, e-mail, nome nem senha.
 *
 * Senha provisória (1º admin e redefinição): só na resposta, uma vez, com `CABECALHOS_SENHA_PROVISORIA`. As duas rotas
 * exigem Idempotency-Key; a apps/api conclui a chave sem guardar o corpo quando a resposta traz `no-store`
 * (`idem_plataforma_concluir` com resposta NULL) e o reenvio da mesma chave volta 409 (clique duplo não gera duas senhas).
 * E-mail do 1º admin: mascarado no GET (pelo banco); o completo só no POST .../primeiro-admin/email, com no-store e sem idempotência (nada a guardar).
 */
import { randomBytes } from 'node:crypto';
import {
  AlterarModulosEntrada,
  CABECALHOS_SENHA_PROVISORIA,
  ConsultaLista,
  conferirModulosPlataforma,
  codigoDaEmpresa,
  CriarEmpresaEntrada,
  definirPluginPlataforma,
  definirRotaPlataforma,
  erros,
  paginar,
  PrimeiroAdminEntrada,
  SituacaoEmpresaEntrada,
  type DependenciasModulo,
  type EmailPrimeiroAdminResposta,
  type EmpresaPlataforma,
  type Licenca,
  type LicencaModuloPlataforma,
  type PluginPlataforma,
  type PrimeiroAdminResposta,
  type Transacao,
  type Violacao,
  uuidDaRota,
} from '@macuxierp/platform-sdk';
import {
  CampoContato,
  EdicaoFicha,
  Id,
  MENSAGENS_BLOQUEIO_CNPJ,
  PREFIXO_ROTAS_PLATAFORMA,
  ROTAS_FICHA,
  type MotivoBloqueioCnpj,
  TrocaCnpj,
  type ContatoRevelado,
  type FichaReceitaPlana,
  type FichaReceitaPlanaMascarada,
  type PreviaReceita,
  type ResultadoReceitaPlana,
  type ResultadoSalvarFicha,
  type ResultadoTrocaCnpj,
  UsuarioConfigCriar,
  UsuarioConfigEditar,
  ROTAS_USUARIOS_CONFIG,
  type ListaUsuariosConfig,
  type UsuarioConfig,
  type UsuarioConfigComSenha,
  type UsuarioExcluido,
} from '../contracts';
import {
  acoesDoUsuario,
  avaliarAlteracaoUsuario,
  avaliarPrimeiroAdmin,
  avaliarRedefinirSenhaPrimeiroAdmin,
  aplicarEdicao,
  avaliarSituacaoEmpresa,
  avaliarTrocaCnpj,
  cnpjParaConferirUso,
  gerarSenhaProvisoria,
  MENSAGEM_SEM_CNPJ,
  mensagemDaFalhaReceita,
  situacaoTrocaCnpj,
  prepararFichaDaConsulta,
  previaDaConsulta,
  type ResultadoConsultaReceita,
} from '../domain';

type NovaSituacao = SituacaoEmpresaEntrada['situacao'];

/** Item do banco (`plataforma.usuario_json`, 0078): a linha da Config sem as `acoes`, que a API calcula pelo domain. */
export type ItemUsuarioBanco = Omit<UsuarioConfig, 'acoes'>;
export type AcaoSituacaoUsuario = 'inativar' | 'reativar' | 'excluir';

/** Porta das funções da 0033 e 0035 (lista fechada). O adaptador SQL chama só `plataforma.empresa_*` e `empresas_listar`. */
export interface RepositorioPlataforma {
  listarEmpresas(tx: Transacao, p: { busca?: string; cursor?: string; limite: number }): Promise<EmpresaPlataforma[]>;
  lerEmpresa(tx: Transacao, id: string): Promise<EmpresaPlataforma | null>;
  /** `null` = código/slug já usado. Slug nulo: o banco sorteia pela UF (0037). */
  criarEmpresa(tx: Transacao, p: { slug: string | null; uf: string | null; nome: string; fuso: string; request_id: string }): Promise<EmpresaPlataforma | null>;
  alterarSituacao(tx: Transacao, p: { id: string; situacao: NovaSituacao; motivo: string; request_id: string }): Promise<EmpresaPlataforma>;
  alterarModulos(tx: Transacao, p: { id: string; modulos: Licenca[]; request_id: string }): Promise<EmpresaPlataforma>;
  /** `null` = a empresa ganhou administrador ou o e-mail já está em uso (corrida entre pedidos: unique_violation). */
  criarPrimeiroAdmin(tx: Transacao, p: { id: string; email: string; nome: string; senha_hash: string; request_id: string }): Promise<{ usuario_id: string } | null>;
  redefinirSenhaPrimeiroAdmin(tx: Transacao, p: { id: string; senha_hash: string; request_id: string }): Promise<{ usuario_id: string }>;
  /** E-mail completo do 1º admin; a função da 0035 audita só a ação (sem o e-mail). */
  revelarEmailPrimeiroAdmin(tx: Transacao, p: { id: string; request_id: string }): Promise<string>;
  /** `empresa_ler` com a chave `ficha` (0063): a ficha já vem mascarada do banco; `null` sem `core.empresa`. */
  lerEmpresaComFicha(tx: Transacao, id: string): Promise<{ empresa: EmpresaPlataforma; ficha: FichaReceitaPlanaMascarada | null } | null>;
  /** Junta a descrição do CNAE e o nome do município (0066) à ficha mascarada que vai na resposta. */
  descreverFicha(tx: Transacao, ficha: FichaReceitaPlanaMascarada): Promise<FichaReceitaPlanaMascarada>;
  /** `empresa_gravar_receita`: `alterados` são só nomes de coluna. Sem `core.empresa` (55000) = 409. */
  gravarReceita(tx: Transacao, p: { id: string; ficha: FichaReceitaPlana; request_id: string }): Promise<{ ficha: FichaReceitaPlanaMascarada | null; alterados: string[] }>;
  /** `empresa_contato_revelar`: o valor completo; a função audita só o campo. Sem o dado (P0002) = 404. */
  revelarContato(tx: Transacao, p: { id: string; campo: CampoContato; request_id: string }): Promise<string>;
  /**
   * RN-CORE-16, `plataforma.empresa_salvar_ficha(uuid, jsonb, text)`: `ficha` é a FichaReceitaPlana direta (email/telefone
   * ausentes = mantém). O BANCO calcula os `alterados` (só nomes) e audita só eles e a contagem; `alterados` vazio = nada
   * gravado nem auditado. Sem `core.empresa` (55000) = 409.
   */
  salvarFicha(tx: Transacao, p: { id: string; ficha: FichaReceitaPlana; request_id: string }): Promise<{ ficha: FichaReceitaPlanaMascarada | null; alterados: string[] }>;
  /**
   * RN-CORE-16, `plataforma.empresa_trocar_cnpj(uuid, text, text)`: troca o CNPJ da empresa e audita só a ação, sem o CNPJ.
   * O evento sai na empresa_trocar_cnpj (0077), mesma transação; o cadastros consome e atualiza a filial padrão
   * (RN-CORE-14). Devolve `event_id`. Bloqueios do banco (23514, MXC05, MXC06, 23505) voltam como `bloqueado`; P0002 = 404 e 55000 = 409.
   */
  trocarCnpj(tx: Transacao, p: { id: string; cnpj: string; request_id: string }): Promise<{ cnpj: string; event_id: string } |{ bloqueado: MotivoBloqueioCnpj }>;
  /** RN-CORE-16: outra empresa viva (não excluída, fora a de referência) já usa o CNPJ. Só leitura, sem auditoria; o banco confere de novo na troca (23505). */
  cnpjEmUso(tx: Transacao, p: { id: string; cnpj: string }): Promise<boolean>;
  /**
   * Usuários da empresa (0078, RN-CORE-01 e RN-CORE-17): e-mail só mascarado; o banco audita só a ação e os nomes de campo.
   * Erros já em HTTP: P0002 = 404, MXU01 = 422 (RN-CORE-01), 23505 = 409 (e-mail em uso), 23514 = 422.
   */
  listarUsuarios(tx: Transacao, id: string): Promise<ItemUsuarioBanco[]>;
  criarUsuario(tx: Transacao, p: { id: string; email: string; nome: string; perfil: string; senha_hash: string; filial_ids: readonly string[]; request_id: string }): Promise<ItemUsuarioBanco>;
  editarUsuario(tx: Transacao, p: { id: string; usuario: string; patch: UsuarioConfigEditar; request_id: string }): Promise<ItemUsuarioBanco>;
  redefinirSenhaUsuario(tx: Transacao, p: { id: string; usuario: string; senha_hash: string; request_id: string }): Promise<ItemUsuarioBanco>;
  /** Inativar (reversível), Reativar e Excluir (deleted_at); no excluir, `situacao` = 'excluido'. */
  mudarSituacaoUsuario(tx: Transacao, p: { id: string; usuario: string; acao: AcaoSituacaoUsuario; request_id: string }): Promise<ItemUsuarioBanco | UsuarioExcluido>;
}

/** Porta de consulta de CNPJ dos cadastros (`ConsultaCnpjParaCore`, RF-CAD-02), declarada de forma estrutural: a apps/api liga uma na outra. */
export interface ConsultaReceita {
  consultar(tx: Transacao, tenant: string, cnpj: string): Promise<ResultadoConsultaReceita>;
}

/**
 * RN-CORE-16: porta do faturamento (a apps/api liga uma na outra; o core não importa o módulo). Abre a própria transação
 * do tenant (RLS); quem chama não abre outra. Responde se a empresa tem NF-e autorizada em PRODUÇÃO (homologação não conta).
 */
export interface ConsultaNfeProducao {
  temNfeAutorizadaEmProducao(tenantId: string): Promise<boolean>;
}

export interface DependenciasPlataformaCore {
  repo: RepositorioPlataforma;
  /** Sem a porta, "Atualizar pela Receita" (e a prévia) responde 503 (a ficha existente não muda). */
  consultaReceita?: ConsultaReceita;
  /** RN-CORE-16. Mesmo padrão da `consultaReceita`: porta ausente = 503 de configuração (falha fechada: o CNPJ não troca). */
  consultaNfeProducao?: ConsultaNfeProducao;
  /** Log da apps/api (só `warn`, sem dado pessoal): falha da consulta de NF-e na situação da troca de CNPJ. */
  log?: { warn(dados: Record<string, unknown>, mensagem: string): void };
  /** Os `depende` dos manifestos reais (a apps/api passa `manifestos`); o core não importa outro módulo. */
  manifestos: readonly DependenciasModulo[];
  hashSenha(senha: string): Promise<string>;
  aleatorios?: (n: number) => Uint8Array;
}

function idDoParam(params: Record<string, string>): string {
  const r = Id.safeParse(params.id);
  if (!r.success) throw erros.validacao({ id: 'UUID inválido' });
  return r.data;
}

/** Violação do domain vira erro: RN em 422 (`erros.regra`), o resto em 409. */
function recusar(v: readonly Violacao[]): void {
  const [primeira] = v;
  if (!primeira) return;
  const campos = Object.fromEntries(v.map((x) => [x.campo, x.mensagem]));
  throw primeira.rn.startsWith('RN-') ? erros.regra(primeira.rn, primeira.mensagem, campos) : erros.conflito(primeira.mensagem);
}

/** Licença do contrato (instante ISO) para a do SDK (`Date`), que o `conferirModulosPlataforma` e o adaptador usam. */
const paraLicencas = (ms: readonly LicencaModuloPlataforma[]): Licenca[] =>
  ms.map((m) => ({ modulo: m.modulo, ativo: m.ativo, valido_ate: m.valido_ate ? new Date(m.valido_ate) : null }));

/** RN-CORE-11: o código do FDV vem do slug quando o banco não o devolve. */
const comCodigo = (e: EmpresaPlataforma): EmpresaPlataforma => ({ ...e, codigo: e.codigo ?? codigoDaEmpresa(e.slug) });

/** Caminho de `ROTAS_FICHA` e `ROTAS_USUARIOS_CONFIG` (com o prefixo do portal) no formato do plugin, que registra sem o prefixo. */
export const semPrefixoPortal = (r: { caminho: string }) => r.caminho.slice(PREFIXO_ROTAS_PLATAFORMA.length);

/** A linha da Config: o item do banco com as ações do menu (52 A), calculadas pelo domain (RN-CORE-01, RN-CORE-17). */
const linhaUsuarioConfig = (u: ItemUsuarioBanco): UsuarioConfig => ({ ...u, acoes: acoesDoUsuario(u) });

/** Resposta de dado da empresa (ficha e contato): nunca em cache do navegador nem de proxy. */
const semCache = <T>(corpo: T) => ({ corpo, cabecalhos: { ...CABECALHOS_SENHA_PROVISORIA } });

export function criarPluginPlataformaCore(deps: DependenciasPlataformaCore): PluginPlataforma {
  const { repo } = deps;
  const aleatorios = deps.aleatorios ?? ((n: number) => randomBytes(n));
  const empresaOuErro = async (tx: Transacao, params: Record<string, string>) => {
    const e = await repo.lerEmpresa(tx, idDoParam(params));
    if (!e) throw erros.naoEncontrado('Empresa');
    return comCodigo(e);
  };
  const senhaProvisoria = async () => {
    const senha = gerarSenhaProvisoria(aleatorios(256));
    return { senha, senha_hash: await deps.hashSenha(senha) };
  };

  return definirPluginPlataforma([
    definirRotaPlataforma({
      metodo: 'GET',
      caminho: '/empresas',
      acao: 'plataforma.empresa.ver',
      consulta: ConsultaLista,
      async executar(c, { consulta }) {
        const linhas = await repo.listarEmpresas(c.tx, { busca: consulta.busca, cursor: consulta.cursor, limite: consulta.limite + 1 });
        return { corpo: paginar(linhas.map(comCodigo), consulta.limite) };
      },
    }),
    definirRotaPlataforma({
      metodo: 'GET',
      caminho: '/empresas/:id',
      acao: 'plataforma.empresa.ver',
      async executar(c, { params }) {
        return { corpo: await empresaOuErro(c.tx, params) };
      },
    }),
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: '/empresas',
      acao: 'plataforma.empresa.criar',
      corpo: CriarEmpresaEntrada,
      idempotencia: 'obrigatoria',
      async executar(c, { corpo }) {
        const criada = await repo.criarEmpresa(c.tx, { slug: corpo.slug, uf: corpo.uf, nome: corpo.nome, fuso: corpo.fuso, request_id: c.request_id });
        if (!criada) throw erros.conflito(corpo.slug === null ? 'Não há código livre para esta UF' : 'Já existe empresa com este código');
        return { status: 201, corpo: comCodigo(criada) };
      },
    }),
    definirRotaPlataforma({
      metodo: 'PUT',
      caminho: '/empresas/:id/modulos',
      acao: 'plataforma.modulos.alterar',
      corpo: AlterarModulosEntrada,
      async executar(c, { corpo, params }) {
        const e = await empresaOuErro(c.tx, params);
        const mudancas = paraLicencas(corpo.modulos);
        // RN-CORE-02: o faturamento exige o fiscal, ao ligar e ao desligar (a API revalida antes da função gravar).
        recusar(conferirModulosPlataforma(paraLicencas(e.modulos), mudancas, deps.manifestos, c.agora));
        return { corpo: comCodigo(await repo.alterarModulos(c.tx, { id: e.id, modulos: mudancas, request_id: c.request_id })) };
      },
    }),
    definirRotaPlataforma({
      metodo: 'PUT',
      caminho: '/empresas/:id/situacao',
      acao: 'plataforma.empresa.situacao',
      corpo: SituacaoEmpresaEntrada,
      async executar(c, { corpo, params }) {
        const e = await empresaOuErro(c.tx, params);
        const r = avaliarSituacaoEmpresa({ atual: e.situacao, nova: corpo.situacao });
        recusar(r.violacoes);
        if (!r.mudou) return { corpo: e };
        return { corpo: comCodigo(await repo.alterarSituacao(c.tx, { id: e.id, situacao: corpo.situacao, motivo: corpo.motivo, request_id: c.request_id })) };
      },
    }),
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: '/empresas/:id/primeiro-admin',
      acao: 'plataforma.admin.criar',
      idempotencia: 'obrigatoria',
      corpo: PrimeiroAdminEntrada,
      async executar(c, { corpo, params }) {
        const e = await empresaOuErro(c.tx, params);
        const v = avaliarPrimeiroAdmin(e);
        const jaTem = v.find((x) => x.campo === 'primeiro_admin');
        if (jaTem) throw erros.conflito(jaTem.mensagem);
        recusar(v);
        const { senha, senha_hash } = await senhaProvisoria();
        const criado = await repo.criarPrimeiroAdmin(c.tx, { id: e.id, email: corpo.email, nome: corpo.nome, senha_hash, request_id: c.request_id });
        if (!criado) throw erros.conflito('A empresa já tem administrador ou o e-mail já está em uso');
        const resposta: PrimeiroAdminResposta = { usuario_id: criado.usuario_id, senha_provisoria: senha };
        return { status: 201, corpo: resposta, cabecalhos: { ...CABECALHOS_SENHA_PROVISORIA } };
      },
    }),
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: '/empresas/:id/primeiro-admin/senha',
      acao: 'plataforma.admin.redefinir_senha',
      idempotencia: 'obrigatoria',
      async executar(c, { params }) {
        const e = await empresaOuErro(c.tx, params);
        recusar(avaliarRedefinirSenhaPrimeiroAdmin(e));
        const { senha, senha_hash } = await senhaProvisoria();
        const { usuario_id } = await repo.redefinirSenhaPrimeiroAdmin(c.tx, { id: e.id, senha_hash, request_id: c.request_id });
        const resposta: PrimeiroAdminResposta = { usuario_id, senha_provisoria: senha };
        return { corpo: resposta, cabecalhos: { ...CABECALHOS_SENHA_PROVISORIA } };
      },
    }),
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: '/empresas/:id/primeiro-admin/email',
      acao: 'plataforma.admin.revelar_email',
      async executar(c, { params }) {
        const e = await empresaOuErro(c.tx, params);
        if (!e.primeiro_admin) throw erros.naoEncontrado('Administrador');
        const resposta: EmailPrimeiroAdminResposta = { email: await repo.revelarEmailPrimeiroAdmin(c.tx, { id: e.id, request_id: c.request_id }) };
        return { corpo: resposta, cabecalhos: { ...CABECALHOS_SENHA_PROVISORIA } };
      },
    }),
    // Ficha da Receita (T-0101, ADR 0012 emenda): as duas gravam a auditoria no banco só com nomes de campo; sem idempotência
    // (a repetição do request_id não muda nada no banco) e com no-store (a resposta é dado da empresa).
    // Por etapa: o papel de plataforma (macuxierp_config) não tem acesso às tabelas do cadastros; a consulta de CNPJ lê e
    // grava o cache do tenant (RLS) e por isso roda no papel e na RLS do tenant, entre duas etapas de plataforma.
    /** @deprecated RN-CORE-16 (v0.3.24): GRAVA ao atualizar. A tela nova usa POST .../ficha/receita (prévia, não grava) + PUT .../ficha (Salvar). Mantida para a tela atual até a troca. */
    definirRotaPlataforma({
      transacoes: 'por_etapa',
      metodo: 'POST',
      caminho: '/empresas/:id/receita',
      acao: 'plataforma.empresa.atualizar_receita',
      async executar(c, { params }) {
        const id = idDoParam(params);
        const atual = await c.comPlataforma((tx) => repo.lerEmpresaComFicha(tx, id));
        if (!atual) throw erros.naoEncontrado('Empresa');
        const cnpj = atual.empresa.cnpj;
        if (!atual.ficha || !cnpj) throw erros.conflito(MENSAGEM_SEM_CNPJ);
        const porta = deps.consultaReceita;
        if (!porta) throw erros.indisponivel('Consulta de CNPJ');
        const resposta = await c.comTenant(id, (tx) => porta.consultar(tx, id, cnpj));
        const preparo = prepararFichaDaConsulta({ cnpj, resposta });
        // Campo acima do limite: 422, nada gravado e a mensagem não leva o valor (RN-CORE-14, T-0101).
        if (!preparo.ok && preparo.motivo === 'campo_acima_do_limite') {
          throw erros.regra('RN-CORE-14', mensagemDaFalhaReceita(preparo.motivo), { ficha: 'Campo acima do limite' });
        }
        if (!preparo.ok) {
          const anterior = atual.ficha;
          const ficha = await c.comPlataforma((tx) => repo.descreverFicha(tx, anterior));
          const falha: ResultadoReceitaPlana = { estado: 'erro', motivo: preparo.motivo, mensagem: mensagemDaFalhaReceita(preparo.motivo), ficha };
          return semCache(falha);
        }
        const gravada = await c.comPlataforma((tx) => repo.gravarReceita(tx, { id, ficha: preparo.ficha, request_id: c.request_id }));
        const ok: ResultadoReceitaPlana = { estado: 'ok', campos_alterados: gravada.alterados, ficha: gravada.ficha };
        return semCache(ok);
      },
    }),
    // RN-CORE-16 (v0.3.24): Ficha editável. Salvar usa 'salvar_ficha'; situação e troca do CNPJ usam 'trocar_cnpj'; a prévia da Receita segue 'atualizar_receita'.
    definirRotaPlataforma({
      metodo: ROTAS_FICHA.salvar.metodo,
      caminho: semPrefixoPortal(ROTAS_FICHA.salvar),
      acao: 'plataforma.empresa.salvar_ficha',
      corpo: EdicaoFicha,
      async executar(c, { corpo, params }) {
        const id = idDoParam(params);
        const atual = await repo.lerEmpresaComFicha(c.tx, id);
        if (!atual) throw erros.naoEncontrado('Empresa');
        if (!atual.ficha) throw erros.conflito(MENSAGEM_SEM_CNPJ);
        const { ficha } = aplicarEdicao(atual.ficha, corpo, c.agora);
        // Sempre vai ao banco: a ficha lida é mascarada e sem a razão social, então só a empresa_salvar_ficha compara com a
        // ficha completa (razão social, contato novo com a mesma máscara). Sem alterados, ela não grava nem audita.
        const r = await repo.salvarFicha(c.tx, { id, ficha, request_id: c.request_id });
        if (r.alterados.length === 0) {
          const sem: ResultadoSalvarFicha = { estado: 'sem_mudanca', ficha: await repo.descreverFicha(c.tx, atual.ficha) };
          return semCache(sem);
        }
        if (!r.ficha) throw erros.conflito(MENSAGEM_SEM_CNPJ);
        const ok: ResultadoSalvarFicha = { estado: 'ok', campos_alterados: r.alterados, ficha: r.ficha };
        return semCache(ok);
      },
    }),
    // Prévia da Receita: consulta como a rota antiga, mas NÃO grava; devolve a prévia mascarada e os campos diferentes do salvo.
    definirRotaPlataforma({
      transacoes: 'por_etapa',
      metodo: ROTAS_FICHA.previaReceita.metodo,
      caminho: semPrefixoPortal(ROTAS_FICHA.previaReceita),
      acao: 'plataforma.empresa.atualizar_receita',
      async executar(c, { params }) {
        const id = idDoParam(params);
        const atual = await c.comPlataforma((tx) => repo.lerEmpresaComFicha(tx, id));
        if (!atual) throw erros.naoEncontrado('Empresa');
        const cnpj = atual.empresa.cnpj;
        if (!atual.ficha || !cnpj) throw erros.conflito(MENSAGEM_SEM_CNPJ);
        const porta = deps.consultaReceita;
        if (!porta) throw erros.indisponivel('Consulta de CNPJ');
        const resposta = await c.comTenant(id, (tx) => porta.consultar(tx, id, cnpj));
        const preparo = prepararFichaDaConsulta({ cnpj, resposta });
        if (!preparo.ok && preparo.motivo === 'campo_acima_do_limite') {
          throw erros.regra('RN-CORE-16', mensagemDaFalhaReceita(preparo.motivo), { ficha: 'Campo acima do limite' });
        }
        if (!preparo.ok) {
          const falha: PreviaReceita = { estado: 'erro', motivo: preparo.motivo, mensagem: mensagemDaFalhaReceita(preparo.motivo) };
          return semCache(falha);
        }
        const { previa, diferentes } = previaDaConsulta(atual.ficha, preparo.ficha);
        const descrita = await c.comPlataforma((tx) => repo.descreverFicha(tx, previa));
        const ok: PreviaReceita = { estado: 'ok', previa: descrita, diferentes, fonte: preparo.ficha.fonte, consultado_em: preparo.ficha.consultado_em };
        return semCache(ok);
      },
    }),
    // Situação da troca de CNPJ (RN-CORE-16): a tela sabe antes de tentar. Fica fora do GET do detalhe porque a consulta de NF-e
    // exige a transação do tenant e só a rota por etapa (`/empresas/:id/...`) a tem. Porta ausente ou falha = indisponível.
    definirRotaPlataforma({
      transacoes: 'por_etapa',
      metodo: ROTAS_FICHA.situacaoCnpj.metodo,
      caminho: semPrefixoPortal(ROTAS_FICHA.situacaoCnpj),
      acao: 'plataforma.empresa.trocar_cnpj',
      async executar(c, { params }) {
        const id = idDoParam(params);
        const atual = await c.comPlataforma((tx) => repo.lerEmpresa(tx, id));
        if (!atual) throw erros.naoEncontrado('Empresa');
        if (!atual.cnpj) throw erros.conflito(MENSAGEM_SEM_CNPJ);
        const porta = deps.consultaNfeProducao;
        let temNfe: boolean | null = null;
        // Falha = indisponível; o log leva só o tipo do erro.
        if (porta) {
          temNfe = await porta.temNfeAutorizadaEmProducao(id).catch((e: unknown) => {
            deps.log?.warn({ modulo: 'core', request_id: c.request_id, erro: e instanceof Error ? e.name : 'desconhecido' }, 'consulta de NF-e em produção falhou; troca de CNPJ indisponível');
            return null;
          });
        }
        return semCache(situacaoTrocaCnpj(temNfe));
      },
    }),
    // Troca de CNPJ (só superadmin: todas as rotas de plataforma exigem a sessão dele): a API revalida com o domínio e a porta do faturamento.
    definirRotaPlataforma({
      transacoes: 'por_etapa',
      metodo: ROTAS_FICHA.trocarCnpj.metodo,
      caminho: semPrefixoPortal(ROTAS_FICHA.trocarCnpj),
      acao: 'plataforma.empresa.trocar_cnpj',
      corpo: TrocaCnpj,
      async executar(c, { corpo, params }) {
        const id = idDoParam(params);
        const porta = deps.consultaNfeProducao;
        // Lê a empresa e confere o uso do CNPJ novo na mesma etapa.
        const lido = await c.comPlataforma(async (tx) => {
          const atual = await repo.lerEmpresa(tx, id);
          if (!atual) throw erros.naoEncontrado('Empresa');
          if (!atual.cnpj) throw erros.conflito(MENSAGEM_SEM_CNPJ);
          if (!porta) throw erros.indisponivel('Consulta de NF-e em produção');
          const alvo = cnpjParaConferirUso(atual.cnpj, corpo.cnpj_novo);
          return { atualCnpj: atual.cnpj, nfe: porta, emUso: alvo ? await repo.cnpjEmUso(tx, { id, cnpj: alvo }) : false };
        });
        const temNfe = await lido.nfe.temNfeAutorizadaEmProducao(id);
        const r = avaliarTrocaCnpj({
          atual: lido.atualCnpj,
          novo: corpo.cnpj_novo,
          confirmacao: corpo.confirmacao,
          superadmin: true,
          temNfeAutorizadaProducao: temNfe,
          cnpjEmUso: lido.emUso,
        });
        if (!r.ok) {
          const bloqueado: ResultadoTrocaCnpj = { estado: 'bloqueado', motivo: r.motivo, mensagem: MENSAGENS_BLOQUEIO_CNPJ[r.motivo] };
          return semCache(bloqueado);
        }
        const res = await c.comPlataforma(async (tx) => {
          // O evento sai na empresa_trocar_cnpj (0077), mesma transação; o cadastros consome e atualiza a filial padrão (RN-CORE-14).
          return repo.trocarCnpj(tx, { id, cnpj: r.cnpj, request_id: c.request_id });
        });
        if ('bloqueado' in res) {
          const bloqueado: ResultadoTrocaCnpj = { estado: 'bloqueado', motivo: res.bloqueado, mensagem: MENSAGENS_BLOQUEIO_CNPJ[res.bloqueado] };
          return semCache(bloqueado);
        }
        const ok: ResultadoTrocaCnpj = { estado: 'ok', cnpj: res.cnpj };
        return semCache(ok);
      },
    }),
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: '/empresas/:id/contato/:campo',
      acao: 'plataforma.empresa.revelar_contato',
      async executar(c, { params }) {
        const id = idDoParam(params);
        const campo = CampoContato.safeParse(params.campo);
        if (!campo.success) throw erros.validacao({ campo: 'Use email ou telefone' });
        const atual = await repo.lerEmpresaComFicha(c.tx, id);
        if (!atual) throw erros.naoEncontrado('Empresa');
        if (!atual.ficha) throw erros.conflito(MENSAGEM_SEM_CNPJ);
        // Sem o dado na ficha nada é revelado e nada é auditado: resposta vazia, como no desenho do ADR 0012.
        const mascarado = campo.data === 'email' ? atual.ficha.email_mascarado : atual.ficha.telefone_mascarado;
        const vazio: ContatoRevelado = { valor: null };
        if (!mascarado) return semCache(vazio);
        const revelado: ContatoRevelado = { valor: await repo.revelarContato(c.tx, { id, campo: campo.data, request_id: c.request_id }) };
        return semCache(revelado);
      },
    }),
    // Usuários da empresa na Config (v0.3.28, 0078). E-mail só mascarado; respostas sem cache (dado pessoal). A API revalida
    // a RN-CORE-01 pelo domain com a linha lida (ultimo_admin_ativo) e o banco confere de novo com o tenant travado (MXU01).
    definirRotaPlataforma({
      metodo: ROTAS_USUARIOS_CONFIG.listar.metodo,
      caminho: semPrefixoPortal(ROTAS_USUARIOS_CONFIG.listar),
      acao: 'plataforma.usuario.ver',
      async executar(c, { params }) {
        const lista: ListaUsuariosConfig = { itens: (await repo.listarUsuarios(c.tx, idDoParam(params))).map(linhaUsuarioConfig) };
        return semCache(lista);
      },
    }),
    definirRotaPlataforma({
      metodo: ROTAS_USUARIOS_CONFIG.criar.metodo,
      caminho: semPrefixoPortal(ROTAS_USUARIOS_CONFIG.criar),
      acao: 'plataforma.usuario.criar',
      idempotencia: 'obrigatoria',
      corpo: UsuarioConfigCriar,
      async executar(c, { corpo, params }) {
        const id = idDoParam(params);
        const { senha, senha_hash } = await senhaProvisoria();
        const u = await repo.criarUsuario(c.tx, { id, email: corpo.email, nome: corpo.nome, perfil: corpo.perfil, senha_hash, filial_ids: corpo.filial_ids, request_id: c.request_id });
        const resposta: UsuarioConfigComSenha = { usuario: linhaUsuarioConfig(u), senha_provisoria: senha };
        return { status: 201, ...semCache(resposta) };
      },
    }),
    definirRotaPlataforma({
      metodo: ROTAS_USUARIOS_CONFIG.editar.metodo,
      caminho: semPrefixoPortal(ROTAS_USUARIOS_CONFIG.editar),
      acao: 'plataforma.usuario.editar',
      corpo: UsuarioConfigEditar,
      async executar(c, { corpo, params }) {
        const id = idDoParam(params);
        const alvo = await usuarioOuErro(c.tx, id, params);
        if (corpo.perfil) exigirOutroAdmin(alvo, { perfil: corpo.perfil });
        return semCache(linhaUsuarioConfig(await repo.editarUsuario(c.tx, { id, usuario: alvo.id, patch: corpo, request_id: c.request_id })));
      },
    }),
    definirRotaPlataforma({
      metodo: ROTAS_USUARIOS_CONFIG.redefinirSenha.metodo,
      caminho: semPrefixoPortal(ROTAS_USUARIOS_CONFIG.redefinirSenha),
      acao: 'plataforma.usuario.redefinir_senha',
      idempotencia: 'obrigatoria',
      async executar(c, { params }) {
        const id = idDoParam(params);
        const { senha, senha_hash } = await senhaProvisoria();
        const u = await repo.redefinirSenhaUsuario(c.tx, { id, usuario: uuidDaRota(params, 'usuario'), senha_hash, request_id: c.request_id });
        const resposta: UsuarioConfigComSenha = { usuario: linhaUsuarioConfig(u), senha_provisoria: senha };
        return semCache(resposta);
      },
    }),
    rotaSituacaoUsuario('inativar'),
    rotaSituacaoUsuario('reativar'),
    rotaSituacaoUsuario('excluir'),
  ]);

  /** O alvo pela listagem da 0078 (a mesma leitura da tela): fora da lista = 404. */
  async function usuarioOuErro(tx: Transacao, id: string, params: Record<string, string>): Promise<ItemUsuarioBanco> {
    const usuarioId = uuidDaRota(params, 'usuario');
    const alvo = (await repo.listarUsuarios(tx, id)).find((u) => u.id === usuarioId);
    if (!alvo) throw erros.naoEncontrado('Usuário');
    return alvo;
  }

  /** Inativar (reversível), Reativar e Excluir (deleted_at), RN-CORE-17; o último administrador ativo não sai (RN-CORE-01). */
  function rotaSituacaoUsuario(acao: AcaoSituacaoUsuario) {
    return definirRotaPlataforma({
      metodo: ROTAS_USUARIOS_CONFIG[acao].metodo,
      caminho: semPrefixoPortal(ROTAS_USUARIOS_CONFIG[acao]),
      acao: `plataforma.usuario.${acao}`,
      async executar(c, { params }) {
        const id = idDoParam(params);
        const alvo = await usuarioOuErro(c.tx, id, params);
        if (acao !== 'reativar') exigirOutroAdmin(alvo, { ativo: false });
        const u = await repo.mudarSituacaoUsuario(c.tx, { id, usuario: alvo.id, acao, request_id: c.request_id });
        // O banco devolve o item completo no 1º excluir e só {id, situacao} na repetição: a resposta é sempre a curta.
        const corpo: UsuarioConfig | UsuarioExcluido = u.situacao === 'excluido' ? { id: u.id, situacao: 'excluido' } : linhaUsuarioConfig(u);
        return semCache(corpo);
      },
    });
  }
}

/**
 * RN-CORE-01 pelo domain com a linha lida: ativo e bloqueado contam como ativos; `ultimo_admin_ativo` do banco diz se há
 * outro administrador ativo (0 ou ao menos 1). Inativar e Excluir tiram dos ativos (`ativo: false`); rebaixar troca o perfil.
 */
function exigirOutroAdmin(u: ItemUsuarioBanco, alteracao: { perfil?: ItemUsuarioBanco['perfil']; ativo?: boolean }): void {
  const r = avaliarAlteracaoUsuario({
    atual: { id: u.id, perfil: u.perfil, ativo: u.situacao !== 'inativo' },
    alteracao,
    outrosAdministradoresAtivos: u.ultimo_admin_ativo ? 0 : 1,
  });
  if (!r.ok) throw erros.regra('RN-CORE-01', r.mensagem);
}

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
} from '@macuxierp/platform-sdk';
import { Id } from '../contracts';
import { avaliarPrimeiroAdmin, avaliarRedefinirSenhaPrimeiroAdmin, avaliarSituacaoEmpresa, gerarSenhaProvisoria } from '../domain';

type NovaSituacao = SituacaoEmpresaEntrada['situacao'];

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
}

export interface DependenciasPlataformaCore {
  repo: RepositorioPlataforma;
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
  ]);
}

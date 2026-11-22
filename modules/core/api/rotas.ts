/**
 * Plugin `/v1/core` (desenho T-0002, seção 3). A ordem sessão → perfil → tenant → licença é da API (`executarAutorizado`);
 * aqui cada rota declara a `acao` e REVALIDA a regra no `domain` (a API sempre revalida). Auditoria nas ações (A);
 * logs nunca recebem corpo, e-mail, senha nem `.pfx` (nenhuma rota loga).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  definirPlugin,
  definirRota,
  erros,
  paginar,
  PERFIS,
  PERMISSOES,
  type ContextoRota,
  type PluginModulo,
} from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import {
  AmbienteConsulta,
  AmbienteTrocar,
  AuditoriaConsulta,
  CertificadoEnviar,
  CertificadosConsulta,
  EmpresaEditar,
  EVENTO_AMBIENTE,
  EVENTO_CERTIFICADO,
  EVENTO_EMPRESA,
  EVENTO_USUARIO,
  Id,
  ListaConsulta,
  ParametroChave,
  ParametroGravar,
  PFX_TAMANHO_MAXIMO,
  TRABALHO_EXPORTAR,
  UsuarioCriar,
  UsuarioEditar,
  type CertificadoResumo,
  type Empresa,
  type Exportacao,
  type Usuario,
} from '../contracts';
import { alertaVencimento, avaliarCertificado, avaliarTrocaAmbienteTenant, diasParaVencer, gerarSenhaProvisoria } from '../domain';
import { alterarUsuarioComTrava, type OpcoesAlterarUsuario } from './alterar-usuario';
import { cifrarA1 } from './cifra';
import {
  PfxInvalido,
  type DependenciasCore,
  type LinhaAmbiente,
  type LinhaCertificado,
  type LinhaEmpresa,
  type LinhaExportacao,
  type LinhaUsuario,
  type PatchUsuario,
} from './portas';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
/** Valida o parâmetro de rota com o `Id` dos contracts; 400 VALIDACAO se não for UUID. */
function idDoParam(params: Record<string, string>, nome: string): string {
  const r = Id.safeParse(params[nome]);
  if (!r.success) throw erros.validacao({ [nome]: 'UUID inválido' });
  return r.data;
}
const AMBIENTE_PADRAO = 'homologacao' as const;

function empresaDto(e: LinhaEmpresa): Empresa {
  return { id: e.id, razao_social: e.razao_social, nome_fantasia: e.nome_fantasia, cnpj: e.cnpj, ie: e.ie, fuso: e.fuso, updated_at: e.updated_at.toISOString() };
}

function usuarioDto(u: LinhaUsuario): Usuario {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    perfil: u.perfil,
    filial_ids: u.filial_ids,
    ativo: u.ativo,
    external_id: u.external_id,
    ultimo_acesso_em: iso(u.ultimo_acesso_em),
    updated_at: u.updated_at.toISOString(),
  };
}

/** Auditoria e evento do usuário: sem nome nem e-mail (dado pessoal; `.coord/contratos/eventos.md`). */
const usuarioSemPii = (u: LinhaUsuario) => ({ id: u.id, perfil: u.perfil, filial_ids: u.filial_ids, ativo: u.ativo });

function certificadoDto(c: LinhaCertificado, agora: Date): CertificadoResumo {
  return {
    id: c.id,
    filial_id: c.filial_id,
    titular: c.titular,
    cnpj: c.cnpj,
    valido_de: c.valido_de.toISOString(),
    valido_ate: c.valido_ate.toISOString(),
    impressao_digital: c.impressao_digital,
    dias_para_vencer: diasParaVencer(c.valido_ate, agora),
    alerta_vencimento: alertaVencimento(c.valido_ate, agora),
    ativo: c.ativo,
  };
}

const ambienteDto = (a: LinhaAmbiente) => ({ filial_id: a.filial_id, ambiente: a.ambiente, recado_aprovacao: a.recado_aprovacao });

const converterToken = (token: string | undefined): Date | undefined => (token === undefined ? undefined : new Date(token));
function ou409<T>(linha: T | null): T {
  if (linha === null) throw erros.conflito('O registro mudou desde a leitura: recarregue e tente de novo');
  return linha;
}

async function publicar(c: ContextoRota, nome: string, agregado_id: string, payload: Record<string, unknown>): Promise<void> {
  // `versao` do envelope = versão do agregado (o consumidor descarta a menor já aplicada): ms UTC da alteração.
  await c.publicar({ nome, agregado_id, versao: c.agora.getTime(), payload });
}

export function criarPluginCore(deps: DependenciasCore): PluginModulo {
  const { repo } = deps;
  const aleatorios = deps.aleatorios ?? ((n: number) => randomBytes(n));
  const novoId = deps.novoId ?? randomUUID;

  async function empresaOuErro(c: ContextoRota): Promise<LinhaEmpresa> {
    const e = await repo.empresa(c.tx);
    if (!e) throw erros.naoEncontrado('Empresa');
    return e;
  }

  async function usuarioOuErro(c: ContextoRota, params: Record<string, string>): Promise<LinhaUsuario> {
    const u = await repo.usuarioPorId(c.tx, idDoParam(params, 'id'));
    if (!u) throw erros.naoEncontrado('Usuário');
    return u;
  }

  /** RN-CORE-01: a sequência (trava, leitura, contagem, domain, gravação) é a de `alterarUsuarioComTrava`. */
  async function mudarUsuario(c: ContextoRota, params: Record<string, string>, patch: PatchUsuario, acao: string, opcoes: OpcoesAlterarUsuario = {}): Promise<LinhaUsuario | null> {
    const r = await alterarUsuarioComTrava(repo, c.tx, idDoParam(params, 'id'), patch, c.agora, opcoes);
    if (r.tipo === 'nao_encontrado') throw erros.naoEncontrado('Usuário');
    if (r.tipo === 'sem_mudanca') return null;
    if (r.tipo === 'recusado') throw erros.regra('RN-CORE-01', r.mensagem);
    if (r.tipo === 'conflito') return ou409<LinhaUsuario>(null);
    const { antes, depois: novo } = r;
    await c.auditar({ acao, entidade: 'usuario', entidade_id: novo.id, antes: usuarioSemPii(antes), depois: usuarioSemPii(novo) });
    await publicar(c, EVENTO_USUARIO, novo.id, usuarioSemPii(novo));
    return novo;
  }

  const rotas = [
    // Empresa (RF-CORE-01)
    definirRota({
      metodo: 'GET',
      caminho: '/empresa',
      acao: 'core.empresa.ver',
      async executar(c) {
        const e = await empresaOuErro(c);
        return { corpo: empresaDto(e), cabecalhos: { ETag: e.updated_at.toISOString() } };
      },
    }),
    definirRota({
      metodo: 'PATCH',
      caminho: '/empresa',
      acao: 'core.empresa.editar',
      corpo: EmpresaEditar,
      async executar(c, { corpo }) {
        const atual = await empresaOuErro(c);
        try {
          new Intl.DateTimeFormat('pt-BR', { timeZone: corpo.fuso });
        } catch {
          throw erros.validacao({ fuso: 'Fuso horário inválido' });
        }
        const nova = ou409(await repo.atualizarEmpresa(c.tx, { razao_social: corpo.razao_social, nome_fantasia: corpo.nome_fantasia, ie: corpo.ie, fuso: corpo.fuso }, c.agora, converterToken(corpo.updated_at)));
        await c.auditar({ acao: 'core.empresa.alterada', entidade: 'empresa', entidade_id: nova.id, antes: empresaDto(atual), depois: empresaDto(nova) });
        await publicar(c, EVENTO_EMPRESA, c.sessao.tenant_id, empresaDto(nova));
        return { corpo: empresaDto(nova), cabecalhos: { ETag: nova.updated_at.toISOString() } };
      },
    }),

    // Usuários (RF-CORE-02, RN-CORE-01)
    definirRota({
      metodo: 'GET',
      caminho: '/usuarios',
      acao: 'core.usuario.gerir',
      consulta: ListaConsulta,
      async executar(c, { consulta }) {
        const linhas = await repo.listarUsuarios(c.tx, { ...consulta, limite: consulta.limite + 1 });
        const p = paginar(linhas, consulta.limite);
        return { corpo: { itens: p.itens.map(usuarioDto), proximo_cursor: p.proximo_cursor } };
      },
    }),
    definirRota({
      metodo: 'POST',
      caminho: '/usuarios',
      acao: 'core.usuario.gerir',
      corpo: UsuarioCriar,
      async executar(c, { corpo }) {
        const email = corpo.email.trim().toLowerCase();
        // RN-CORE-05: o reenvio com o mesmo external_id devolve o usuário já criado, sem senha nova.
        if (corpo.external_id) {
          const repetido = await repo.usuarioPorExternalId(c.tx, corpo.external_id);
          if (repetido) return { status: 200, corpo: usuarioDto(repetido) };
        }
        if (await repo.usuarioPorEmail(c.tx, email)) throw erros.conflito('Já existe usuário com este e-mail');
        const senha = gerarSenhaProvisoria(aleatorios(256));
        const criado = await repo.criarUsuario(
          c.tx,
          { id: novoId(), nome: corpo.nome, email, perfil: corpo.perfil, filial_ids: corpo.filial_ids, ativo: true, external_id: corpo.external_id ?? null, senha_hash: await deps.hashSenha(senha) },
          c.agora,
        );
        await c.auditar({ acao: 'core.usuario.criado', entidade: 'usuario', entidade_id: criado.id, depois: usuarioSemPii(criado) });
        await publicar(c, EVENTO_USUARIO, criado.id, usuarioSemPii(criado));
        // A resposta carrega a senha provisória (exibida uma única vez): nunca pode ir a cache de proxy ou navegador.
        return { status: 201, corpo: { ...usuarioDto(criado), senha_provisoria: senha }, cabecalhos: { 'Cache-Control': 'no-store' } };
      },
    }),
    definirRota({
      metodo: 'GET',
      caminho: '/usuarios/:id',
      acao: 'core.usuario.gerir',
      async executar(c, { params }) {
        const u = await usuarioOuErro(c, params);
        return { corpo: usuarioDto(u), cabecalhos: { ETag: u.updated_at.toISOString() } };
      },
    }),
    definirRota({
      metodo: 'PATCH',
      caminho: '/usuarios/:id',
      acao: 'core.usuario.gerir',
      corpo: UsuarioEditar,
      async executar(c, { corpo, params }) {
        const { updated_at: token, ...patch } = corpo;
        const novo = (await mudarUsuario(c, params, patch, 'core.usuario.alterado', { token: converterToken(token) })) as LinhaUsuario;
        return { corpo: usuarioDto(novo), cabecalhos: { ETag: novo.updated_at.toISOString() } };
      },
    }),
    definirRota({
      metodo: 'DELETE',
      caminho: '/usuarios/:id',
      acao: 'core.usuario.gerir',
      async executar(c, { params }) {
        await mudarUsuario(c, params, { ativo: false }, 'core.usuario.inativado', { somenteSeAtivo: true });
        return { status: 204 };
      },
    }),
    definirRota({
      metodo: 'POST',
      caminho: '/usuarios/:id/redefinir-senha',
      acao: 'core.usuario.gerir',
      async executar(c, { params }) {
        const u = await usuarioOuErro(c, params);
        const senha = gerarSenhaProvisoria(aleatorios(256));
        await repo.definirSenha(c.tx, u.id, await deps.hashSenha(senha), c.agora);
        await c.auditar({ acao: 'core.usuario.senha_redefinida', entidade: 'usuario', entidade_id: u.id });
        return { corpo: { senha_provisoria: senha }, cabecalhos: { 'Cache-Control': 'no-store' } };
      },
    }),

    // Perfis e licenças, só leitura (RF-CORE-03, D12)
    definirRota({
      metodo: 'GET',
      caminho: '/perfis',
      acao: 'core.perfil.ver',
      async executar() {
        const itens = PERFIS.map((perfil) => ({
          perfil,
          acoes: Object.entries(PERMISSOES)
            .filter(([, perfis]) => (perfis as readonly string[]).includes(perfil))
            .map(([acao]) => acao),
        }));
        return { corpo: { itens } };
      },
    }),
    definirRota({
      metodo: 'GET',
      caminho: '/licencas',
      acao: 'core.licenca.ver',
      async executar(c) {
        const itens = (await repo.licencas(c.tx)).map((l) => ({ modulo: l.modulo, ativo: l.ativo, valido_ate: iso(l.valido_ate) }));
        return { corpo: { itens } };
      },
    }),

    // Certificado A1 (RF-CORE-04, ADR 0005, RN-CORE-06)
    definirRota({
      metodo: 'GET',
      caminho: '/certificados',
      acao: 'core.certificado.gerir',
      consulta: CertificadosConsulta,
      async executar(c, { consulta }) {
        const itens = (await repo.certificados(c.tx, consulta.filial_id)).map((x) => certificadoDto(x, c.agora));
        return { corpo: { itens } };
      },
    }),
    definirRota({
      metodo: 'POST',
      caminho: '/certificados',
      acao: 'core.certificado.gerir',
      corpo: CertificadoEnviar,
      // Multipart: filial_id e senha são campos de texto; o `.pfx` vem em `arquivo` (a API barra acima do limite com 413).
      multipart: { arquivos: [{ campo: 'arquivo', tamanhoMaximo: PFX_TAMANHO_MAXIMO }] },
      async executar(c, { corpo, arquivos }) {
        const recebido = arquivos.arquivo;
        if (!recebido) throw erros.validacao({ arquivo: 'Envie o arquivo .pfx' });
        const pfx = recebido.conteudo();
        if (pfx.length === 0) throw erros.validacao({ arquivo: 'O arquivo .pfx está vazio' });
        const empresa = await empresaOuErro(c);
        let dados;
        try {
          dados = await deps.leitorPfx.abrir(pfx, corpo.senha);
        } catch (e) {
          if (e instanceof PfxInvalido) throw erros.regra('RN-CORE-06', 'Não foi possível abrir o certificado: confira o arquivo e a senha');
          throw e;
        }
        const av = avaliarCertificado({ cnpjEmpresa: empresa.cnpj, cnpjCertificado: dados.cnpj, validoDe: dados.valido_de, validoAte: dados.valido_ate, agora: c.agora, fuso: empresa.fuso });
        if (!av.ok) throw erros.regra('RN-CORE-06', av.mensagem);
        const id = novoId();
        const cifrado = cifrarA1({ chave: deps.chaveA1, tenantId: c.sessao.tenant_id, pfx, senha: corpo.senha });
        await repo.substituirCertificado(c.tx, { id, filial_id: corpo.filial_id, ...dados, ...cifrado, chave_versao: deps.chaveVersao ?? 1 }, c.agora);
        const resumo = certificadoDto({ id, filial_id: corpo.filial_id, ...dados, ativo: true }, c.agora);
        await c.auditar({ acao: 'core.certificado.enviado', entidade: 'certificado', entidade_id: id, depois: { filial_id: resumo.filial_id, cnpj: resumo.cnpj, valido_ate: resumo.valido_ate, impressao_digital: resumo.impressao_digital } });
        await publicar(c, EVENTO_CERTIFICADO, id, { id, filial_id: resumo.filial_id, cnpj: resumo.cnpj, valido_ate: resumo.valido_ate, impressao_digital: resumo.impressao_digital, ativo: true });
        return { status: 201, corpo: resumo };
      },
    }),

    // Ambiente fiscal por filial (RN-CORE-08)
    definirRota({
      metodo: 'GET',
      caminho: '/ambientes-fiscais',
      acao: 'core.ambiente.ver',
      consulta: AmbienteConsulta,
      async executar(c, { consulta }) {
        const linhas = (await repo.ambientes(c.tx, consulta.filial_id)).map(ambienteDto);
        // Sem linha, vale homologação.
        if (consulta.filial_id && linhas.length === 0) linhas.push({ filial_id: consulta.filial_id, ambiente: AMBIENTE_PADRAO, recado_aprovacao: null });
        return { corpo: { itens: linhas } };
      },
    }),
    definirRota({
      metodo: 'PUT',
      caminho: '/ambientes-fiscais/:filial_id',
      acao: 'core.ambiente.trocar',
      corpo: AmbienteTrocar,
      async executar(c, { corpo, params }) {
        const filialId = idDoParam(params, 'filial_id');
        const [atualLinha] = await repo.ambientes(c.tx, filialId);
        const atual = atualLinha?.ambiente ?? null;
        const r = avaliarTrocaAmbienteTenant({ atual, novo: corpo.ambiente });
        if (!r.ok) throw erros.regra('RN-CORE-08', r.mensagem);
        if (!r.muda && atualLinha) return { corpo: ambienteDto(atualLinha) };
        const nova: LinhaAmbiente & { ambiente: 'homologacao' } = { filial_id: filialId, ambiente: r.ambiente, recado_aprovacao: null };
        await repo.gravarAmbiente(c.tx, { ...nova, alterado_por: c.sessao.usuario_id }, c.agora);
        const dto = ambienteDto(nova);
        await c.auditar({
          acao: 'core.ambiente.trocado',
          entidade: 'ambiente_fiscal',
          entidade_id: nova.filial_id,
          antes: { ambiente: atual ?? AMBIENTE_PADRAO, recado_aprovacao: atualLinha?.recado_aprovacao ?? null },
          depois: { ...dto, origem: 'api' },
        });
        await publicar(c, EVENTO_AMBIENTE, nova.filial_id, dto);
        return { corpo: dto };
      },
    }),

    // Auditoria (RF-CORE-05)
    definirRota({
      metodo: 'GET',
      caminho: '/auditoria',
      acao: 'core.auditoria.ver',
      consulta: AuditoriaConsulta,
      async executar(c, { consulta }) {
        const linhas = await repo.auditoria(c.tx, {
          entidade: consulta.entidade,
          de: consulta.de ? new Date(consulta.de) : undefined,
          ate: consulta.ate ? new Date(consulta.ate) : undefined,
          limite: consulta.limite + 1,
          cursor: consulta.cursor,
        });
        const p = paginar(linhas, consulta.limite);
        return { corpo: { itens: p.itens.map((a) => ({ ...a, ocorrido_em: a.ocorrido_em.toISOString() })), proximo_cursor: p.proximo_cursor } };
      },
    }),

    // Exportação LGPD (RF-CORE-06): 202 e o worker gera o .zip
    definirRota({
      metodo: 'POST',
      caminho: '/exportacoes',
      acao: 'core.exportacao.pedir',
      async executar(c) {
        const e = await repo.criarExportacao(c.tx, novoId(), c.sessao.usuario_id, c.agora);
        await c.enfileirar({ tipo: TRABALHO_EXPORTAR, payload: { exportacao_id: e.id }, external_id: e.id });
        await c.auditar({ acao: 'core.exportacao.pedida', entidade: 'exportacao', entidade_id: e.id });
        return { status: 202, corpo: exportacaoDto(e) };
      },
    }),
    definirRota({
      metodo: 'GET',
      caminho: '/exportacoes/:id',
      acao: 'core.exportacao.pedir',
      async executar(c, { params }) {
        const e = await repo.exportacao(c.tx, idDoParam(params, 'id'));
        if (!e) throw erros.naoEncontrado('Exportação');
        let url: string | null = null;
        if (e.estado === 'pronta' && e.arquivo_id) {
          const chave = await repo.chaveDoArquivo(c.tx, e.arquivo_id);
          if (chave) url = await deps.armazenamento.urlAssinada(chave, 24 * 3600);
        }
        return { corpo: exportacaoDto(e, url) };
      },
    }),

    // Parâmetros do tenant
    definirRota({
      metodo: 'GET',
      caminho: '/parametros',
      acao: 'core.parametro.gerir',
      async executar(c) {
        return { corpo: { itens: await repo.parametros(c.tx) } };
      },
    }),
    definirRota({
      metodo: 'PUT',
      caminho: '/parametros/:chave',
      acao: 'core.parametro.gerir',
      corpo: ParametroGravar,
      async executar(c, { corpo, params }) {
        const chave = ParametroChave.safeParse(params.chave);
        if (!chave.success) throw erros.validacao({ chave: 'Chave inválida' });
        const antes = (await repo.parametros(c.tx)).find((p) => p.chave === chave.data)?.valor ?? null;
        const parametroId = await repo.gravarParametro(c.tx, chave.data, corpo.valor, c.agora);
        await c.auditar({ acao: 'core.parametro.gravado', entidade: 'parametro', entidade_id: parametroId, antes, depois: corpo.valor });
        return { corpo: { chave: chave.data, valor: corpo.valor } };
      },
    }),
  ];

  function exportacaoDto(e: LinhaExportacao, url: string | null = null): Exportacao {
    return { id: e.id, estado: e.estado, url, concluida_em: iso(e.concluida_em), expira_em: iso(e.expira_em) };
  }

  return definirPlugin(manifest, rotas);
}

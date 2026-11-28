import {
  CABECALHO_CSRF_CONFIG,
  COOKIE_CONFIG,
  EmailPrimeiroAdminResposta,
  EmpresaPlataforma,
  EuPlataforma,
  PADRAO_UUID,
  PREFIXO_PLATAFORMA,
  PrimeiroAdminResposta,
  paginaDe,
  CODIGO_TROCAR_SENHA,
  CAMINHOS_INTEGRACAO_FDV_PLATAFORMA,
  IntegracaoFdvPlataforma,
  RespostaAceitoFdv,
  MonitorConectorFdv,
  RespostaReprocessarFdv,
  LogCadastroFdvPlataforma,
  RespostaRetomadaFdv,
  RespostaTestarPlataforma,
  EntidadeEnvioFdv,
  type ConfigurarIntegracaoPlataformaEntrada,
  type DefinirCredencialPlataformaEntrada,
  type AlterarModulosEntrada,
  type CriarEmpresaEntrada,
  type PrimeiroAdminEntrada,
  type SituacaoEmpresaEntrada,
  type TrocarSenhaEntrada,
} from '@macuxierp/platform-sdk';
import {
  ListaFiliaisConfig,
  ListaUsuariosConfig,
  ROTAS_USUARIOS_CONFIG,
  UsuarioConfig,
  UsuarioConfigComSenha,
  UsuarioExcluido,
  type UsuarioConfigCriar,
  type UsuarioConfigEditar,
  ContatoRevelado,
  FichaReceitaPlanaMascarada,
  PreviaReceita,
  ROTAS_FICHA,
  ResultadoSalvarFicha,
  ResultadoTrocaCnpj,
  SituacaoTrocaCnpj,
  type CampoContato,
  type EdicaoFicha,
  type TrocaCnpj,
} from '@macuxierp/core/contracts';
import { z } from 'zod';
import { buscarNaApi } from '../api';
import { sinalDeBloqueioNaResposta } from '../login-regras';
import { idDaRequisicao } from '../request-id';
import { type DetalhesErro, ConfigContaBloqueada, ConfigIndisponivel, ConfigMuitasTentativas, ConfigNaoAutenticado, ConfigSemPermissao, ErroPlataforma } from './erros';

/** Cliente das rotas `/v1/plataforma/*` (ADR 0012). Só no servidor: o token da sessão nunca chega ao navegador. */
const ListaEmpresas = paginaDe(EmpresaPlataforma);
export type ListaEmpresas = z.infer<typeof ListaEmpresas>;

export interface Pedido {
  token?: string;
  corpo?: unknown;
  /** Multipart (carga, T-0058): vai como veio, sem `content-type` (o fetch põe a fronteira). */
  formulario?: FormData;
  chave?: string;
  timeoutMs?: number;
}

export async function chamar(metodo: string, caminho: string, p: Pedido = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (p.token) headers.cookie = `${COOKIE_CONFIG}=${p.token}`;
  // CSRF (ADR 0012): toda escrita leva o cabeçalho.
  if (metodo !== 'GET') headers[CABECALHO_CSRF_CONFIG] = '1';
  if (p.corpo !== undefined) headers['content-type'] = 'application/json';
  if (p.chave) headers['idempotency-key'] = p.chave;
  try {
    return await buscarNaApi(`${PREFIXO_PLATAFORMA}${caminho}`, { method: metodo, headers, body: p.formulario ?? (p.corpo === undefined ? undefined : JSON.stringify(p.corpo)) }, p.timeoutMs);
  } catch {
    throw new ConfigIndisponivel('API não respondeu');
  }
}

/** Mapeia o status de erro; nunca repassa o corpo cru. */
export async function recusar(r: Response): Promise<never> {
  if (r.status === 401) throw new ConfigNaoAutenticado();
  if (r.status === 429) throw new ConfigMuitasTentativas();
  const requestId = await idDaRequisicao(r); // clona: o corpo segue legível abaixo
  let corpo: { codigo?: unknown; mensagem?: unknown; campos?: Record<string, unknown>; detalhes?: { codigo?: unknown; bloqueios?: unknown } } = {};
  try {
    corpo = (await r.json()) as typeof corpo;
  } catch {
    /* corpo fora do formato: segue só com o status */
  }
  const codigo = typeof corpo.codigo === 'string' ? corpo.codigo : '';
  if (sinalDeBloqueioNaResposta(r.status, corpo)) throw new ConfigContaBloqueada();
  if (r.status === 403 && codigo !== CODIGO_TROCAR_SENHA) throw new ConfigSemPermissao();
  // 503 com código (ex.: CHAVE_INTEGRACAO_AUSENTE, ADR 0013 §3) é erro da plataforma, com mensagem própria; 5xx sem código segue indisponível.
  if ((r.status >= 400 && r.status < 500) || (r.status === 503 && codigo)) {
    const campos = Object.fromEntries(Object.entries(corpo.campos ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    // a mensagem da API (409 MXI01/MXI02 etc.) só passa se for curta e de uma linha; nunca o corpo cru
    const m = typeof corpo.mensagem === 'string' && corpo.mensagem.length <= 200 && !/[\r\n]/.test(corpo.mensagem) ? corpo.mensagem : '';
    // só o código e os bloqueios curtos ('cadastro:motivo') passam dos detalhes; o resto da API fica de fora
    const d = corpo.detalhes;
    const detalhes: DetalhesErro = {};
    if (typeof d?.codigo === 'string' && d.codigo.length <= 60) detalhes.codigo = d.codigo;
    if (Array.isArray(d?.bloqueios)) detalhes.bloqueios = d.bloqueios.filter((b): b is string => typeof b === 'string' && /^[a-z_]{1,40}:[a-z_]{1,40}$/.test(b));
    throw new ErroPlataforma(r.status, codigo, campos, m, detalhes);
  }
  throw new ConfigIndisponivel(`HTTP ${r.status}`, requestId);
}

export async function validado<S extends z.ZodTypeAny>(r: Response, schema: S): Promise<z.infer<S>> {
  if (!r.ok) return recusar(r);
  const dados = schema.safeParse(await r.json().catch(() => null));
  if (!dados.success) throw new ConfigIndisponivel('resposta fora do contrato');
  return dados.data;
}

/** Só UUID entra no caminho (nada de `../` vindo da URL). */
export function idEmpresa(id: string): string {
  if (!PADRAO_UUID.test(id)) throw new ErroPlataforma(404, 'NAO_ENCONTRADO');
  return id;
}

export async function euPlataforma(token: string): Promise<EuPlataforma> {
  return validado(await chamar('GET', '/auth/eu', { token }), EuPlataforma);
}

export async function sairPlataforma(token: string): Promise<void> {
  await chamar('POST', '/auth/sair', { token }).catch(() => undefined);
}

export async function trocarSenhaPlataforma(token: string, corpo: TrocarSenhaEntrada): Promise<void> {
  const r = await chamar('POST', '/auth/senha', { token, corpo });
  if (!r.ok) await recusar(r);
}

export async function listarEmpresas(token: string, q: { busca?: string; cursor?: string } = {}): Promise<ListaEmpresas> {
  const qs = new URLSearchParams();
  if (q.busca) qs.set('busca', q.busca);
  if (q.cursor) qs.set('cursor', q.cursor);
  const s = qs.toString();
  return validado(await chamar('GET', `/empresas${s ? `?${s}` : ''}`, { token }), ListaEmpresas);
}

/** Detalhe da empresa com a ficha da Receita MASCARADA (T-0101); ficha ausente ou fora do contrato vira `null`, sem derrubar a tela. */
const EmpresaComFicha = EmpresaPlataforma.extend({ ficha: FichaReceitaPlanaMascarada.nullable().catch(null) });

export async function lerEmpresa(token: string, id: string): Promise<z.infer<typeof EmpresaComFicha>> {
  return validado(await chamar('GET', `/empresas/${idEmpresa(id)}`, { token }), EmpresaComFicha);
}

/** Caminho de `ROTAS_FICHA` (RN-CORE-16) sem o prefixo do portal (o `chamar` o põe), com o id já conferido. */
const rotaFicha = (r: { caminho: string }, id: string) => r.caminho.slice(PREFIXO_PLATAFORMA.length).replace(':id', idEmpresa(id));

/** Ficha editável (RN-CORE-16): "Atualizar pela Receita" só traz a prévia (não grava); contatos mascarados. */
export async function previaReceita(token: string, id: string, chave: string): Promise<PreviaReceita> {
  return validado(await chamar(ROTAS_FICHA.previaReceita.metodo, rotaFicha(ROTAS_FICHA.previaReceita, id), { token, chave }), PreviaReceita);
}

/**
 * "Salvar" da ficha (RN-CORE-16): grava e audita (só nomes de campo). A rota só responde `ok` ou `sem_mudanca`; a falha vem como
 * erro HTTP (400/409/422). O estado `erro` do contrato não é usado pela tela: se vier, é resposta fora do contrato.
 */
const [SalvoOk, SalvoSemMudanca] = ResultadoSalvarFicha.options;
const SalvoFicha = z.discriminatedUnion('estado', [SalvoOk, SalvoSemMudanca]);
export async function salvarFicha(token: string, id: string, corpo: EdicaoFicha, chave: string): Promise<z.infer<typeof SalvoFicha>> {
  return validado(await chamar(ROTAS_FICHA.salvar.metodo, rotaFicha(ROTAS_FICHA.salvar, id), { token, corpo, chave }), SalvoFicha);
}

/** Se o CNPJ pode ser trocado agora (RN-CORE-16): a tela sabe antes de tentar e mostra o motivo do bloqueio. */
export async function lerSituacaoCnpj(token: string, id: string): Promise<SituacaoTrocaCnpj> {
  return validado(await chamar(ROTAS_FICHA.situacaoCnpj.metodo, rotaFicha(ROTAS_FICHA.situacaoCnpj, id), { token }), SituacaoTrocaCnpj);
}

/** Troca do CNPJ (RN-CORE-16, só superadmin); a API revalida e devolve o bloqueio com a mensagem. */
export async function trocarCnpj(token: string, id: string, corpo: TrocaCnpj, chave: string): Promise<ResultadoTrocaCnpj> {
  return validado(await chamar(ROTAS_FICHA.trocarCnpj.metodo, rotaFicha(ROTAS_FICHA.trocarCnpj, id), { token, corpo, chave }), ResultadoTrocaCnpj);
}

/** `POST .../contato/{email|telefone}` (no-store, auditado pela API: sem Idempotency-Key). O valor só vai à tela. */
export async function revelarContato(token: string, id: string, campo: CampoContato): Promise<ContatoRevelado> {
  return validado(await chamar('POST', `/empresas/${idEmpresa(id)}/contato/${campo}`, { token }), ContatoRevelado);
}

export async function criarEmpresa(token: string, corpo: CriarEmpresaEntrada, chave: string): Promise<EmpresaPlataforma> {
  return validado(await chamar('POST', '/empresas', { token, corpo, chave }), EmpresaPlataforma);
}

export async function alterarModulos(token: string, id: string, corpo: z.input<typeof AlterarModulosEntrada>): Promise<EmpresaPlataforma> {
  return validado(await chamar('PUT', `/empresas/${idEmpresa(id)}/modulos`, { token, corpo }), EmpresaPlataforma);
}

export async function alterarSituacao(token: string, id: string, corpo: SituacaoEmpresaEntrada, chave: string): Promise<EmpresaPlataforma> {
  return validado(await chamar('PUT', `/empresas/${idEmpresa(id)}/situacao`, { token, corpo, chave }), EmpresaPlataforma);
}

/** A resposta traz a senha provisória: quem chama a mostra uma vez e não a guarda nem a loga. */
export async function criarPrimeiroAdmin(token: string, id: string, corpo: PrimeiroAdminEntrada, chave: string): Promise<PrimeiroAdminResposta> {
  return validado(await chamar('POST', `/empresas/${idEmpresa(id)}/primeiro-admin`, { token, corpo, chave }), PrimeiroAdminResposta);
}

export async function redefinirSenhaPrimeiroAdmin(token: string, id: string, chave: string): Promise<PrimeiroAdminResposta> {
  return validado(await chamar('POST', `/empresas/${idEmpresa(id)}/primeiro-admin/senha`, { token, chave }), PrimeiroAdminResposta);
}

/** `POST .../primeiro-admin/email` (no-store): o e-mail inteiro, só para a tela. Escrita auditada pela API: sem Idempotency-Key. */
export async function mostrarEmailPrimeiroAdmin(token: string, id: string): Promise<EmailPrimeiroAdminResposta> {
  return validado(await chamar('POST', `/empresas/${idEmpresa(id)}/primeiro-admin/email`, { token }), EmailPrimeiroAdminResposta);
}

/** Integração FDV (ADR 0013): rotas de `CAMINHOS_INTEGRACAO_FDV_PLATAFORMA`; a chave do conector só vai no corpo e nunca volta. */
const rotaFdv = (modelo: string, id: string, entidade?: string) => {
  const e = entidade === undefined ? undefined : EntidadeEnvioFdv.safeParse(entidade);
  if (e && !e.success) throw new ErroPlataforma(400, 'VALIDACAO');
  return modelo.replace(':id', idEmpresa(id)).replace(':entidade', e?.success ? e.data : '');
};

export async function lerIntegracaoFdv(token: string, id: string): Promise<IntegracaoFdvPlataforma> {
  return validado(await chamar('GET', rotaFdv(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.ler, id), { token }), IntegracaoFdvPlataforma);
}

export async function definirCredencialFdv(token: string, id: string, corpo: DefinirCredencialPlataformaEntrada): Promise<IntegracaoFdvPlataforma> {
  return validado(await chamar('PUT', rotaFdv(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.credencial, id), { token, corpo }), IntegracaoFdvPlataforma);
}

export async function testarConexaoFdv(token: string, id: string, chave: string): Promise<RespostaTestarPlataforma> {
  return validado(await chamar('POST', rotaFdv(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.testar, id), { token, chave }), RespostaTestarPlataforma);
}

export async function configurarIntegracaoFdv(token: string, id: string, corpo: ConfigurarIntegracaoPlataformaEntrada, chave: string): Promise<IntegracaoFdvPlataforma> {
  return validado(await chamar('PUT', rotaFdv(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.configuracao, id), { token, corpo, chave }), IntegracaoFdvPlataforma);
}

/** `Idempotency-Key` obrigatória (ADR 0013, seção 5). */
export async function cargaCompletaFdv(token: string, id: string, entidade: string, chave: string): Promise<RespostaAceitoFdv> {
  return validado(await chamar('POST', rotaFdv(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.cargaCompleta, id, entidade), { token, chave }), RespostaAceitoFdv);
}

export async function retomarFdv(token: string, id: string, entidade: string, chave: string): Promise<RespostaRetomadaFdv> {
  return validado(await chamar('POST', rotaFdv(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.retomar, id, entidade), { token, chave }), RespostaRetomadaFdv);
}

/** Monitor do conector (T-0086): `GET .../integracao-fdv/monitor`, só leitura. */
export async function lerMonitorFdv(token: string, id: string): Promise<MonitorConectorFdv> {
  return validado(await chamar('GET', rotaFdv(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.monitor, id), { token }), MonitorConectorFdv);
}

/** Reprocessar só falhas e pendentes (T-0086): `Idempotency-Key` obrigatória; com lote em voo a API responde 409 `CONFLITO`. */
export async function reprocessarFdv(token: string, id: string, entidade: string, chave: string): Promise<RespostaReprocessarFdv> {
  return validado(await chamar('POST', rotaFdv(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.reprocessar, id, entidade), { token, chave }), RespostaReprocessarFdv);
}

/** Log do cadastro (T-0086): só códigos, campos e contagens (ADR 0013); sem dado de negócio. */
export async function lerLogFdv(token: string, id: string, entidade: string): Promise<LogCadastroFdvPlataforma> {
  return validado(await chamar('GET', rotaFdv(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.log, id, entidade), { token }), LogCadastroFdvPlataforma);
}

/**
 * Usuários da empresa (v0.3.29, `ROTAS_USUARIOS_CONFIG`, no-store): a tela não recalcula regra, usa `acoes` e `ultimo_admin_ativo` de cada linha.
 * Criar e Redefinir senha trazem a senha provisória, que só passa pela resposta: quem chama a mostra uma vez, sem guardar nem logar.
 */
const caminhoUsuario = (modelo: string, id: string, usuario?: string): string => {
  if (usuario !== undefined && !PADRAO_UUID.test(usuario)) throw new ErroPlataforma(404, 'NAO_ENCONTRADO');
  return modelo.replace('/v1/plataforma', '').replace(':id', idEmpresa(id)).replace(':usuario', usuario ?? '');
};

export async function listarUsuarios(token: string, id: string): Promise<ListaUsuariosConfig> {
  return validado(await chamar('GET', `/empresas/${idEmpresa(id)}/usuarios`, { token }), ListaUsuariosConfig);
}

export async function listarFiliais(token: string, id: string): Promise<ListaFiliaisConfig> {
  return validado(await chamar('GET', caminhoUsuario(ROTAS_USUARIOS_CONFIG.filiais.caminho, id), { token }), ListaFiliaisConfig);
}

export async function criarUsuario(token: string, id: string, corpo: UsuarioConfigCriar, chave: string): Promise<UsuarioConfigComSenha> {
  return validado(await chamar('POST', caminhoUsuario(ROTAS_USUARIOS_CONFIG.criar.caminho, id), { token, corpo, chave }), UsuarioConfigComSenha);
}

export async function editarUsuario(token: string, id: string, usuario: string, corpo: UsuarioConfigEditar): Promise<UsuarioConfig> {
  return validado(await chamar('PATCH', caminhoUsuario(ROTAS_USUARIOS_CONFIG.editar.caminho, id, usuario), { token, corpo }), UsuarioConfig);
}

export async function redefinirSenhaUsuario(token: string, id: string, usuario: string, chave: string): Promise<UsuarioConfigComSenha> {
  return validado(await chamar('POST', caminhoUsuario(ROTAS_USUARIOS_CONFIG.redefinirSenha.caminho, id, usuario), { token, chave }), UsuarioConfigComSenha);
}

export async function inativarUsuario(token: string, id: string, usuario: string): Promise<UsuarioConfig> {
  return validado(await chamar('POST', caminhoUsuario(ROTAS_USUARIOS_CONFIG.inativar.caminho, id, usuario), { token }), UsuarioConfig);
}

export async function reativarUsuario(token: string, id: string, usuario: string): Promise<UsuarioConfig> {
  return validado(await chamar('POST', caminhoUsuario(ROTAS_USUARIOS_CONFIG.reativar.caminho, id, usuario), { token }), UsuarioConfig);
}

export async function excluirUsuario(token: string, id: string, usuario: string): Promise<UsuarioExcluido> {
  return validado(await chamar('POST', caminhoUsuario(ROTAS_USUARIOS_CONFIG.excluir.caminho, id, usuario), { token }), UsuarioExcluido);
}

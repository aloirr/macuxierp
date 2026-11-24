/**
 * Troca obrigatória da senha provisória no tenant (T-0052, RN-CORE-10; contrato no `eu.ts` do SDK): enquanto
 * `plataforma.usuario.deve_trocar_senha` estiver ligada (vem no JWT de acesso, claim `dts`), toda rota do tenant
 * responde 403 `CODIGO_TROCAR_SENHA`, menos `GET /v1/auth/eu`, `POST /v1/auth/sair` e `POST /v1/auth/senha`.
 * Fora do guard: as rotas que não leem a sessão do tenant (saúde, login, refresh, "Esqueci a senha"), o portal `/v1/plataforma` (credencial
 * própria, com o mesmo código para o superadmin) e a rota inexistente (segue 404). Funções puras.
 */
import {
  CAMINHOS_ESQUECI_SENHA,
  CODIGO_TROCAR_SENHA,
  PREFIXO_PLATAFORMA,
  SENHA_MAXIMA,
  SenhaInformada,
  TrocarSenhaEntrada,
  type MotivoTrocaSenha,
  type SenhaATrocarResposta,
} from '@macuxierp/platform-sdk';
import { z } from 'zod';

export const MENSAGEM_TROCAR_SENHA = 'Troque a senha provisória antes de continuar';

/**
 * Corpo da troca de senha na API (`POST /v1/auth/senha` e `/v1/plataforma/auth/senha`): a forma do contrato
 * (`TrocarSenhaEntrada`), com a senha nova só limitada no tamanho; a regra sai no 400 do serviço (`erroSenhaNova`). A
 * `senha_atual` pode faltar no corpo (T-0076), mas o serviço só a dispensa na sessão de motivo 'temporaria' gravada no
 * servidor (o JWT assinado e o refresh/token cujo hash está no banco); fora dela, a falta é o 400 `VALIDACAO` em
 * `senha_atual`, o mesmo da senha atual incorreta.
 */
export const CorpoTrocaSenha = TrocarSenhaEntrada.extend({ senha_atual: SenhaInformada.optional(), senha_nova: z.string().max(SENHA_MAXIMA) });

/** Rotas do tenant liberadas com a senha provisória (o BKO mostra a tela de troca e deixa sair). */
const LIVRES = new Set(['GET /v1/auth/eu', 'POST /v1/auth/sair', 'POST /v1/auth/senha']);
/** Rotas que não leem o JWT de acesso do tenant. */
const SEM_SESSAO_DO_TENANT = new Set([
  'GET /v1/saude',
  'POST /v1/auth/login',
  'POST /v1/auth/refresh',
  `POST ${CAMINHOS_ESQUECI_SENHA.tenant}`,
  `GET ${CAMINHOS_ESQUECI_SENHA.situacao}`,
]);

/**
 * `true` quando o pedido deve parar no 403 `TROCAR_SENHA`. `rota` é o padrão registrado no Fastify
 * (`req.routeOptions.url`, ex.: `/v1/cadastros/clientes/:id`); `undefined` = rota inexistente. HEAD vale como GET.
 */
export function bloqueiaPorTrocaDeSenha(metodo: string, rota: string | undefined, deveTrocarSenha: boolean): boolean {
  if (!deveTrocarSenha || rota === undefined) return false;
  if (rota === PREFIXO_PLATAFORMA || rota.startsWith(`${PREFIXO_PLATAFORMA}/`)) return false;
  const id = `${metodo.toUpperCase() === 'HEAD' ? 'GET' : metodo.toUpperCase()} ${rota}`;
  return !LIVRES.has(id) && !SEM_SESSAO_DO_TENANT.has(id);
}

/** Mensagem do 403 da troca pendente quando a sessão nasceu da senha temporária do "esqueci" (T-0076). */
export const MENSAGEM_TROCAR_SENHA_TEMPORARIA = 'Troque a senha temporária antes de continuar';

/**
 * Troca pendente da sessão (fonte única do par, no JWT, no refresh, no token do `/config` e nos serviços): o motivo
 * 'temporaria' (ausente = provisória) e, nele, o fim das 72 h da temporária.
 */
export interface TrocaPendente {
  motivo_troca?: Extract<MotivoTrocaSenha, 'temporaria'>;
  temporaria_expira_em?: Date;
}

/**
 * Corpo do 403 `TROCAR_SENHA` do bloqueio (`SenhaATrocarResposta`, RN-CORE-13), no tenant e no superadmin: o motivo da
 * sessão e, na temporária, `expira_em` = o fim das 72 h da temporária consumida no login. O login em si responde 200
 * com a sessão aberta; o 403 só sai nas outras rotas.
 */
export function corpoTrocarSenha(t: TrocaPendente): SenhaATrocarResposta {
  if (t.motivo_troca !== 'temporaria') return { codigo: CODIGO_TROCAR_SENHA, mensagem: MENSAGEM_TROCAR_SENHA, motivo: 'provisoria' };
  return {
    codigo: CODIGO_TROCAR_SENHA,
    mensagem: MENSAGEM_TROCAR_SENHA_TEMPORARIA,
    motivo: 'temporaria',
    ...(t.temporaria_expira_em ? { expira_em: t.temporaria_expira_em.toISOString() } : {}),
  };
}

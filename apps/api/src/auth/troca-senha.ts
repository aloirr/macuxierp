/**
 * Troca obrigatória da senha provisória no tenant (T-0052, RN-CORE-10; contrato no `eu.ts` do SDK): enquanto
 * `plataforma.usuario.deve_trocar_senha` estiver ligada (vem no JWT de acesso, claim `dts`), toda rota do tenant
 * responde 403 `CODIGO_TROCAR_SENHA`, menos `GET /v1/auth/eu`, `POST /v1/auth/sair` e `POST /v1/auth/senha`.
 * Fora do guard: as rotas que não leem a sessão do tenant (saúde, login, refresh), o portal `/v1/plataforma` (credencial
 * própria, com o mesmo código para o superadmin) e a rota inexistente (segue 404). Funções puras.
 */
import { CODIGO_TROCAR_SENHA, ErroApi, PREFIXO_PLATAFORMA, SENHA_MAXIMA, TrocarSenhaEntrada } from '@macuxierp/platform-sdk';
import { z } from 'zod';

export const MENSAGEM_TROCAR_SENHA = 'Troque a senha provisória antes de continuar';

/**
 * Corpo da troca de senha na API (`POST /v1/auth/senha` e `/v1/plataforma/auth/senha`): a forma do contrato
 * (`TrocarSenhaEntrada`), com a senha nova só limitada no tamanho; a regra sai no 400 do serviço (`erroSenhaNova`).
 */
export const CorpoTrocaSenha = TrocarSenhaEntrada.extend({ senha_nova: z.string().max(SENHA_MAXIMA) });

/** Rotas do tenant liberadas com a senha provisória (o BKO mostra a tela de troca e deixa sair). */
const LIVRES = new Set(['GET /v1/auth/eu', 'POST /v1/auth/sair', 'POST /v1/auth/senha']);
/** Rotas que não leem o JWT de acesso do tenant. */
const SEM_SESSAO_DO_TENANT = new Set(['GET /v1/saude', 'POST /v1/auth/login', 'POST /v1/auth/refresh']);

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

export const erroTrocarSenha = (): ErroApi => new ErroApi(403, CODIGO_TROCAR_SENHA, MENSAGEM_TROCAR_SENHA);

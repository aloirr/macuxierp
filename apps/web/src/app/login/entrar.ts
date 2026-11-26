'use server';
import { LoginEntrada, textoMuitasTentativas } from '@macuxierp/platform-sdk';
import { buscarEu } from '@/lib/api';
import { euPlataforma } from '@/lib/config/api';
import { cookies } from 'next/headers';
import { COOKIE_CONFIG_WEB, opcoesConfig, ROTA_SENHA as ROTA_SENHA_CONFIG } from '@/lib/config/sessao';
import { loginUnico, type SessaoAberta } from '@/lib/login-unico';
import { contaBloqueada, TEXTOS_LOGIN, validarComSdk, type ErrosLogin } from '@/lib/login-regras';
import { COOKIE_ACESSO, COOKIE_REFRESH, destinoSeguro, opcoesAcesso, opcoesLongas } from '@/lib/sessao';
import { ROTA_SENHA } from '@/lib/troca-pendente';

/** Volta sempre com algo a mostrar ou, entrando, com o `entrou` (destino e rota). A senha nunca volta. */
export interface EstadoLogin {
  erro?: string;
  campos?: ErrosLogin;
  /** Conta bloqueada (ver `contaBloqueada`): a tela mostra o aviso e o "Recuperar a senha", sem `erro`. */
  bloqueada?: boolean;
  /** Login aceito: o cliente grava a preferência (só com `bko`) e navega para `para`. Nunca carrega senha nem token. */
  entrou?: { destino: 'bko' | 'config'; para: string };
}

async function gravarSessao(s: SessaoAberta): Promise<void> {
  const jar = await cookies();
  if (s.destino === 'config') jar.set(COOKIE_CONFIG_WEB, s.token, opcoesConfig(s.expira_em));
  else {
    jar.set(COOKIE_ACESSO, s.acesso, opcoesAcesso);
    jar.set(COOKIE_REFRESH, s.refresh, opcoesLongas);
  }
}

/**
 * Troca obrigatória pendente (RN-CORE-13): o login responde 200 com a sessão aberta e a marca vem no `eu` do destino
 * (`deve_trocar_senha`; o `motivo_troca` é lido pela própria tela de troca). Falha ao ler o `eu` segue o fluxo normal:
 * a guarda de cada destino cuida da sessão, e o 403 TROCAR_SENHA das outras rotas continua levando à troca.
 */
async function trocaPendente(s: SessaoAberta): Promise<boolean> {
  try {
    return s.destino === 'config' ? (await euPlataforma(s.token)).deve_trocar_senha : (await buscarEu(s.acesso)).usuario.deve_trocar_senha === true;
  } catch {
    return false;
  }
}

/**
 * Login único (T-0076): uma ação para empresa e superadmin. Quem decide o destino é a API (`bko` ou `config`); o web só navega.
 * Troca pendente (lida no `eu` do destino) leva a `/senha` no BKO ou `/config/senha` no config. Nada de senha em log.
 */
export async function entrarAction(dados: FormData): Promise<EstadoLogin> {
  const bruto = { empresa: String(dados.get('empresa') ?? ''), email: String(dados.get('email') ?? ''), senha: String(dados.get('senha') ?? '') };
  const v = validarComSdk(LoginEntrada, ['empresa', 'email', 'senha'], bruto);
  if (!v.ok) return { campos: v.erros };
  const r = await loginUnico(v.dados);

  if (r.tipo === 'campos') return { campos: r.erros };
  if (contaBloqueada(r)) return { bloqueada: true };
  if (r.tipo === 'limite') return { erro: textoMuitasTentativas(r.retry_after_s) };
  if (r.tipo === 'indisponivel') return { erro: TEXTOS_LOGIN.indisponivel };
  if (r.tipo === 'credencial') return { erro: TEXTOS_LOGIN.credencial };
  await gravarSessao(r.sessao);
  const destino = r.sessao.destino;
  if (await trocaPendente(r.sessao)) return { entrou: { destino, para: destino === 'config' ? ROTA_SENHA_CONFIG : ROTA_SENHA } };
  return { entrou: { destino, para: destino === 'config' ? '/config' : destinoSeguro(String(dados.get('destino') ?? '')) } };
}

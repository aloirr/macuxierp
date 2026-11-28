/** Usuários do ERP (RF-CORE-02, RN-CORE-01). */
import { gerarSenhaTemporaria, type Perfil, type Sortear } from '@macuxierp/platform-sdk';
import { MENSAGEM_ULTIMO_ADMIN } from '../contracts';

export interface UsuarioAtual {
  id: string;
  perfil: Perfil;
  ativo: boolean;
}

export type AvaliacaoUsuario = { ok: true } | { ok: false; mensagem: string };

/**
 * RN-CORE-01: o tenant precisa de ao menos um administrador ativo; inativar ou rebaixar o último é recusado
 * (senão ninguém mais gere usuários, certificado e ambiente fiscal).
 */
export function avaliarAlteracaoUsuario(p: {
  atual: UsuarioAtual;
  alteracao: { perfil?: Perfil; ativo?: boolean };
  outrosAdministradoresAtivos: number;
}): AvaliacaoUsuario {
  const eraAdminAtivo = p.atual.perfil === 'administrador' && p.atual.ativo;
  const continua = (p.alteracao.perfil ?? p.atual.perfil) === 'administrador' && (p.alteracao.ativo ?? p.atual.ativo);
  if (eraAdminAtivo && !continua && p.outrosAdministradoresAtivos < 1) {
    return { ok: false, mensagem: MENSAGEM_ULTIMO_ADMIN };
  }
  return { ok: true };
}

/**
 * Senha provisória: RN-CORE-10 (emenda v0.3.20, 44 B, R-20261127-061352). Alfabeto, tamanho e geração são a fonte única
 * do platform-sdk (`gerarSenhaTemporaria`); aqui só se monta o `sortear(n)` puro sobre os bytes aleatórios injetados
 * (a API passa `randomBytes(256)`): rejeição sem viés (limite 256 - 256 % n), consumindo os bytes em ordem.
 */
export function gerarSenhaProvisoria(aleatorios: Uint8Array): string {
  let i = 0;
  const sortear: Sortear = (n) => {
    const limite = 256 - (256 % n);
    while (i < aleatorios.length) {
      const b = aleatorios[i++] ?? 0;
      if (b < limite) return b % n;
    }
    throw new RangeError('gerarSenhaProvisoria: bytes aleatórios insuficientes');
  };
  return gerarSenhaTemporaria(sortear);
}

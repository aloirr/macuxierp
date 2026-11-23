/** Usuários do ERP (RF-CORE-02, RN-CORE-01). */
import type { Perfil } from '@macuxierp/platform-sdk';

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
    return { ok: false, mensagem: 'A empresa precisa de ao menos um administrador ativo' };
  }
  return { ok: true };
}

const MAIUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz';
const DIGITOS = '23456789';
const SIMBOLOS = '!@#%+=?';
const ALFABETO = MAIUSCULAS + MINUSCULAS + DIGITOS + SIMBOLOS;
const TAMANHO_SENHA = 16;

const CLASSES = [MAIUSCULAS, MINUSCULAS, DIGITOS, SIMBOLOS] as const;

/**
 * Senha provisória de 16 caracteres sem ambíguos (0/O, 1/l/I). Garante um de cada classe (maiúscula, minúscula, dígito e
 * especial) mais 12 do alfabeto inteiro, embaralhados (Fisher–Yates) com os mesmos bytes. Recebe bytes aleatórios (a API
 * passa `randomBytes`) para a função seguir pura; amostragem por rejeição, sem viés.
 */
export function gerarSenhaProvisoria(aleatorios: Uint8Array): string {
  let i = 0;
  /** Índice uniforme em [0, n) por rejeição (sem viés); consome os bytes em ordem. */
  const indice = (n: number): number => {
    const limite = 256 - (256 % n);
    while (i < aleatorios.length) {
      const b = aleatorios[i++] ?? 0;
      if (b < limite) return b % n;
    }
    throw new RangeError('gerarSenhaProvisoria: bytes aleatórios insuficientes');
  };
  const sortear = (alfabeto: string): string => alfabeto[indice(alfabeto.length)] ?? '';
  // Um de cada classe + o resto do alfabeto inteiro, embaralhados: nenhuma classe some (T-0052).
  const chars = [...CLASSES.map(sortear), ...Array.from({ length: TAMANHO_SENHA - CLASSES.length }, () => sortear(ALFABETO))];
  for (let j = chars.length - 1; j > 0; j--) {
    const k = indice(j + 1);
    [chars[j], chars[k]] = [chars[k] ?? '', chars[j] ?? ''];
  }
  return chars.join('');
}

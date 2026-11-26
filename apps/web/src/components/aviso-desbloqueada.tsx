import { TEXTOS_DESBLOQUEIO } from '@/lib/login-regras';

/** Aviso verde "Conta desbloqueada." das duas telas de senha (BKO e /config), só ao entrar com a temporária. */
export function AvisoDesbloqueada() {
  return <p className="aviso-sucesso" role="status">{TEXTOS_DESBLOQUEIO.aviso}</p>;
}

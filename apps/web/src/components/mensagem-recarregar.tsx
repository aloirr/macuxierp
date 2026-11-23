'use client';
import { SISTEMA_ATUALIZADO } from '@/lib/sistema-atualizado';

/** Mensagem de erro; quando é a do sistema atualizado, traz o botão "Recarregar". */
export function MensagemRecarregar({ texto, className = 'erro', role = 'alert' }: { texto: string; className?: string; role?: 'alert' | 'status' }) {
  return (
    <p className={className} role={role}>
      {texto}
      {texto === SISTEMA_ATUALIZADO && <>{' '}<button type="button" className="mx-botao-secundario" onClick={() => window.location.reload()}>Recarregar</button></>}
    </p>
  );
}

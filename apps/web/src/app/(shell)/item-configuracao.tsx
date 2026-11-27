'use client';
import { useActionState } from 'react';
import { ResultadoAcao } from '@macuxierp/ui';
import { resultadoErro } from '@/lib/resultado-acao';
import { entrarConfigAction } from '@/lib/acoes-cliente';
import type { EstadoEntrarConfig } from './entrar-config';

export const ROTULO_CONFIGURACAO = 'Configuração';

/** Parte visual pura. Um botão (POST com CSRF, nunca um link GET): a sessão do /config sai da sessão do BKO. */
export function VisaoItemConfiguracao({ acao, erro, pendente = false }: { acao?: (f: FormData) => void; erro?: string | undefined; pendente?: boolean }) {
  return (
    <li>
      <form action={acao}>
        <button className="item-menu" type="submit" disabled={pendente} aria-busy={pendente}>{ROTULO_CONFIGURACAO}</button>
      </form>
      <ResultadoAcao resultado={erro ? resultadoErro(erro) : null} />
    </li>
  );
}

export function ItemConfiguracao() {
  const [estado, acao, pendente] = useActionState<EstadoEntrarConfig, FormData>(entrarConfigAction, {});
  return <VisaoItemConfiguracao acao={acao} erro={estado.erro} pendente={pendente} />;
}

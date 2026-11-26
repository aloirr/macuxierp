import { redirect } from 'next/navigation';
import { StatusIntegracaoFdvTenant, pode, type Perfil } from '@macuxierp/platform-sdk';
import { ApiIndisponivel, NaoAutenticado, SemPermissao, getValidado } from '@/lib/api';
import { ROTA_SENHA, TrocarSenhaPendente } from '@/lib/troca-pendente';
import { montarVistaStatus } from '@/lib/integracao-fdv';
import { TEXTO_SEM_PERMISSAO } from '@/lib/telas/comum';
import { VistaIntegracaoFdv } from '@/components/integracao-fdv/vista';

/** Carrega o status (`GET /v1/integracao-fdv/status`, ADR 0013) e mostra só leitura. Erro da API vira mensagem fixa. */
export async function TelaIntegracaoFdv({ acesso, fuso, perfil }: { acesso: string; fuso: string; perfil: Perfil }) {
  try {
    const s = await getValidado('/v1/integracao-fdv/status', StatusIntegracaoFdvTenant, acesso, 'status', true);
    return <VistaIntegracaoFdv vista={montarVistaStatus(s, fuso)} podeVerLog={pode(perfil, 'integracao-fdv.ver')} fuso={fuso} />;
  } catch (e) {
    if (e instanceof NaoAutenticado) redirect('/sessao/renovar');
    if (e instanceof TrocarSenhaPendente) redirect(ROTA_SENHA);
    if (e instanceof SemPermissao) return <p className="erro" role="alert">{TEXTO_SEM_PERMISSAO}</p>;
    if (e instanceof ApiIndisponivel) return <p className="erro" role="alert">Não foi possível carregar agora. Tente de novo em instantes.</p>;
    throw e;
  }
}

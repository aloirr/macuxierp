import { redirect } from 'next/navigation';
import { PaginaClientesRecebidosFdv, StatusIntegracaoFdvTenant, pode, type Perfil } from '@macuxierp/platform-sdk';
import { ApiIndisponivel, NaoAutenticado, SemPermissao, getValidado } from '@/lib/api';
import { ROTA_SENHA, TrocarSenhaPendente } from '@/lib/troca-pendente';
import { montarVistaStatus } from '@/lib/integracao-fdv';
import { caminhoApiClientesRecebidos, lerConsultaUrl, montarVistaClientesRecebidos } from '@/lib/clientes-recebidos';
import { TEXTO_SEM_PERMISSAO } from '@/lib/telas/comum';
import { VistaIntegracaoFdv } from '@/components/integracao-fdv/vista';
import { SecaoClientesRecebidos } from '@/components/integracao-fdv/clientes-recebidos';

type Busca = Readonly<Record<string, string | string[] | undefined>>;

/** Carrega o status (`GET /v1/integracao-fdv/status`, ADR 0013) e mostra só leitura. Erro da API vira mensagem fixa. */
export async function TelaIntegracaoFdv({ acesso, fuso, perfil, rota = '/integracao-fdv/integracao-fdv', busca = {} }: { acesso: string; fuso: string; perfil: Perfil; rota?: string; busca?: Busca }) {
  try {
    const s = await getValidado('/v1/integracao-fdv/status', StatusIntegracaoFdvTenant, acesso, 'status', true);
    const recebidos = await clientesRecebidos({ acesso, fuso, rota, busca });
    return (
      <>
        <VistaIntegracaoFdv vista={montarVistaStatus(s, fuso)} podeVerLog={pode(perfil, 'integracao-fdv.ver')} fuso={fuso} />
        {recebidos}
      </>
    );
  } catch (e) {
    if (e instanceof NaoAutenticado) redirect('/sessao/renovar');
    if (e instanceof TrocarSenhaPendente) redirect(ROTA_SENHA);
    if (e instanceof SemPermissao) return <p className="erro" role="alert">{TEXTO_SEM_PERMISSAO}</p>;
    if (e instanceof ApiIndisponivel) return <p className="erro" role="alert">Não foi possível carregar agora. Tente de novo em instantes.</p>;
    throw e;
  }
}

/** Seção "Clientes recebidos do FDV" (T-0059). Sem perfil ou licença (403) a seção some; falha da API só afeta a seção. */
async function clientesRecebidos({ acesso, fuso, rota, busca }: { acesso: string; fuso: string; rota: string; busca: Busca }) {
  const consulta = lerConsultaUrl(busca);
  try {
    const p = await getValidado(caminhoApiClientesRecebidos(consulta), PaginaClientesRecebidosFdv, acesso, 'clientes recebidos', true);
    return <SecaoClientesRecebidos vista={montarVistaClientesRecebidos(p, fuso)} rota={rota} consulta={consulta} />;
  } catch (e) {
    if (e instanceof NaoAutenticado) redirect('/sessao/renovar');
    if (e instanceof TrocarSenhaPendente) redirect(ROTA_SENHA);
    if (e instanceof SemPermissao) return null;
    if (e instanceof ApiIndisponivel) return <p className="erro" role="alert">Não foi possível carregar os clientes recebidos agora. Tente de novo em instantes.</p>;
    throw e;
  }
}

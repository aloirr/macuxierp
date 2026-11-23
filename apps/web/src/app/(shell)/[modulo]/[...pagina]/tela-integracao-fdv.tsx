import { redirect } from 'next/navigation';
import { MonitorResposta } from '@macuxierp/integracao-fdv/contracts';
import type { Perfil } from '@macuxierp/platform-sdk';
import { ApiIndisponivel, NaoAutenticado, SemPermissao, getValidado } from '@/lib/api';
import { ROTA_SENHA, TrocarSenhaPendente } from '@/lib/troca-pendente';
import { montarVista } from '@/lib/integracao-fdv';
import { TelaIntegracaoFdvCliente } from '@/components/integracao-fdv/cliente';

/** Carrega o monitor (`GET /v1/integracao-fdv/monitor`) e entrega a vista pronta ao componente. Erro da API vira mensagem fixa. */
export async function TelaIntegracaoFdv({ perfil, acesso, fuso, rotaLotes }: { perfil: Perfil; acesso: string; fuso: string; rotaLotes: string }) {
  try {
    const m = await getValidado('/v1/integracao-fdv/monitor', MonitorResposta, acesso, 'monitor', true);
    return <TelaIntegracaoFdvCliente vista={montarVista(m, perfil, fuso, rotaLotes)} />;
  } catch (e) {
    if (e instanceof NaoAutenticado) redirect('/sessao/renovar');
    if (e instanceof TrocarSenhaPendente) redirect(ROTA_SENHA);
    if (e instanceof SemPermissao) return <p className="erro" role="alert">Seu perfil não pode ver esta tela.</p>;
    if (e instanceof ApiIndisponivel) return <p className="erro" role="alert">Não foi possível carregar agora. Tente de novo em instantes.</p>;
    throw e;
  }
}

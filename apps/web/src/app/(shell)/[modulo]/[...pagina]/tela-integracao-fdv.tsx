import { redirect } from 'next/navigation';
import { StatusIntegracaoFdvTenant } from '@macuxierp/platform-sdk';
import { ApiIndisponivel, NaoAutenticado, SemPermissao, getValidado } from '@/lib/api';
import { ROTA_SENHA, TrocarSenhaPendente } from '@/lib/troca-pendente';
import { montarVistaStatus } from '@/lib/integracao-fdv';
import { buscarSituacaoEntrada } from '@/lib/entrada-bko-provisorio';
import { BlocoEntradaCliente } from '@/components/entrada-bko/entrada-bko';
import { VistaIntegracaoFdv } from '@/components/integracao-fdv/vista';

/** Carrega o status (`GET /v1/integracao-fdv/status`, ADR 0013) e mostra só leitura. Erro da API vira mensagem fixa. */
export async function TelaIntegracaoFdv({ acesso, fuso }: { acesso: string; fuso: string }) {
  try {
    const [s, entrada] = await Promise.all([getValidado('/v1/integracao-fdv/status', StatusIntegracaoFdvTenant, acesso, 'status', true), buscarSituacaoEntrada(acesso)]);
    return <><VistaIntegracaoFdv vista={montarVistaStatus(s, fuso)} />{entrada && <BlocoEntradaCliente linhas={entrada} fuso={fuso} />}</>;
  } catch (e) {
    if (e instanceof NaoAutenticado) redirect('/sessao/renovar');
    if (e instanceof TrocarSenhaPendente) redirect(ROTA_SENHA);
    if (e instanceof SemPermissao) return <p className="erro" role="alert">Seu perfil não pode ver esta tela.</p>;
    if (e instanceof ApiIndisponivel) return <p className="erro" role="alert">Não foi possível carregar agora. Tente de novo em instantes.</p>;
    throw e;
  }
}

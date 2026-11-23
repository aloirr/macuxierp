'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { EntidadeHub } from '@macuxierp/integracao-fdv/contracts';
import { ErroIntegracaoFdv, acoesDaTela, criarClienteIntegracaoFdv, validarFormularioConfiguracao, validarFormularioCredencial, type FetchIntegracaoFdv } from '@macuxierp/integracao-fdv/web';
import { cabecalhosParaApi } from '@/lib/api';
import { ROTA_SENHA } from '@/lib/troca-pendente';
import { CODIGO_TROCAR_SENHA } from '@macuxierp/platform-sdk';
import { contexto, COOKIE_ACESSO } from '@/lib/sessao';
import { FALHA, INDISPONIVEL, SEM_PERMISSAO, SESSAO_EXPIRADA } from '@/lib/textos';

export type PedidoIntegracaoFdv =
  | { tipo: 'credencial'; conector_id: string; chave: string; ambiente: string }
  | { tipo: 'testar' }
  | { tipo: 'retomar'; entidades: string[] }
  | { tipo: 'carga'; entidade: string }
  | { tipo: 'configuracao'; entidades_habilitadas: string[]; limite_registros_lote: string };

export interface ResultadoIntegracaoFdv {
  ok: boolean;
  mensagem: string;
  erros?: Record<string, string>;
  /** Falha parcial: algo já mudou no servidor e o monitor deve ser recarregado. */
  recarregar?: boolean;
}

const ROTA = '/integracao-fdv/integracao-fdv';

function mensagemDoErro(e: unknown): string {
  if (e instanceof ErroIntegracaoFdv) {
    if (e.status === 401) return SESSAO_EXPIRADA;
    if (e.status === 403) return SEM_PERMISSAO;
    if (e.status === 400 || e.status === 422) return 'Confira os dados informados.';
    if ((e.status === 409 || e.status === 503) && e.codigo !== 'ERRO' && e.codigo !== 'RESPOSTA_INVALIDA' && e.message.trim() !== '' && e.message.length <= 200 && !/[\r\n]/.test(e.message)) return e.message;
  }
  return FALHA;
}

/**
 * Ações da tela Integração FDV. Confere sessão, licença e perfil e chama a API com o token do cookie httpOnly (a API
 * revalida tudo). A chave do conector só existe no corpo do pedido: nunca vai a log, URL, resposta ou estado.
 */
export async function agirIntegracaoFdv(p: PedidoIntegracaoFdv): Promise<ResultadoIntegracaoFdv> {
  const { eu } = await contexto();
  if (!eu.modulos.some((m) => m.id === 'integracao-fdv') || !acoesDaTela(eu.usuario.perfil).configurar) {
    return { ok: false, mensagem: SEM_PERMISSAO };
  }
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  const url = process.env.MACUXIERP_API_URL;
  if (!acesso) return { ok: false, mensagem: SESSAO_EXPIRADA };
  if (!url) return { ok: false, mensagem: INDISPONIVEL };
  const api = criarClienteIntegracaoFdv({ baseUrl: url.replace(/\/$/, ''), token: () => acesso, fetch: (async (u, i) => fetch(u, { ...i, headers: await cabecalhosParaApi(i?.headers), cache: 'no-store', signal: AbortSignal.timeout(15_000) })) as FetchIntegracaoFdv });
  try {
    switch (p.tipo) {
      case 'credencial': {
        const v = validarFormularioCredencial({ conector_id: String(p.conector_id), chave: String(p.chave), ambiente: String(p.ambiente) });
        if (!v.ok) return { ok: false, mensagem: 'Confira os campos.', erros: v.erros };
        await api.salvarCredencial(v.corpo);
        revalidatePath(ROTA);
        return { ok: true, mensagem: 'Credencial salva.' };
      }
      case 'testar':
        await api.testar();
        revalidatePath(ROTA);
        return { ok: true, mensagem: 'Teste pedido. A resposta do FDV aparece na faixa de cima em instantes.' };
      case 'retomar': {
        if (!Array.isArray(p.entidades)) return { ok: false, mensagem: 'Cadastro desconhecido.' };
        const lista = p.entidades.map((e) => EntidadeHub.safeParse(e));
        if (lista.some((e) => !e.success)) return { ok: false, mensagem: 'Cadastro desconhecido.' };
        let feitas = 0;
        try {
          for (const e of lista) if (e.success) { await api.retomar(e.data); feitas += 1; }
        } catch (e) {
          // falhou no meio: recarrega o monitor mesmo assim para mostrar o que já foi retomado
          if (feitas > 0) revalidatePath(ROTA);
          return { ok: false, recarregar: feitas > 0, mensagem: `${mensagemDoErro(e)} ${feitas} de ${lista.length} cadastro(s) retomado(s).` };
        }
        revalidatePath(ROTA);
        return { ok: true, mensagem: lista.length === 1 ? 'Pedido para tentar de novo registrado.' : `Pedido para tentar de novo registrado em ${feitas} cadastro(s).` };
      }
      case 'carga': {
        const e = EntidadeHub.safeParse(p.entidade);
        if (!e.success) return { ok: false, mensagem: 'Cadastro desconhecido.' };
        await api.cargaCompleta(e.data);
        revalidatePath(ROTA);
        return { ok: true, mensagem: 'Carga completa pedida. O envio começa em instantes.' };
      }
      case 'configuracao': {
        const v = validarFormularioConfiguracao({ entidades_habilitadas: p.entidades_habilitadas, limite_registros_lote: p.limite_registros_lote });
        if (!v.ok) return { ok: false, mensagem: 'Confira os campos.', erros: v.erros };
        await api.configurar(v.corpo);
        revalidatePath(ROTA);
        return { ok: true, mensagem: 'Configuração salva.' };
      }
    }
  } catch (e) {
    if (e instanceof ErroIntegracaoFdv && e.status === 403 && e.codigo === CODIGO_TROCAR_SENHA) redirect(ROTA_SENHA);
    // só o tipo de erro e o status: nunca o pedido nem a chave
    console.error('integracao-fdv: falha inesperada na ação', p.tipo, e instanceof ErroIntegracaoFdv ? `status ${e.status} ${e.codigo}` : e instanceof Error ? e.name : 'erro');
    return { ok: false, mensagem: mensagemDoErro(e) };
  }
}

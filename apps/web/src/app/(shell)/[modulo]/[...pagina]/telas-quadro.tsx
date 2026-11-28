import { redirect } from 'next/navigation';
import { z } from 'zod';
import { quadroEmpresaFiscal } from '@macuxierp/core/web';
import { Empresa, ListaAmbientes, PerfilComAcoes } from '@macuxierp/core/contracts';
import { ConfiguracaoFilialResposta } from '@macuxierp/faturamento/contracts';
import { urlDaConfiguracaoDaFilial } from '@macuxierp/faturamento/web';
import type { Perfil } from '@macuxierp/platform-sdk';
import { ApiIndisponivel, NaoAutenticado, SemPermissao, getValidado } from '@/lib/api';
import { ROTA_SENHA, TrocarSenhaPendente } from '@/lib/troca-pendente';
import { RespostaFonte, opcoesDaResposta } from '@/lib/descritor/fontes';
import { cartoesDaBandeira } from '@/lib/telas/bandeira';
import { ambientesComPadrao } from '@/lib/telas/ambiente';
import { matrizDePerfis } from '@/lib/telas/core';
import { VistaAmbienteFiscal, VistaPerfis } from '@/components/core/vistas';
import { VistaBandeira } from '@/components/faturamento/vista-bandeira';
import { TEXTO_SEM_PERMISSAO } from '@/lib/telas/comum';
import { FalhaIndisponivel } from '@/components/falha-indisponivel';

/**
 * Quadros com componente próprio (T-0087, T-0088): perfis e permissões, ambiente fiscal e bandeira da NF-e simulada por filial. Carregam da
 * API com o token do cookie httpOnly; erro da API vira mensagem fixa, sem dado do registro. A API revalida perfil, tenant e licença.
 */
const FILIAIS = '/v1/cadastros/filiais?limite=200';

/** Sessão vencida e senha provisória resolvem com redirect; sem permissão e API fora do ar viram texto fixo. */
function falhaDoQuadro(e: unknown): React.ReactElement {
  if (e instanceof NaoAutenticado) redirect('/sessao/renovar');
  if (e instanceof TrocarSenhaPendente) redirect(ROTA_SENHA);
  if (e instanceof SemPermissao) return <p className="erro" role="alert">{TEXTO_SEM_PERMISSAO}</p>;
  if (e instanceof ApiIndisponivel) return <FalhaIndisponivel requestId={e.requestId} />;
  throw e;
}

/**
 * Nome por filial, lido do cadastros. No ambiente fiscal o nome é só enfeite (sem ele a tela mostra o id curto): falha do cadastros não derruba a
 * tela. Na bandeira a lista é a própria tela (`exigir`): falha do cadastros vira a mensagem fixa. Sessão vencida sempre resolve com redirect.
 */
async function nomesDasFiliais(acesso: string, perfil: Perfil, exigir = false): Promise<Record<string, string>> {
  try {
    const lista = opcoesDaResposta('/v1/cadastros/filiais', await getValidado(FILIAIS, RespostaFonte, acesso, 'filiais', true), perfil);
    return Object.fromEntries(lista.map((o) => [o.valor, o.rotulo]));
  } catch (e) {
    if (exigir || e instanceof NaoAutenticado || e instanceof TrocarSenhaPendente) throw e;
    return {};
  }
}

export async function TelaPerfis({ acesso }: { acesso: string }) {
  try {
    const r = await getValidado('/v1/core/perfis', z.object({ itens: z.array(PerfilComAcoes) }), acesso, 'perfis', true);
    return <VistaPerfis matriz={matrizDePerfis(r.itens)} />;
  } catch (e) {
    return falhaDoQuadro(e);
  }
}

export async function TelaAmbienteFiscal({ acesso, perfil }: { acesso: string; perfil: Perfil }) {
  try {
    const [empresa, ambientes, nomes] = await Promise.all([
      getValidado('/v1/core/empresa', Empresa, acesso, 'empresa', true),
      getValidado('/v1/core/ambientes-fiscais', ListaAmbientes, acesso, 'ambientes', true),
      nomesDasFiliais(acesso, perfil),
    ]);
    return <VistaAmbienteFiscal quadro={quadroEmpresaFiscal(empresa, ambientesComPadrao(ambientes.itens, Object.keys(nomes)), nomes)} />;
  } catch (e) {
    return falhaDoQuadro(e);
  }
}

export async function TelaBandeira({ acesso, perfil, rota, rotaDaPagina }: { acesso: string; perfil: Perfil; rota: string; rotaDaPagina: string }) {
  try {
    const nomes = await nomesDasFiliais(acesso, perfil, true);
    const filiais = Object.entries(nomes).map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    // Uma leitura por filial; a que falhar (fora sessão e permissão) só deixa o cartão dela com aviso.
    const lidas = await Promise.all(filiais.map(async (f) => {
      try {
        return [f.id, await getValidado(urlDaConfiguracaoDaFilial(f.id), ConfiguracaoFilialResposta, acesso, 'configuracao', true)] as const;
      } catch (e) {
        if (e instanceof NaoAutenticado || e instanceof TrocarSenhaPendente || e instanceof SemPermissao) throw e;
        return [f.id, null] as const;
      }
    }));
    return <VistaBandeira cartoes={cartoesDaBandeira(perfil, filiais, Object.fromEntries(lidas))} rota={rota} rotaDaPagina={rotaDaPagina} />;
  } catch (e) {
    return falhaDoQuadro(e);
  }
}

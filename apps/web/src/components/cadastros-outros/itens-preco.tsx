import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { apiItensPreco } from '@macuxierp/cadastros/web';
import { PrecoItemLista } from '@macuxierp/cadastros/contracts';
import type { Perfil } from '@macuxierp/platform-sdk';
import { ApiIndisponivel, DadosInvalidos, NaoAutenticado, SemPermissao, buscarRegistro, getValidado } from '@/lib/api';
import { buscarPagina } from '@/lib/listas';
import { RespostaFonte, opcoesDaResposta, type Opcao } from '@/lib/descritor/fontes';
import { urlProxima } from '@/lib/listas-url';
import { UUID_PADRAO } from '@/lib/uuid';
import { FalhaIndisponivel } from '@/components/falha-indisponivel';
import { ROTA_SENHA, TrocarSenhaPendente } from '@/lib/troca-pendente';
import { TEXTO_SEM_PERMISSAO } from '@/lib/telas/comum';
import { linhaDoItem, rotaDaTabela } from '@/lib/telas/cadastros-outros/itens-preco';
import { GradeItensPreco } from './grade-itens-preco';

const Tabela = z.object({ nome: z.string() }).passthrough();
const LIMITE = '100';

async function opcoes(fonte: string, acesso: string, perfil: Perfil): Promise<readonly Opcao[]> {
  try {
    return opcoesDaResposta(fonte, await getValidado(`${fonte}?limite=200`, RespostaFonte, acesso, 'fonte', true), perfil);
  } catch (e) {
    if (e instanceof NaoAutenticado || e instanceof TrocarSenhaPendente) throw e;
    return [];
  }
}

/** Itens da tabela de preço: lê a página de itens (cursor no servidor), os nomes de filial e produto e entrega a grade editável. */
export async function TelaItensPreco({ id, rota, busca, perfil, acesso }: { id: string; rota: string; busca: URLSearchParams; perfil: Perfil; acesso: string }) {
  if (!new RegExp(`^${UUID_PADRAO}$`).test(id)) notFound();
  try {
    const cursor = busca.get('cursor');
    const [tabela, pagina, filiais, produtos] = await Promise.all([
      buscarRegistro(`/v1/cadastros/tabelas-preco/${id}`, Tabela, acesso, 'tabela de preço'),
      buscarPagina(apiItensPreco(id), { limite: LIMITE, ...(cursor ? { cursor } : {}) }, PrecoItemLista, acesso),
      opcoes('/v1/cadastros/filiais', acesso, perfil),
      opcoes('/v1/cadastros/produtos', acesso, perfil),
    ]);
    if (tabela === null) notFound();
    const iniciais = pagina.itens.map(linhaDoItem);
    return (
      <>
        <p className="apoio">{tabela.nome}: preço por filial e produto. Salvar envia só o que foi alterado ou incluído.</p>
        <GradeItensPreco
          key={iniciais.map((l) => `${l.chave}:${l.preco_centavos}:${l.desconto_maximo_bp}`).join('|')}
          tabelaId={id} iniciais={iniciais} filiais={filiais} produtos={produtos} perfil={perfil} rota={rota}
          voltar={rotaDaTabela(id)} proxima={urlProxima(rota, {}, pagina.proximo_cursor)}
        />
      </>
    );
  } catch (e) {
    if (e instanceof NaoAutenticado) redirect('/sessao/renovar');
    if (e instanceof TrocarSenhaPendente) redirect(ROTA_SENHA);
    if (e instanceof SemPermissao) return <p className="erro" role="alert">{TEXTO_SEM_PERMISSAO}</p>;
    if (e instanceof ApiIndisponivel || e instanceof DadosInvalidos) return <FalhaIndisponivel requestId={e instanceof ApiIndisponivel ? e.requestId : undefined} />;
    throw e;
  }
}

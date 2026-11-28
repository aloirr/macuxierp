import { notFound, redirect } from 'next/navigation';
import type { Perfil } from '@macuxierp/platform-sdk';
import { ApiIndisponivel, DadosInvalidos, NaoAutenticado, SemPermissao, ehFalhaDeSessao, buscarRegistro, getValidado, textoSemPermissao } from '@/lib/api';
import { ROTA_SENHA, TrocarSenhaPendente } from '@/lib/troca-pendente';
import { RespostaFonte, caminhoDaFonte, opcoesDaResposta, type Opcao } from '@/lib/descritor/fontes';
import { recomecarLista } from '@macuxierp/platform-sdk/listas';
import type { TelaDescrita } from '@/lib/descritor/tipos';
import { z } from 'zod';
import { DetalheGenerico } from './detalhe-generico';
import { FormularioGenerico, type Aberto } from './formulario-generico';
import { ListaGenerica } from './lista-generica';
import { TEXTO_SEM_PERMISSAO } from '@/lib/telas/comum';
import { FalhaIndisponivel } from '@/components/falha-indisponivel';

const UUID = z.string().uuid();

function Falha({ texto, titulo }: { texto: string; titulo?: string }) {
  return <>{titulo && <h1>{titulo}</h1>}<p className="erro" role="alert">{texto}</p></>;
}

async function opcoes(fonte: string, acesso: string, perfil: Perfil): Promise<readonly Opcao[]> {
  try {
    return opcoesDaResposta(fonte, await getValidado(`${caminhoDaFonte(fonte)}?limite=200`, RespostaFonte, acesso, 'fonte', true), perfil);
  } catch (e) {
    if (ehFalhaDeSessao(e)) throw e;
    return [];
  }
}

/** Escolhe lista, detalhe ou formulário pelo descritor. Erros da API viram mensagem fixa, sem dado do registro. */
export async function TelaGenerica({ tela, titulo, rotaDaPagina, rota, params, busca, perfil, acesso, fuso, outrasSecoes, somenteLeitura = false }: { /** `paginaEditavel` falso (T-0129): o formulário abre só leitura. */ somenteLeitura?: boolean; outrasSecoes?: readonly { rota: string; titulo: string }[]; tela: TelaDescrita; titulo: string; rotaDaPagina: string; rota: string; params: Readonly<Record<string, string>>; busca: URLSearchParams; perfil: Perfil; acesso: string; fuso: string }) {
  try {
    if (tela.tipo === 'quadro') return null; // quadros têm componente próprio, escolhido pela página (page.tsx)
    if (tela.tipo === 'lista') return <ListaGenerica outrasSecoes={outrasSecoes} tela={tela} rota={rota} rotaDaPagina={rotaDaPagina} busca={busca} perfil={perfil} acesso={acesso} fuso={fuso} />;
    if (tela.tipo === 'detalhe') {
      const id = params.id ?? '';
      if (!UUID.safeParse(id).success) notFound();
      const [dados, motivos, eventos] = await Promise.all([
        buscarRegistro(tela.api(id), z.unknown(), acesso, 'detalhe'),
        // O catálogo é acessório: se falhar, o detalhe abre sem ele (as ações com motivo ficam desabilitadas).
        tela.motivosApi ? buscarRegistro(tela.motivosApi, z.unknown(), acesso, 'motivos').catch((e: unknown) => { if (ehFalhaDeSessao(e)) throw e; return null; }) : Promise.resolve(null),
        // O histórico em endpoint próprio também é acessório: sem ele, a tela não mostra a seção "Histórico".
        tela.eventosApi ? buscarRegistro(tela.eventosApi(id), z.unknown(), acesso, 'eventos').catch((e: unknown) => { if (ehFalhaDeSessao(e)) throw e; return null; }) : Promise.resolve(null),
      ]);
      if (dados === null) notFound();
      let vista;
      try {
        let historico: unknown;
        try {
          historico = eventos === null || !tela.lerEventos ? undefined : tela.lerEventos(eventos);
        } catch {
          historico = undefined; // eventos fora do contrato: o detalhe abre sem a seção
        }
        vista = tela.montar(tela.ler(dados), perfil, fuso, motivos, historico);
      } catch {
        throw new ApiIndisponivel('detalhe fora do contrato');
      }
      return <DetalheGenerico vista={vista} rota={rota} rotaDaPagina={rotaDaPagina} voltar={tela.voltar} />;
    }
    const todos = tela.camposDoPerfil?.(perfil) ?? tela.campos;
    const campos = todos.filter((c) => c.tipo === 'cadastro' && c.fonte);
    // Edição: abre com o registro (valores iniciais e original para o diff do PATCH); sem registro, 404.
    let aberto: Aberto | undefined;
    if (tela.edicao) {
      const id = params.id ?? '';
      if (!UUID.safeParse(id).success) notFound();
      const dados = await buscarRegistro(tela.edicao.ler(id), z.unknown(), acesso, 'detalhe');
      if (dados === null) notFound();
      try {
        aberto = { ...tela.edicao.abrir(dados), id };
      } catch {
        throw new ApiIndisponivel('registro fora do contrato');
      }
    }
    const [listas, produtos] = await Promise.all([
      Promise.all(campos.map((c) => opcoes(c.fonte ?? '', acesso, perfil))),
      tela.itens ? opcoes(tela.itens.fonte, acesso, perfil) : Promise.resolve([]),
    ]);
    return <FormularioGenerico rota={rotaDaPagina} opcoes={Object.fromEntries(campos.map((c, i) => [c.nome, listas[i] ?? []]))} produtos={produtos} perfil={perfil} campos={todos.map(({ mostrarSe: _m, colunasSe: _c, ...c }) => c)} aberto={aberto} somenteLeitura={somenteLeitura} />;
  } catch (e) {
    if (e instanceof NaoAutenticado) redirect('/sessao/renovar');
    if (e instanceof TrocarSenhaPendente) redirect(ROTA_SENHA);
    if (e instanceof SemPermissao) return <Falha texto={textoSemPermissao(e, TEXTO_SEM_PERMISSAO)} {...(tela.tipo === 'detalhe' ? { titulo } : {})} />;
    if (e instanceof DadosInvalidos && tela.tipo === 'lista') {
      // 400 da lista: recomeça na primeira página, sem cursor nem limite (contrato de listas).
      const q = new URLSearchParams(recomecarLista(Object.fromEntries(busca))).toString();
      redirect(q ? `${rota}?${q}` : rota);
    }
    if (e instanceof ApiIndisponivel || e instanceof DadosInvalidos) return <FalhaIndisponivel requestId={e instanceof ApiIndisponivel ? e.requestId : undefined} {...(tela.tipo === 'detalhe' ? { titulo } : {})} />;
    throw e;
  }
}

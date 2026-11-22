import { notFound, redirect } from 'next/navigation';
import type { Perfil } from '@macuxierp/platform-sdk';
import { ApiIndisponivel, DadosInvalidos, NaoAutenticado, SemPermissao, buscarRegistro, getValidado } from '@/lib/api';
import { RespostaFonte, caminhoDaFonte, opcoesDaResposta, type Opcao } from '@/lib/descritor/fontes';
import { recomecarLista } from '@macuxierp/platform-sdk/listas';
import type { TelaDescrita } from '@/lib/descritor/tipos';
import { z } from 'zod';
import { DetalheGenerico } from './detalhe-generico';
import { FormularioGenerico } from './formulario-generico';
import { ListaGenerica } from './lista-generica';

const UUID = z.string().uuid();

function Falha({ texto }: { texto: string }) {
  return <p className="erro" role="alert">{texto}</p>;
}

async function opcoes(fonte: string, acesso: string): Promise<readonly Opcao[]> {
  try {
    return opcoesDaResposta(fonte, await getValidado(`${caminhoDaFonte(fonte)}?limite=200`, RespostaFonte, acesso, 'fonte', true));
  } catch (e) {
    if (e instanceof NaoAutenticado) throw e;
    return [];
  }
}

/** Escolhe lista, detalhe ou formulário pelo descritor. Erros da API viram mensagem fixa, sem dado do registro. */
export async function TelaGenerica({ tela, rotaDaPagina, rota, params, busca, perfil, acesso, fuso }: { tela: TelaDescrita; rotaDaPagina: string; rota: string; params: Readonly<Record<string, string>>; busca: URLSearchParams; perfil: Perfil; acesso: string; fuso: string }) {
  try {
    if (tela.tipo === 'lista') return <ListaGenerica tela={tela} rota={rota} busca={busca} perfil={perfil} acesso={acesso} fuso={fuso} />;
    if (tela.tipo === 'detalhe') {
      const id = params.id ?? '';
      if (!UUID.safeParse(id).success) notFound();
      const [dados, motivos] = await Promise.all([
        buscarRegistro(tela.api(id), z.unknown(), acesso, 'detalhe'),
        // O catálogo é acessório: se falhar, o detalhe abre sem ele (as ações com motivo ficam desabilitadas).
        tela.motivosApi ? buscarRegistro(tela.motivosApi, z.unknown(), acesso, 'motivos').catch((e: unknown) => { if (e instanceof NaoAutenticado) throw e; return null; }) : Promise.resolve(null),
      ]);
      if (dados === null) notFound();
      let vista;
      try {
        vista = tela.montar(tela.ler(dados), perfil, fuso, motivos);
      } catch {
        throw new ApiIndisponivel('detalhe fora do contrato');
      }
      return <DetalheGenerico vista={vista} rota={rota} rotaDaPagina={rotaDaPagina} voltar={tela.voltar} />;
    }
    const campos = tela.campos.filter((c) => c.tipo === 'cadastro' && c.fonte);
    const [listas, produtos] = await Promise.all([
      Promise.all(campos.map((c) => opcoes(c.fonte ?? '', acesso))),
      tela.itens ? opcoes(tela.itens.fonte, acesso) : Promise.resolve([]),
    ]);
    return <FormularioGenerico rota={rotaDaPagina} opcoes={Object.fromEntries(campos.map((c, i) => [c.nome, listas[i] ?? []]))} produtos={produtos} />;
  } catch (e) {
    if (e instanceof NaoAutenticado) redirect('/sessao/renovar');
    if (e instanceof SemPermissao) return <Falha texto="Seu perfil não pode ver esta tela." />;
    if (e instanceof DadosInvalidos && tela.tipo === 'lista') {
      // 400 da lista: recomeça na primeira página, sem cursor nem limite (contrato de listas).
      const q = new URLSearchParams(recomecarLista(Object.fromEntries(busca))).toString();
      redirect(q ? `${rota}?${q}` : rota);
    }
    if (e instanceof ApiIndisponivel || e instanceof DadosInvalidos) return <Falha texto="Não foi possível carregar agora. Tente de novo em instantes." />;
    throw e;
  }
}

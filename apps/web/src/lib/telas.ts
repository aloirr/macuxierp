/** Registro das telas por rota da página (mesma chave de `PaginaRegistrada.rota`). Módulo novo soma o adaptador dele aqui. */
import type { AcaoVista, ExecutorDeAcoes, TelaDescrita, TelaDetalhe, TelaFormulario } from './descritor/tipos';
import { UUID_PADRAO } from './uuid';
import { TELAS_FATURAMENTO } from './telas/faturamento';
import { TELAS_INTEGRACAO_FDV } from './telas/integracao-fdv';
import { TELAS_PEDIDO } from './telas/pedido';

const TELAS: Readonly<Record<string, TelaDescrita>> = { ...TELAS_PEDIDO, ...TELAS_INTEGRACAO_FDV, ...TELAS_FATURAMENTO };

export function telaDaRota(rotaDaPagina: string): TelaDescrita | undefined {
  return TELAS[rotaDaPagina];
}

export function telaFormulario(rotaDaPagina: string): TelaFormulario | undefined {
  const t = TELAS[rotaDaPagina];
  return t?.tipo === 'formulario' ? t : undefined;
}

export function telaDetalhe(rotaDaPagina: string): TelaDetalhe | undefined {
  const t = TELAS[rotaDaPagina];
  return t?.tipo === 'detalhe' ? t : undefined;
}

/** De onde vem a ação: o detalhe, a barra da lista ou uma linha da lista. Cada origem tem o próprio validador e as próprias escritas. */
export type OrigemDasAcoes = 'detalhe' | 'barra' | 'linha';

/** Quem valida o diálogo e gera a Idempotency-Key das ações da página, conforme a origem da ação. */
export const executorDeAcoes = (rotaDaPagina: string, origem: OrigemDasAcoes = 'detalhe'): ExecutorDeAcoes | undefined => executorDaTela(TELAS[rotaDaPagina], origem);

export function executorDaTela(t: TelaDescrita | undefined, origem: OrigemDasAcoes): ExecutorDeAcoes | undefined {
  if (t?.tipo === 'detalhe') return origem === 'detalhe' ? t : undefined;
  if (t?.tipo === 'lista') return origem === 'linha' ? t.acaoDaLinha : origem === 'barra' ? t.acaoDaBarra : undefined;
  return undefined;
}

const padraoDe = (caminho: string) => new RegExp(`^${caminho.split(/:[a-z_]*id\b/).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(UUID_PADRAO)}$`);

/** A escrita (método e caminho) é a que algum descritor declarou: API do formulário ou caminho das ações do detalhe. */
export function escritaDeclarada(metodo: AcaoVista['metodo'] | string, caminho: string, telas: readonly TelaDescrita[] = Object.values(TELAS)): boolean {
  return telas.some((t) => {
    if (t.tipo === 'formulario') return metodo === 'POST' && t.api === caminho;
    const escritas = t.tipo === 'detalhe' ? t.escritas : t.tipo === 'lista' ? [...(t.acaoDaLinha?.escritas ?? []), ...(t.acaoDaBarra?.escritas ?? [])] : [];
    return escritas.some((e) => e.metodo === metodo && padraoDe(e.caminho).test(caminho));
  });
}

/** Registro das telas por rota da página (mesma chave de `PaginaRegistrada.rota`). Módulo novo soma o adaptador dele aqui. */
import type { AcaoVista, TelaDescrita, TelaDetalhe, TelaFormulario } from './descritor/tipos';
import { TELAS_INTEGRACAO_FDV } from './telas/integracao-fdv';
import { TELAS_PEDIDO } from './telas/pedido';

const TELAS: Readonly<Record<string, TelaDescrita>> = { ...TELAS_PEDIDO, ...TELAS_INTEGRACAO_FDV };

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

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const padraoDe = (caminho: string) => new RegExp(`^${caminho.split(':id').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(UUID)}$`);

/** A escrita (método e caminho) é a que algum descritor declarou: API do formulário ou caminho das ações do detalhe. */
export function escritaDeclarada(metodo: AcaoVista['metodo'] | string, caminho: string, telas: readonly TelaDescrita[] = Object.values(TELAS)): boolean {
  return telas.some((t) => {
    if (t.tipo === 'formulario') return metodo === 'POST' && t.api === caminho;
    if (t.tipo === 'detalhe') return t.escritas.some((e) => e.metodo === metodo && padraoDe(e.caminho).test(caminho));
    return false;
  });
}

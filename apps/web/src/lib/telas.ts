/** Registro das telas por rota da página (mesma chave de `PaginaRegistrada.rota`). Módulo novo soma o adaptador dele aqui. */
import type { TelaDescrita, TelaFormulario } from './descritor/tipos';
import { TELAS_PEDIDO } from './telas/pedido';

const TELAS: Readonly<Record<string, TelaDescrita>> = { ...TELAS_PEDIDO };

export function telaDaRota(rotaDaPagina: string): TelaDescrita | undefined {
  return TELAS[rotaDaPagina];
}

export function telaFormulario(rotaDaPagina: string): TelaFormulario | undefined {
  const t = TELAS[rotaDaPagina];
  return t?.tipo === 'formulario' ? t : undefined;
}

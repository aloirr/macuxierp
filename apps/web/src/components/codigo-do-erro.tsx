import { ROTULO_CODIGO_SUPORTE } from '@/lib/request-id';

/** "Código para o suporte: <id>" sob a mensagem de "indisponível": o id em fonte de código (`.codigo`), selecionável; sem id, nada. */
export function CodigoDoErro({ id }: { id: string | undefined }) {
  return id ? <p className="apoio" data-testid="codigo-erro">{ROTULO_CODIGO_SUPORTE} <code className="codigo">{id}</code></p> : null;
}

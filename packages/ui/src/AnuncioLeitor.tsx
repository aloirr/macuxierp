import { soLeitor } from './estilos.js';

/** Região viva só para leitor de tela: sempre montada, vazia sem texto. */
export function AnuncioLeitor({ texto }: { texto: string }) {
  return <p role="status" aria-live="polite" style={soLeitor}>{texto}</p>;
}

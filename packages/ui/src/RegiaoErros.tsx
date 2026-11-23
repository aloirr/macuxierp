import { AnuncioLeitor } from './AnuncioLeitor.js';
import { avisoErrosCampos } from './estilos.js';

/** Região única e sempre presente dos erros de campo (MC-0015): `role="status"`, oculta, vazia sem erro. */
export function RegiaoErros({ temErro }: { temErro: boolean }) {
  return <AnuncioLeitor texto={temErro ? avisoErrosCampos : ''} />;
}

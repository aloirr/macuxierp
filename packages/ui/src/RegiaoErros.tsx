import { avisoErrosCampos, soLeitor } from './estilos.js';

/** Região única e sempre presente dos erros de campo (MC-0015): `role="status"`, oculta, vazia sem erro. */
export function RegiaoErros({ temErro }: { temErro: boolean }) {
  return (
    <p role="status" aria-live="polite" style={soLeitor}>
      {temErro ? avisoErrosCampos : ''}
    </p>
  );
}

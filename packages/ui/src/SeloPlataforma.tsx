import { cor, seloBase } from './estilos.js';

/** Selo do topo do portal /config; spec em docs/design/portal-config.md (SeloPlataforma). */
export function SeloPlataforma() {
  return (
    <span
      style={{
        ...seloBase,
        background: 'transparent',
        border: `1px solid ${cor('azulClaro')}`,
        color: cor('branco'),
        padding: '1px 7px',
        borderRadius: 10,
      }}
    >
      Plataforma
    </span>
  );
}

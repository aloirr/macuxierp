import { canto, espaco, texto, tons } from './estilos.js';

export interface CaixaResumoProps {
  tom: 'sucesso' | 'aviso' | 'erro';
  numero: number;
  texto: string;
}

/** Número em destaque e a frase que o explica (ex.: "12 notas importadas"). */
export function CaixaResumo({ tom, numero, texto: frase }: CaixaResumoProps) {
  const t = tons[tom];
  return (
    <div style={{ ...texto('base'), ...t, border: `1px solid ${t.color}`, borderRadius: canto, padding: `${espaco.sm}px ${espaco.md}px`, display: 'flex', alignItems: 'baseline', gap: espaco.sm }}>
      <span style={{ ...texto('grande', 'titulo'), color: t.color }}>{numero}</span>
      <span>{frase}</span>
    </div>
  );
}

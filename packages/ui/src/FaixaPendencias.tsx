import { cor, espaco, texto } from './estilos.js';

export type NivelPendencia = 'bloqueante' | 'aceitavel';

export interface Pendencia {
  nivel: NivelPendencia;
  /** Código da regra, ex.: "RN-PED-004". Vai só para o atributo data-regra, não aparece na tela. */
  codigoRn: string;
  /** Texto curto: o problema e a ação. */
  texto: string;
}

export interface FaixaPendenciasProps {
  itens: Pendencia[];
}

/** Bloqueantes primeiro; dentro do nível mantém a ordem recebida. */
export function ordenarPendencias(itens: Pendencia[]): Pendencia[] {
  return [...itens.filter((i) => i.nivel === 'bloqueante'), ...itens.filter((i) => i.nivel !== 'bloqueante')];
}

export function FaixaPendencias({ itens }: FaixaPendenciasProps) {
  if (itens.length === 0) return null;
  const bloqueia = itens.some((i) => i.nivel === 'bloqueante');
  return (
    <section aria-label="Pendências" role={bloqueia ? 'alert' : 'status'} style={{ display: 'grid', gap: espaco.xs }}>
      {ordenarPendencias(itens).map((i) => {
        const erro = i.nivel === 'bloqueante';
        return (
          <div
            key={`${i.codigoRn}-${i.texto}`}
            data-nivel={i.nivel}
            data-regra={i.codigoRn}
            style={{
              ...texto('pequeno'),
              display: 'flex',
              gap: espaco.sm,
              padding: `${espaco.sm}px ${espaco.md}px`,
              background: cor(erro ? 'erroFundo' : 'avisoFundo'),
              color: cor(erro ? 'erroTexto' : 'avisoTexto'),
              borderLeft: `4px solid ${cor(erro ? 'erroTexto' : 'avisoTexto')}`,
            }}
          >
            <strong style={{ fontWeight: 'var(--mx-peso-rotulo-pequeno)' }}>{erro ? 'Bloqueia' : 'Atenção'}</strong>
            <span>{i.texto}</span>
          </div>
        );
      })}
    </section>
  );
}

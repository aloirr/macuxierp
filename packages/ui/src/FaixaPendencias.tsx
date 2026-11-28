import { cor, espaco, faixaLateral, soLeitor, texto, tons } from './estilos.js';
import { exigirSemPrefixo } from './semPrefixo.js';

export type NivelPendencia = 'bloqueante' | 'aceitavel';

export interface Pendencia {
  /** 'bloqueante' (cor de erro) só para falha que o usuário resolve na própria tela; o resto é 'aceitavel' (aviso). */
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
  for (const i of itens) exigirSemPrefixo(i.texto, 'FaixaPendencias');
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
              ...faixaLateral(erro ? tons.erro : tons.aviso),
              color: cor(erro ? 'erroTexto' : 'avisoTexto'),
            }}
          >
            <span>
              <span style={soLeitor}>{erro ? 'Erro: ' : 'Aviso: '}</span>
              {i.texto}
            </span>
          </div>
        );
      })}
    </section>
  );
}

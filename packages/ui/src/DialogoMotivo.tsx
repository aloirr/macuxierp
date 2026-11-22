import { useEffect, useId, useRef, useState } from 'react';
import { botaoSecundario, cor, espaco, mensagemErro, texto } from './estilos.js';

export interface MotivoOpcao {
  codigo: string;
  rotulo: string;
}

export interface ResultadoMotivo {
  /** Código do motivo escolhido, se houver. */
  motivo?: string;
  texto: string;
}

export interface DialogoMotivoProps {
  titulo: string;
  motivos?: MotivoOpcao[];
  /** Exige texto livre (padrão: opcional). */
  textoObrigatorio?: boolean;
  rotuloTexto?: string;
  rotuloConfirmar?: string;
  /** Aviso fixo do módulo (ex.: sobre dado pessoal). Sem aviso, nada aparece. */
  aviso?: string | null;
  /** Validação do módulo; devolve a mensagem de erro ou null. Roda depois da checagem básica. */
  validar?: (r: ResultadoMotivo) => string | null;
  aoConfirmar: (r: ResultadoMotivo) => void;
  aoCancelar: () => void;
}

/** Mensagem de erro ou null. Com motivos listados, escolher um é obrigatório. */
export function exigeEscolha(
  r: ResultadoMotivo,
  cfg: { motivos?: MotivoOpcao[]; textoObrigatorio?: boolean },
): string | null {
  if (cfg.motivos && cfg.motivos.length > 0 && !r.motivo) return 'Escolha um motivo.';
  if (cfg.textoObrigatorio && r.texto.trim() === '') return 'Descreva o motivo.';
  return null;
}

const FOCAVEIS = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

/** Próximo índice de foco com Tab preso (circular). */
export function proximoFoco(atual: number, total: number, voltar: boolean): number {
  if (total <= 0) return -1;
  return voltar ? (atual <= 0 ? total - 1 : atual - 1) : (atual + 1) % total;
}

export function DialogoMotivo(props: DialogoMotivoProps) {
  const { titulo, motivos = [], textoObrigatorio = false, rotuloTexto = 'Detalhe', rotuloConfirmar = 'Confirmar', aviso = null, validar, aoConfirmar, aoCancelar } = props;
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [motivo, setMotivo] = useState<string | undefined>();
  const [textoLivre, setTextoLivre] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    raiz.current?.querySelector<HTMLElement>(FOCAVEIS)?.focus();
    return () => anterior?.focus?.();
  }, []);

  const confirmar = () => {
    const r = { motivo, texto: textoLivre.trim() };
    const e = exigeEscolha(r, { motivos, textoObrigatorio }) ?? validar?.(r) ?? null;
    setErro(e);
    if (!e) aoConfirmar(r);
  };

  const teclado = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      aoCancelar();
    } else if (e.key === 'Tab') {
      const itens = Array.from(raiz.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? []);
      const i = proximoFoco(itens.indexOf(document.activeElement as HTMLElement), itens.length, e.shiftKey);
      if (i >= 0) {
        e.preventDefault();
        itens[i]?.focus();
      }
    }
  };

  const botaoPrincipal = {
    ...texto('pequeno', 'botao-principal'),
    padding: `${espaco.sm}px ${espaco.lg}px`,
    cursor: 'pointer' as const,
    border: `1px solid ${cor('azulNoite')}`,
    background: cor('azulNoite'),
    color: cor('branco'),
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center' }}
      data-fundo-dialogo
    >
      <div aria-hidden="true" onClick={aoCancelar} style={{ position: 'absolute', inset: 0, background: cor('grafite'), opacity: 0.55 }} />
      <div
        ref={raiz}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={aviso ? `${id}-aviso` : undefined}
        onKeyDown={teclado}
        style={{ ...texto('base'), background: cor('branco'), padding: espaco.xl, width: 'min(480px, 92vw)', display: 'grid', gap: espaco.md, position: 'relative' }}
      >
        <h2 id={`${id}-t`} style={{ ...texto('titulo-dialogo', 'titulo'), margin: 0 }}>{titulo}</h2>
        {motivos.length > 0 ? (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: espaco.xs }}>
            <legend style={texto('pequeno', 'rotulo-campo')}>Motivo</legend>
            {motivos.map((m) => (
              <label key={m.codigo} style={{ display: 'flex', gap: espaco.sm, alignItems: 'center' }}>
                <input type="radio" style={{ accentColor: cor('azulNoite') }} name={`${id}-m`} value={m.codigo} checked={motivo === m.codigo} onChange={() => setMotivo(m.codigo)} />
                {m.rotulo}
              </label>
            ))}
          </fieldset>
        ) : null}
        <label style={{ display: 'grid', gap: espaco.xs }}>
          <span style={texto('pequeno', 'rotulo-campo')}>
            {rotuloTexto}
            {textoObrigatorio ? '' : ' (opcional)'}
          </span>
          <textarea
            rows={3}
            value={textoLivre}
            required={textoObrigatorio}
            aria-required={textoObrigatorio}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? `${id}-erro` : undefined}
            onChange={(e) => setTextoLivre(e.target.value)}
            style={{ ...texto('base'), border: `1px solid ${cor('bordaCinza')}`, padding: espaco.sm }}
          />
        </label>
        {aviso ? (
          <p id={`${id}-aviso`} style={{ ...texto('pequeno'), color: cor('avisoTexto'), background: cor('avisoFundo'), margin: 0, padding: espaco.sm }}>
            {aviso}
          </p>
        ) : null}
        {erro ? <p id={`${id}-erro`} role="alert" style={{ ...mensagemErro, margin: 0 }}>{erro}</p> : null}
        <div style={{ display: 'flex', gap: espaco.sm, justifyContent: 'flex-end' }}>
          <button type="button" onClick={aoCancelar} style={{ ...botaoSecundario(), padding: `${espaco.sm}px ${espaco.lg}px` }}>Cancelar</button>
          <button type="button" onClick={confirmar} style={botaoPrincipal}>{rotuloConfirmar}</button>
        </div>
      </div>
    </div>
  );
}

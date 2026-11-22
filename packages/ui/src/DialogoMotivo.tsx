import { useEffect, useId, useRef, useState } from 'react';
import { cor, espaco, texto } from './estilos.js';

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
  aoConfirmar: (r: ResultadoMotivo) => void;
  aoCancelar: () => void;
}

export const AVISO_LGPD = 'Não escreva dado pessoal (nome, CPF, telefone, e-mail).';

/** Mensagem de erro ou null. Com motivos listados, escolher um é obrigatório. */
export function validarMotivo(
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
  const { titulo, motivos = [], textoObrigatorio = false, rotuloTexto = 'Detalhe', rotuloConfirmar = 'Confirmar', aoConfirmar, aoCancelar } = props;
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
    const e = validarMotivo(r, { motivos, textoObrigatorio });
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

  const botao = (principal: boolean) => ({
    ...texto('pequeno', principal ? 'titulo' : 'medio'),
    padding: `${espaco.sm}px ${espaco.lg}px`,
    cursor: 'pointer',
    border: `1px solid ${principal ? cor('azulNoite') : cor('bordaCinza')}`,
    background: principal ? cor('azulNoite') : cor('branco'),
    color: principal ? cor('branco') : cor('grafite'),
  });

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
        aria-describedby={`${id}-lgpd`}
        onKeyDown={teclado}
        style={{ ...texto('base'), background: cor('branco'), padding: espaco.xl, width: 'min(480px, 92vw)', display: 'grid', gap: espaco.md, position: 'relative' }}
      >
        <h2 id={`${id}-t`} style={{ ...texto('grande', 'titulo'), margin: 0 }}>{titulo}</h2>
        {motivos.length > 0 ? (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: espaco.xs }}>
            <legend style={texto('pequeno', 'cabecalho-tabela')}>Motivo</legend>
            {motivos.map((m) => (
              <label key={m.codigo} style={{ display: 'flex', gap: espaco.sm, alignItems: 'center' }}>
                <input type="radio" name={`${id}-m`} value={m.codigo} checked={motivo === m.codigo} onChange={() => setMotivo(m.codigo)} />
                {m.rotulo}
              </label>
            ))}
          </fieldset>
        ) : null}
        <label style={{ display: 'grid', gap: espaco.xs }}>
          <span style={texto('pequeno', 'cabecalho-tabela')}>
            {rotuloTexto}
            {textoObrigatorio ? '' : ' (opcional)'}
          </span>
          <textarea
            rows={3}
            value={textoLivre}
            required={textoObrigatorio}
            aria-required={textoObrigatorio}
            onChange={(e) => setTextoLivre(e.target.value)}
            style={{ ...texto('base'), border: `1px solid ${cor('bordaCinza')}`, padding: espaco.sm }}
          />
        </label>
        <p id={`${id}-lgpd`} style={{ ...texto('micro'), color: cor('avisoTexto'), background: cor('avisoFundo'), margin: 0, padding: espaco.sm }}>
          {AVISO_LGPD}
        </p>
        {erro ? <p role="alert" style={{ ...texto('pequeno'), color: cor('erroTexto'), margin: 0 }}>{erro}</p> : null}
        <div style={{ display: 'flex', gap: espaco.sm, justifyContent: 'flex-end' }}>
          <button type="button" onClick={aoCancelar} style={botao(false)}>Cancelar</button>
          <button type="button" onClick={confirmar} style={botao(true)}>{rotuloConfirmar}</button>
        </div>
      </div>
    </div>
  );
}

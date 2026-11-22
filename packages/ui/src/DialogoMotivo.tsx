'use client';

import type { CSSProperties } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { botaoPrincipal, botaoSecundario, campoBase, cor, espaco, mensagemErro, texto } from './estilos.js';

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
  /** Texto do botão que chama `aoCancelar` (padrão: "Cancelar"). Ex.: "Manter a nota". */
  rotuloFechar?: string;
  /** Só sinal: marca o botão de confirmar com `data-destrutivo="true"`. Nenhuma cor muda nesta versão. */
  destrutivo?: boolean;
  /** Aviso fixo do módulo (ex.: sobre dado pessoal). Sem aviso, nada aparece. */
  aviso?: string | null;
  /** Validação do módulo; devolve a mensagem de erro ou null. Roda depois da checagem básica. */
  validar?: (r: ResultadoMotivo) => string | null;
  aoConfirmar: (r: ResultadoMotivo) => void;
  aoCancelar: () => void;
}

/** Erro de campo (MC-0015): qual campo e a mensagem; ou null. Com motivos listados, escolher um é obrigatório. */
export interface ErroDialogo {
  campo: 'motivo' | 'texto';
  mensagem: string;
}

export function exigeEscolha(
  r: ResultadoMotivo,
  cfg: { motivos?: MotivoOpcao[]; textoObrigatorio?: boolean },
): ErroDialogo | null {
  if (cfg.motivos && cfg.motivos.length > 0 && !r.motivo) return { campo: 'motivo', mensagem: 'Nenhum motivo escolhido. Escolha um da lista.' };
  if (cfg.textoObrigatorio && r.texto.trim() === '') return { campo: 'texto', mensagem: 'O detalhe está vazio. Descreva o motivo.' };
  return null;
}

/** Checagem do confirmar: a básica primeiro; o `validar` do módulo só roda se ela não achou erro. */
export function avaliarConfirmacao(
  r: ResultadoMotivo,
  cfg: { motivos?: MotivoOpcao[]; textoObrigatorio?: boolean; validar?: (r: ResultadoMotivo) => string | null },
): ErroDialogo | null {
  const basico = exigeEscolha(r, cfg);
  if (basico) return basico;
  const msg = cfg.validar?.(r) ?? null;
  return msg ? { campo: 'texto', mensagem: msg } : null;
}

/** Rádio sem o visual do navegador: borda de campo; marcado em azul-noite com ponto branco interno. */
const radioEstilo = (marcado: boolean): CSSProperties => ({
  appearance: 'none',
  width: 16,
  height: 16,
  margin: 0,
  borderRadius: '50%',
  border: `1px solid ${marcado ? cor('azulNoite') : cor('bordaCampo')}`,
  background: marcado ? cor('azulNoite') : cor('branco'),
  boxShadow: marcado ? `inset 0 0 0 4px ${cor('branco')}` : undefined,
});

const FOCAVEIS = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

/** Próximo índice de foco com Tab preso (circular). */
export function proximoFoco(atual: number, total: number, voltar: boolean): number {
  if (total <= 0) return -1;
  return voltar ? (atual <= 0 ? total - 1 : atual - 1) : (atual + 1) % total;
}

export function DialogoMotivo(props: DialogoMotivoProps) {
  const { titulo, motivos = [], textoObrigatorio = false, rotuloTexto = 'Detalhe', rotuloConfirmar = 'Confirmar', rotuloFechar = 'Cancelar', destrutivo = false, aviso = null, validar, aoConfirmar, aoCancelar } = props;
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [motivo, setMotivo] = useState<string | undefined>();
  const [textoLivre, setTextoLivre] = useState('');
  const [erro, setErro] = useState<ErroDialogo | null>(null);

  const erroMotivo = erro?.campo === 'motivo' ? erro.mensagem : null;
  const erroTexto = erro?.campo === 'texto' ? erro.mensagem : null;
  const coluna = { display: 'grid', gap: espaco.xs } as const;

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    raiz.current?.querySelector<HTMLElement>(FOCAVEIS)?.focus();
    return () => anterior?.focus?.();
  }, []);

  const confirmar = () => {
    const r = { motivo, texto: textoLivre.trim() };
    const e = avaliarConfirmacao(r, { motivos, textoObrigatorio, validar });
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
          <>
          <fieldset aria-describedby={erroMotivo ? `${id}-erro-motivo` : undefined} style={{ border: 0, padding: 0, margin: 0, ...coluna }}>
            <legend style={texto('pequeno', 'rotulo-campo')}>Motivo</legend>
            {motivos.map((m) => (
              <label key={m.codigo} style={{ display: 'flex', gap: espaco.sm, alignItems: 'center' }}>
                <input type="radio" style={radioEstilo(motivo === m.codigo)} name={`${id}-m`} value={m.codigo} checked={motivo === m.codigo} onChange={() => setMotivo(m.codigo)} />
                {m.rotulo}
              </label>
            ))}
          </fieldset>
          {erroMotivo ? <span id={`${id}-erro-motivo`} role="alert" style={mensagemErro}>{erroMotivo}</span> : null}
          </>
        ) : null}
        <div style={coluna}>
        <label style={coluna}>
          <span style={texto('pequeno', 'rotulo-campo')}>
            {rotuloTexto}
            {textoObrigatorio ? '' : ' (opcional)'}
          </span>
          <textarea
            rows={3}
            value={textoLivre}
            required={textoObrigatorio}
            aria-required={textoObrigatorio}
            aria-invalid={erroTexto ? true : undefined}
            aria-describedby={erroTexto ? `${id}-erro-texto` : undefined}
            onChange={(e) => setTextoLivre(e.target.value)}
            style={{ ...campoBase, padding: espaco.sm, ...(erroTexto ? { borderColor: cor('erroTexto') } : {}) }}
          />
        </label>
        {erroTexto ? <span id={`${id}-erro-texto`} role="alert" style={mensagemErro}>{erroTexto}</span> : null}
        </div>
        {aviso ? (
          <p id={`${id}-aviso`} style={{ ...texto('pequeno'), color: cor('avisoTexto'), background: cor('avisoFundo'), margin: 0, padding: espaco.sm }}>
            {aviso}
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: espaco.sm, justifyContent: 'flex-end' }}>
          <button type="button" onClick={aoCancelar} style={botaoSecundario()}>{rotuloFechar}</button>
          <button type="button" onClick={confirmar} data-destrutivo={destrutivo ? 'true' : undefined} style={botaoPrincipal()}>{rotuloConfirmar}</button>
        </div>
      </div>
    </div>
  );
}

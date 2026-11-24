'use client';

import { useId, useState } from 'react';
import { botaoDestrutivo, botaoPrincipal, botaoSecundario, campoBase, cor, espaco, mensagemErro, radioBase, radioMarcado, texto } from './estilos.js';
import { Dialogo } from './Dialogo.js';
import { RegiaoErros } from './RegiaoErros.js';

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
  /** Sem campo de texto (ex.: redefinir senha, desligar módulo). Ignora `textoObrigatorio`; `aoConfirmar` recebe `texto: ''`. */
  semTexto?: boolean;
  rotuloConfirmar?: string;
  /** Texto do botão que chama `aoCancelar` (padrão: "Cancelar"). Ex.: "Manter a nota". */
  rotuloFechar?: string;
  /** Ação irreversível: confirmar em vermelho (erro-texto) e `data-destrutivo="true"`. */
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

type CfgEscolha = { motivos?: MotivoOpcao[]; textoObrigatorio?: boolean; semTexto?: boolean };

export function exigeEscolha(
  r: ResultadoMotivo,
  cfg: CfgEscolha,
): ErroDialogo | null {
  if (cfg.motivos && cfg.motivos.length > 0 && !r.motivo) return { campo: 'motivo', mensagem: 'Nenhum motivo escolhido. Escolha um da lista.' };
  if (!cfg.semTexto && cfg.textoObrigatorio && r.texto.trim() === '') return { campo: 'texto', mensagem: 'O detalhe está vazio. Descreva o motivo.' };
  return null;
}

/** Checagem do confirmar: a básica primeiro; o `validar` do módulo só roda se ela não achou erro. */
export function avaliarConfirmacao(
  r: ResultadoMotivo,
  cfg: CfgEscolha & { validar?: (r: ResultadoMotivo) => string | null },
): ErroDialogo | null {
  const basico = exigeEscolha(r, cfg);
  if (basico) return basico;
  const msg = cfg.validar?.(r) ?? null;
  return msg ? { campo: 'texto', mensagem: msg } : null;
}

/** O aviso dele é âmbar mesmo com `destrutivo` (é aviso de dado pessoal, não de irreversível). */
export function DialogoMotivo(props: DialogoMotivoProps) {
  const { titulo, motivos = [], textoObrigatorio = false, rotuloTexto = 'Detalhe', semTexto = false, rotuloConfirmar = 'Confirmar', rotuloFechar = 'Cancelar', destrutivo = false, aviso = null, validar, aoConfirmar, aoCancelar } = props;
  const id = useId();
  const [motivo, setMotivo] = useState<string | undefined>();
  const [textoLivre, setTextoLivre] = useState('');
  const [erro, setErro] = useState<ErroDialogo | null>(null);

  const erroMotivo = erro?.campo === 'motivo' ? erro.mensagem : null;
  const erroTexto = erro?.campo === 'texto' ? erro.mensagem : null;
  const coluna = { display: 'grid', gap: espaco.xs } as const;

  const confirmar = () => {
    const r = { motivo, texto: semTexto ? '' : textoLivre.trim() };
    const e = avaliarConfirmacao(r, { motivos, textoObrigatorio, semTexto, validar });
    setErro(e);
    if (!e) aoConfirmar(r);
  };

  return (
    <Dialogo
      titulo={titulo}
      aoFechar={aoCancelar}
      aviso={aviso}
      rodape={
        <>
          <button type="button" onClick={aoCancelar} style={botaoSecundario()}>{rotuloFechar}</button>
          <button type="button" onClick={confirmar} data-destrutivo={destrutivo ? 'true' : undefined} style={destrutivo ? botaoDestrutivo() : botaoPrincipal()}>{rotuloConfirmar}</button>
        </>
      }
    >
        <RegiaoErros temErro={!!erro} />
        {motivos.length > 0 ? (
          <>
          <fieldset aria-describedby={erroMotivo ? `${id}-erro-motivo` : undefined} style={{ border: 0, padding: 0, margin: 0, ...coluna }}>
            <legend style={texto('pequeno', 'rotulo-campo')}>Motivo</legend>
            {motivos.map((m) => (
              <label key={m.codigo} style={{ display: 'flex', gap: espaco.sm, alignItems: 'center' }}>
                <input type="radio" style={motivo === m.codigo ? { ...radioBase, ...radioMarcado } : radioBase} name={`${id}-m`} value={m.codigo} checked={motivo === m.codigo} onChange={() => setMotivo(m.codigo)} />
                {m.rotulo}
              </label>
            ))}
          </fieldset>
          {erroMotivo ? <span id={`${id}-erro-motivo`} style={mensagemErro}>{erroMotivo}</span> : null}
          </>
        ) : null}
        {semTexto ? null : (
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
        {erroTexto ? <span id={`${id}-erro-texto`} style={mensagemErro}>{erroTexto}</span> : null}
        </div>
        )}
    </Dialogo>
  );
}

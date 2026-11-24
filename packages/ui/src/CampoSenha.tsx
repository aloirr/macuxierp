import type { CSSProperties } from 'react';
import { ROTULOS_OLHO_SENHA } from '@macuxierp/platform-sdk';
import { campoBase, canto, cor, espaco, mensagemErro, texto } from './estilos.js';

export interface CampoSenhaProps {
  /** Obrigatório: liga o rótulo ao campo e dá o id do erro (`<id>-erro`). */
  id: string;
  /** Rótulo visível do campo (ex.: "Senha", "Senha nova"). */
  rotulo: string;
  /** Valor atual, só no estado do formulário (nunca em URL, storage ou log). */
  valor: string;
  aoMudar: (valor: string) => void;
  /** Controlado pela tela: `true` mostra a senha, `false` (comece assim) a oculta. */
  visivel: boolean;
  /** Troca `visivel`. Sem ele não há olho (ex.: "Repita a senha", que segue o `visivel` do "Senha nova"). */
  aoAlternar?: () => void;
  /** `entrada` (padrão, login e senha atual): `current-password`. `criacao` (senha nova): `new-password`. */
  finalidade?: 'entrada' | 'criacao';
  nome?: string;
  /** Erro de campo (MC-0015): borda vermelha e texto embaixo, lido pelo leitor de tela. */
  erro?: string | undefined;
  /** Id do elemento da tela que descreve o campo (ex.: a lista de regras da senha); entra no `aria-describedby`. */
  descrito?: string;
  /** Padrão: obrigatório. */
  obrigatorio?: boolean;
  desabilitado?: boolean;
}

/** Ícones Tabler IconEye e IconEyeOff (MIT), como no FDV, em 18 px. */
const olho = (riscado: boolean) => (
  <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {riscado ? (
      <>
        <path d="M10.585 10.587a2 2 0 0 0 2.829 2.828" />
        <path d="M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87" />
        <path d="M3 3l18 18" />
      </>
    ) : (
      <>
        <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
        <path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />
      </>
    )}
  </svg>
);

/** Olho: 44×44 colado à direita, só ícone, sem fundo nem borda própria (hover e foco em `.mx-olho`, `botoes.css`). */
const botaoOlho: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  width: 44,
  height: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: canto,
  background: 'transparent',
  color: cor('textoSecundario'),
  cursor: 'pointer',
};

/** Campo de senha com olho à direita, controlado pela tela; ver docs/design/campo-senha/README.md. */
export function CampoSenha({ id, rotulo, valor, aoMudar, visivel, aoAlternar, finalidade = 'entrada', nome, erro, descrito, obrigatorio = true, desabilitado }: CampoSenhaProps) {
  const rotuloOlho = visivel ? ROTULOS_OLHO_SENHA.ocultar : ROTULOS_OLHO_SENHA.mostrar;
  const descricao = [descrito, erro ? `${id}-erro` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div style={{ ...texto('base') }}>
      <label htmlFor={id} style={{ ...texto('pequeno', 'rotulo-campo'), display: 'block', marginBottom: espaco.xs }}>{rotulo}</label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          name={nome}
          type={visivel ? 'text' : 'password'}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          autoComplete={finalidade === 'criacao' ? 'new-password' : 'current-password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required={obrigatorio}
          disabled={desabilitado}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descricao}
          style={{
            ...campoBase,
            ...texto('base'),
            boxSizing: 'border-box',
            width: '100%',
            height: 44,
            padding: `0 ${aoAlternar ? 48 : espaco.md}px 0 ${espaco.md}px`,
            background: cor('branco'),
            ...(erro ? { borderColor: cor('erroTexto') } : {}),
          }}
        />
        {aoAlternar && (
          <button
            type="button"
            className="mx-olho"
            style={botaoOlho}
            onClick={aoAlternar}
            onMouseDown={(e) => e.preventDefault()}
            aria-label={rotuloOlho}
            title={rotuloOlho}
            disabled={desabilitado}
          >
            {olho(visivel)}
          </button>
        )}
      </div>
      {erro && <span id={`${id}-erro`} role="alert" style={{ ...mensagemErro, fontSize: 'var(--mx-tamanho-micro)', marginTop: espaco.xs }}>{erro}</span>}
    </div>
  );
}

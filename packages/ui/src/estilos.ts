import type { CSSProperties } from 'react';
import type { Cor, escala, papeis, pesos } from './tokens.js';
import { cores } from './tokens.js';

/** Cor do token da marca como `var()`; nunca literal (T-0028). */
export const cor = (nome: Cor | 'ativoTexto' | 'inativoFundo' | 'linhaSuave'): string =>
  `var(--mx-cor-${nome.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`;

/** Espaçamentos em múltiplos de 4px (a marca ainda não tem tokens de espaço; ver RD no doc de design). */
export const espaco = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

type Kebab<S extends string> = S extends `${infer A}${infer R}` ? `${A extends Lowercase<A> ? A : `-${Lowercase<A>}`}${Kebab<R>}` : S;
type TamanhoTexto = Kebab<keyof typeof escala | keyof typeof papeis>;
type PesoTexto = Kebab<keyof typeof pesos>;

export const texto = (tamanho: TamanhoTexto, peso?: PesoTexto): CSSProperties => ({
  fontFamily: 'var(--mx-fonte-texto)',
  fontSize: `var(--mx-tamanho-${tamanho})`,
  fontWeight: peso ? `var(--mx-peso-${peso})` : undefined,
  color: cor('grafite'),
});

export const tabular: CSSProperties = { fontVariantNumeric: 'tabular-nums' };
export const numerico: CSSProperties = { ...tabular, textAlign: 'right' };
/** Canto dos botões e do shell. */
export const canto = '6px';

/** Estado desabilitado único (MC-0014): esmaecido e sem cursor de ação. */
export const desabilitadoEstilo = (desabilitado?: boolean): CSSProperties =>
  desabilitado ? { opacity: 0.55, cursor: 'not-allowed' } : { cursor: 'pointer' };

/** Base comum dos botões (MC-0008): 15 px ("base"), canto de 6 px e o mesmo espaçamento. */
const baseBotao = (peso: Parameters<typeof texto>[1], desabilitado?: boolean): CSSProperties => ({
  ...texto('base', peso),
  padding: `${espaco.sm}px ${espaco.lg}px`,
  borderRadius: canto,
  lineHeight: 1.5,
  ...desabilitadoEstilo(desabilitado),
});

/** Botão principal (MC-0008): azul-noite, texto branco. Um por tela. */
export const botaoPrincipal = (desabilitado?: boolean): CSSProperties => ({
  ...baseBotao('botao-principal', desabilitado),
  background: cor('azulNoite'),
  color: cor('branco'),
  border: `1px solid ${cor('azulNoite')}`,
});

/** Botão destrutivo: confirmar irreversível em erro-texto. */
export const botaoDestrutivo = (desabilitado?: boolean): CSSProperties => ({
  ...botaoPrincipal(desabilitado),
  background: cor('erroTexto'),
  border: `1px solid ${cor('erroTexto')}`,
});

/** Botão secundário (MC-0008): branco, borda de campo, peso médio. */
export const botaoSecundario = (desabilitado?: boolean): CSSProperties => ({
  ...baseBotao('medio', desabilitado),
  background: cor('branco'),
  color: cor('grafite'),
  border: `1px solid ${cor('bordaCampo')}`,
});

/** Hover do botão principal: fundo e borda em grafite (só cor da paleta; sem `filter`). */
const botaoPrincipalHover: CSSProperties = { background: cor('grafite'), border: `1px solid ${cor('grafite')}` };

/** Hover do botão secundário: fundo névoa. */
const botaoSecundarioHover: CSSProperties = { background: cor('nevoa') };

const contornoFoco = (c: Cor): CSSProperties => ({ outline: `2px solid ${cor(c)}`, outlineOffset: '2px' });
/** Foco visível dos botões (MC-0011): contorno de 2 px em azul-noite. */
export const focoVisivel: CSSProperties = contornoFoco('azulNoite');
/** Foco em fundo escuro (azul-noite, grafite): branco, mesmo traço. Vale dentro de `.mx-fundo-escuro`. */
export const focoVisivelEscuro: CSSProperties = contornoFoco('branco');

const kebabCss = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
/** Propriedades numéricas sem unidade em CSS; uma nova (gridRow, columnCount…) precisa entrar nesta lista. */
const semUnidade = new Set(['lineHeight', 'opacity', 'fontWeight', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'order']);
const regraCss = (seletor: string, e: CSSProperties) =>
  `${seletor} {\n${Object.entries(e)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `  ${kebabCss(k)}: ${typeof v === 'number' && v !== 0 && !semUnidade.has(k) ? `${v}px` : String(v)};`)
    .join('\n')}\n}\n`;

/** Base comum do rádio e da caixa: sem o visual do navegador, borda de campo, fundo branco. */
const selecaoBase: CSSProperties = {
  appearance: 'none',
  width: 16,
  height: 16,
  margin: 0,
  borderRadius: undefined, // reserva a posição; rádio e caixa preenchem (ordem do CSS gerado)
  border: `1px solid ${cor('bordaCampo')}`,
  background: cor('branco'),
};
/** O que muda ao marcar (rádio e caixa): azul-noite. */
const selecaoMarcada: CSSProperties = {
  border: `1px solid ${cor('azulNoite')}`,
  background: cor('azulNoite'),
};

/** Rádio desmarcado: borda de campo, fundo branco. */
export const radioBase: CSSProperties = { ...selecaoBase, borderRadius: '50%' };
/** O que muda no rádio marcado: azul-noite com ponto branco interno. */
export const radioMarcado: CSSProperties = {
  ...selecaoMarcada,
  boxShadow: `inset 0 0 0 4px ${cor('branco')}`,
};

/** Caixa de seleção desmarcada: borda de campo, fundo branco. */
export const checkboxBase: CSSProperties = { ...selecaoBase, borderRadius: '3px' };
const vistoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="M2 6.5 5 9.5 10 3" fill="none" stroke="${cores.branco}" stroke-width="2"/></svg>`;
/** O que muda na caixa marcada: azul-noite com visto branco (cor dos tokens). */
export const checkboxMarcado: CSSProperties = {
  ...selecaoMarcada,
  backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(vistoSvg)}")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'center',
  backgroundSize: '12px 12px',
};

/** Conteúdo de `botoes.css` (classes `.mx-botao` e `.mx-botao-secundario` para o shell), dos mesmos objetos acima. */
export function gerarCssBotoes(): string {
  return (
    '/* Gerado de estilos.ts (gerarCssBotoes). Não edite à mão: o teste exige igualdade. */\n' +
    regraCss('.mx-botao', botaoPrincipal()) +
    regraCss('.mx-botao-secundario', botaoSecundario()) +
    regraCss('.mx-botao-destrutivo', botaoDestrutivo()) +
    regraCss('.mx-botao:hover:not(:disabled)', botaoPrincipalHover) +
    regraCss('.mx-botao-secundario:hover:not(:disabled)', botaoSecundarioHover) +
    regraCss('.mx-botao:focus-visible, .mx-botao-secundario:focus-visible, .mx-botao-destrutivo:focus-visible', focoVisivel) +
    regraCss('.mx-radio', radioBase) +
    regraCss('.mx-radio:checked', radioMarcado) +
    regraCss('.mx-radio:focus-visible', focoVisivel) +
    regraCss('.mx-checkbox', checkboxBase) +
    regraCss('.mx-checkbox:checked', checkboxMarcado) +
    regraCss('.mx-checkbox:focus-visible', focoVisivel) +
    regraCss('.mx-fundo-escuro :focus-visible', focoVisivelEscuro) +
    regraCss('.mx-botao:disabled, .mx-botao-secundario:disabled, .mx-botao-destrutivo:disabled', desabilitadoEstilo(true)) +
    regraCss('.mx-checkbox:disabled, .mx-radio:disabled', desabilitadoEstilo(true))
  );
}

/** Campo de texto do pacote (input, textarea): 13 px, borda de campo e canto de 6 px. */
export const campoBase: CSSProperties = {
  ...texto('pequeno'),
  border: `1px solid ${cor('bordaCampo')}`,
  borderRadius: canto,
  padding: espaco.xs,
};

/** Mensagem de erro de campo (MC-0015). */
export const mensagemErro: CSSProperties = { ...texto('pequeno'), display: 'block', color: cor('erroTexto') };

/** Visualmente oculto, lido por leitor de tela (região `role="status"` dos erros de campo). */
export const soLeitor: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  margin: '-1px',
  padding: 0,
  border: 0,
};

/** Texto único da região de erros (igual ao do shell). */
export const avisoErrosCampos = 'Há campos com erro. Confira as mensagens abaixo de cada campo.';

/** Estilo único das duas tabelas (MC-0013). */
export const tabela = {
  raiz: { ...texto('pequeno'), width: '100%', borderCollapse: 'collapse', background: cor('branco') } as CSSProperties,
  cabecalho: { ...texto('pequeno', 'cabecalho-tabela'), textAlign: 'left', padding: `${espaco.xs}px ${espaco.md}px`, borderBottom: `1px solid ${cor('bordaTabela')}`, background: cor('nevoa') } as CSSProperties,
  celula: { padding: `${espaco.xs}px ${espaco.md}px`, borderBottom: `1px solid ${cor('bordaTabela')}`, verticalAlign: 'top' } as CSSProperties,
  /** Célula numérica ou de dinheiro: sem quebra de linha (o `th` continua só com `numerico`). */
  celulaNumerica: { ...numerico, whiteSpace: 'nowrap' } as CSSProperties,
  /** Legenda de tabela: 15 px (base), peso 600, à esquerda. */
  legenda: { ...texto('base', 'rotulo-campo'), textAlign: 'left', padding: espaco.sm } as CSSProperties,
  vazio: { textAlign: 'center', color: cor('textoSecundario'), padding: espaco.xl } as CSSProperties,
};

/** Base do selo de situação (igual ao `.selo` do shell): 12 px, canto 10 px, sem quebra. */
export const seloBase: CSSProperties = { ...texto('selo', 'rotulo-pequeno'), padding: '2px 8px', borderRadius: '10px', whiteSpace: 'nowrap' };

/** Mapa de cores de estado (T-0058). O laranja do sol não é cor de estado. */
export const tons = {
  sucesso: { color: cor('verdeSucesso'), background: cor('ativoFundo') },
  aviso: { color: cor('avisoTexto'), background: cor('avisoFundo') },
  erro: { color: cor('erroTexto'), background: cor('erroFundo') },
  neutro: { color: cor('textoSecundario'), background: cor('inativoFundo') },
} as const satisfies Record<string, { color: string; background: string }>;

/** Faixa lateral de 4 px do tom (fundo + barra na cor do texto), usada por alertas e pendências bloqueantes. */
export const faixaLateral = (tom: { color: string; background: string }): CSSProperties => ({
  background: tom.background,
  borderLeft: `4px solid ${tom.color}`,
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DialogoMotivo } from './DialogoMotivo.js';
import { FormularioItens, type ItemLinha } from './FormularioItens.js';
import { avisoErrosCampos, checkboxBase, checkboxMarcado, gerarCssBotoes, radioBase, radioMarcado } from './estilos.js';
import { cores } from './tokens.js';

const item: ItemLinha = { chave: 'item-1', produtoId: 'p', quantidade: 1, precoUnitarioCentavos: 100, descontoCentavos: 0 };
const form = (erros?: Record<string, string | Record<string, string>>, temErroExterno?: boolean) =>
  renderToStaticMarkup(
    <FormularioItens temErroExterno={temErroExterno} itens={[item]} aoMudar={() => {}} novoItem={(chave) => ({ ...item, chave })} calcularTotal={() => 0} formatarCentavos={String} renderSeletorProduto={() => null} erros={erros} />,
  );
const dialogo = () => renderToStaticMarkup(<DialogoMotivo titulo="T" motivos={[{ codigo: 'a', rotulo: 'A' }]} aoConfirmar={() => {}} aoCancelar={() => {}} />);
const regiao = /<p role="status" aria-live="polite" style="([^"]*)">([^<]*)<\/p>/;

describe('MC-0015: região única role=status (igual ao shell)', () => {
  it('FormularioItens: sem erro a região existe e está vazia; com erro traz o texto', () => {
    const vazio = regiao.exec(form())!;
    expect(vazio[2]).toBe('');
    expect(vazio[1]).toContain('clip:rect(0 0 0 0)');
    expect(regiao.exec(form({ 'item-1': { quantidade: 'Acima do estoque.' } }))![2]).toBe(avisoErrosCampos);
    expect(regiao.exec(form({ 'item-1': 'Linha ruim.' }))![2]).toBe(avisoErrosCampos);
  });
  it('temErroExterno soma ao aviso; false deixa a região vazia; região única', () => {
    expect(regiao.exec(form(undefined, true))![2]).toBe(avisoErrosCampos);
    expect(regiao.exec(form(undefined, false))![2]).toBe('');
    expect(form(undefined, true).match(/role="status"/g)).toHaveLength(1);
  });
  it('erro de chave inexistente em itens não aciona o aviso', () => {
    expect(regiao.exec(form({ 'item-9': 'Linha fantasma.', 'item-1': { quantidade: '' } }))![2]).toBe('');
  });
  it('DialogoMotivo: região sempre presente e vazia sem erro', () => {
    expect(regiao.exec(dialogo())![2]).toBe('');
  });
  it('nenhum role="alert" nos campos e a mensagem é span display:block sem role', () => {
    const h = form({ 'item-1': { produtoId: 'P.', quantidade: 'Q.' } });
    expect(h).not.toContain('role="alert"');
    expect(h).toMatch(/<span id="[^"]+" style="[^"]*display:block[^"]*">Q\.<\/span>/);
  });
  it('aria-describedby do campo aponta para o id do span', () => {
    const h = form({ 'item-1': { quantidade: 'Acima do estoque.' } });
    const id = /aria-label="Quantidade do item 1" aria-invalid="true" aria-describedby="([^"]+)"/.exec(h)![1]!;
    expect(h).toContain(`<span id="${id}"`);
  });
});

describe('.mx-radio (T-0021)', () => {
  it('radioBase: desmarcado com borda de campo; radioMarcado: azul-noite com ponto branco', () => {
    expect(radioBase).toMatchObject({ appearance: 'none', width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--mx-cor-borda-campo)', margin: 0 });
    expect(radioMarcado).toMatchObject({ border: '1px solid var(--mx-cor-azul-noite)', boxShadow: 'inset 0 0 0 4px var(--mx-cor-branco)' });
  });
  it('o CSS gerado dá unidade aos comprimentos do .mx-radio', () => {
    const css = gerarCssBotoes();
    expect(css).toMatch(/\.mx-radio \{[^}]*width: 16px;[^}]*height: 16px;/);
    expect(css).not.toMatch(/(width|height|padding|margin|top|left|right|bottom): [1-9]\d*;/);
  });
  it('gerarCssBotoes gera .mx-radio e :checked', () => {
    const css = gerarCssBotoes();
    expect(css).toMatch(/\.mx-radio \{[^}]*appearance: none;[^}]*border: 1px solid var\(--mx-cor-borda-campo\);/);
    expect(css).toMatch(/\.mx-radio:checked \{[^}]*background: var\(--mx-cor-azul-noite\);[^}]*box-shadow: inset 0 0 0 4px var\(--mx-cor-branco\);/);
  });
  it.each(['.mx-radio', '.mx-checkbox'])('%s:focus-visible tem contorno azul-noite', (sel) => {
    expect(gerarCssBotoes()).toContain(`${sel}:focus-visible {\n  outline: 2px solid var(--mx-cor-azul-noite);`);
  });
});

describe('.mx-checkbox (T-0050)', () => {
  it('checkboxBase: borda de campo; checkboxMarcado: azul-noite com visto branco dos tokens', () => {
    expect(checkboxBase).toMatchObject({ appearance: 'none', width: 16, height: 16, margin: 0, borderRadius: '3px', border: '1px solid var(--mx-cor-borda-campo)', background: 'var(--mx-cor-branco)' });
    expect(checkboxMarcado).toMatchObject({ background: 'var(--mx-cor-azul-noite)', border: '1px solid var(--mx-cor-azul-noite)', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', backgroundSize: '12px 12px' });
    const img = String(checkboxMarcado.backgroundImage);
    expect(img).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(img).toContain(encodeURIComponent(cores.branco));
  });
  it('o CSS gerado tem .mx-checkbox, :checked e 16px', () => {
    const css = gerarCssBotoes();
    expect(css).toMatch(/\.mx-checkbox \{[^}]*appearance: none;[^}]*width: 16px;[^}]*height: 16px;[^}]*border: 1px solid var\(--mx-cor-borda-campo\);/);
    expect(css).toMatch(/\.mx-checkbox:checked \{[^}]*background: var\(--mx-cor-azul-noite\);[^}]*background-image: url\("data:image\/svg\+xml,/);
  });
});

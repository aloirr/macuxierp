import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DialogoMotivo } from './DialogoMotivo.js';
import { FormularioItens, type ItemLinha } from './FormularioItens.js';
import { avisoErrosCampos, gerarCssBotoes, radioBase, radioMarcado } from './estilos.js';

const item: ItemLinha = { chave: 'item-1', produtoId: 'p', quantidade: 1, precoUnitarioCentavos: 100, descontoCentavos: 0 };
const form = (erros?: Record<string, string | Record<string, string>>) =>
  renderToStaticMarkup(
    <FormularioItens itens={[item]} aoMudar={() => {}} novoItem={(chave) => ({ ...item, chave })} calcularTotal={() => 0} formatarCentavos={String} renderSeletorProduto={() => null} erros={erros} />,
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
  it('gerarCssBotoes gera .mx-radio, :checked e :focus-visible', () => {
    const css = gerarCssBotoes();
    expect(css).toMatch(/\.mx-radio \{[^}]*appearance: none;[^}]*border: 1px solid var\(--mx-cor-borda-campo\);/);
    expect(css).toMatch(/\.mx-radio:checked \{[^}]*background: var\(--mx-cor-azul-noite\);[^}]*box-shadow: inset 0 0 0 4px var\(--mx-cor-branco\);/);
    expect(css).toMatch(/\.mx-radio:focus-visible \{\n {2}outline: 2px solid var\(--mx-cor-azul-noite\);/);
  });
});

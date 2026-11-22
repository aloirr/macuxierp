import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NotaDetalhe } from '@macuxierp/faturamento/contracts';
import type { Perfil } from '@macuxierp/platform-sdk';
import { vistaDaNota } from '@/lib/telas/faturamento';
import { DetalheGenerico } from './detalhe-generico';
import { DialogoEscrita } from './dialogo-escrita';
import { TabelaVista } from './ui-cliente';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/[modulo]/[...pagina]/acoes', () => ({ escrever: vi.fn() }));

const ID = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const P2 = '8a2b4c6d-1e3f-4a5b-9c7d-0e1f2a3b4c5d';
const AGORA = new Date('2026-11-22T16:00:00.000Z');
const nota = (status: NotaDetalhe['status'], extra: Partial<NotaDetalhe> = {}): NotaDetalhe => ({
  id: ID, filial_id: ID, cliente_id: ID, pedido_id: ID, ambiente: 'producao', serie: 1, numero: 12, chave_acesso: null, status, emitida_em: '2026-11-22T14:00:00.000Z', total_centavos: 123456,
  protocolo: null, c_stat: null, x_motivo: null, cliente_razao_social: 'Bar do Zé', filial_nome: 'Matriz', pedido_numero: 7, natureza_operacao: 'Venda', tipo_emissao: 1, recibo: null,
  itens: [{ sequencia: 1, quantidade: 20000, valor_centavos: 123456 }], acao_sugerida: null, autorizada_em: '2026-11-22T14:05:00.000Z', ...extra,
}) as NotaDetalhe;
const html = (perfil: Perfil, n: NotaDetalhe = nota('autorizada')) =>
  renderToStaticMarkup(<DetalheGenerico vista={vistaDaNota(n, perfil, 'America/Manaus', AGORA)} rota={`/faturamento/notas/${ID}`} rotaDaPagina="/faturamento/notas/:id" voltar="/faturamento/notas" />);

describe('render do detalhe da nota (T-0021)', () => {
  it('administrador, faturista e fiscal veem as ações e os downloads; o DANFE sai desabilitado com o motivo', () => {
    for (const p of ['administrador', 'faturista', 'fiscal'] as const) {
      const h = html(p);
      expect(h, p).toContain('Cancelar nota');
      expect(h, p).toContain('Carta de correção (CC-e)');
      expect(h, p).toContain('Baixar XML');
      expect(h, p).toMatch(/<button[^>]*disabled=""[^>]*>Baixar DANFE<\/button>/);
      expect(h, p).toContain('DANFE em breve; por enquanto, baixe o XML.');
      expect(h, p).not.toContain('perigo');
    }
  });
  it('a ação principal vem do módulo: o XML da autorizada é botão cheio; Cancelar vem depois dos demais', () => {
    const h = html('administrador');
    expect(h).toMatch(/<a class="btn"[^>]*>Baixar XML<\/a>/);
    expect(h.indexOf('Carta de correção (CC-e)')).toBeLessThan(h.indexOf('>Cancelar nota<'));
  });
  it('a chave de acesso ocupa a linha inteira, com números tabulares e grupos de 4', () => {
    const h = html('administrador', nota('autorizada', { chave_acesso: '13261111222333000181550010000000121000000125' }));
    expect(h).toMatch(/<div class="dado-linha-inteira"><dt>Chave de acesso<\/dt><dd class="num">[\d ]+<\/dd><\/div>/);
    expect(h).not.toMatch(/dado-linha-inteira"><dt>Protocolo/);
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
    expect(css).toMatch(/\.dado-linha-inteira\s*\{\s*grid-column:\s*1 \/ -1/);
  });
  it('o histórico da nota aparece com os eventos e a nota de horário; sem eventos, "Sem eventos."; sem a seção quando a API falha', () => {
    const vista = vistaDaNota(nota('autorizada'), 'administrador', 'America/Manaus', AGORA, { itens: [{ id: ID, nota_id: ID, tipo: 'cancelamento', n_seq_evento: 1, texto: 'x'.repeat(20), status: 'registrado', protocolo: '1132', c_stat: 135, x_motivo: null, registrado_em: '2026-11-22T15:00:00.000Z', criado_em: '2026-11-22T14:50:00.000Z' }] });
    const h = renderToStaticMarkup(<DetalheGenerico vista={vista} rota="/x" rotaDaPagina="/faturamento/notas/:id" voltar="/faturamento/notas" />);
    expect(h).toContain('<h3>Histórico</h3>');
    expect(h).toContain('11:00</span> · Cancelamento · registrado · protocolo 1132');
    expect(h).toContain('Horários no fuso da empresa.');
    expect(html('administrador')).not.toContain('Histórico');
    expect(renderToStaticMarkup(<DetalheGenerico vista={vistaDaNota(nota('autorizada'), 'administrador', 'America/Manaus', AGORA, { itens: [] })} rota="/x" rotaDaPagina="/faturamento/notas/:id" voltar="/faturamento/notas" />)).toContain('Sem eventos.');
  });
  it('o selo do status leva a dica como title', () => {
    expect(html('administrador', nota('em_autorizacao', { autorizada_em: null }))).toContain('title="Aguardando a SEFAZ"');
  });
});

describe('render da lista e dos diálogos', () => {
  it('a célula com selo mostra o selo com a dica; a sem selo, o texto', () => {
    const h = renderToStaticMarkup(
      <TabelaVista
        colunas={[{ id: 'ambiente', rotulo: 'Ambiente' }]}
        vazio="Nada"
        linhas={[
          { chave: '1', celulas: { ambiente: 'Homologação' }, selos: { ambiente: [{ texto: 'Homologação — sem valor fiscal', tom: 'aviso', dica: 'Sem valor fiscal' }] } },
          { chave: '2', celulas: { ambiente: 'Produção' }, selos: { ambiente: [] } },
        ]}
      />,
    );
    expect(h).toContain('selo selo-aviso');
    expect(h).toContain('title="Sem valor fiscal"');
    expect(h).toContain('Produção');
  });
  it('não há vermelho em botão: o confirmar usa o estilo principal e o CSS não define .btn-perigo', () => {
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
    expect(css).not.toMatch(/btn-perigo/);
    const h = renderToStaticMarkup(<DialogoEscrita titulo="Cancelar a nota 12/1?" rotuloConfirmar="Cancelar a nota 12/1" rotuloFechar="Manter a nota" texto={{ rotulo: 'Justificativa', obrigatorio: true }} ocupado={false} validar={() => null} aoConfirmar={vi.fn()} aoCancelar={vi.fn()} />);
    expect(h).toContain('<button type="button" class="btn">Cancelar a nota 12/1</button>');
    expect(h).toContain('>Cancelar a nota 12/1<');
    expect(h).toContain('>Manter a nota<');
    expect(h).toContain('Justificativa');
    expect(h).not.toContain('perigo');
  });
  it('o diálogo da faixa tem o rótulo de fechar do módulo', () => {
    const h = renderToStaticMarkup(<DialogoEscrita titulo="Inutilizar números" rotuloConfirmar="Inutilizar números" rotuloFechar="Voltar" ocupado={false} faixa={{ filiais: [{ valor: ID, rotulo: 'Matriz' }], rotuloTexto: 'Justificativa' }} validar={() => null} aoConfirmar={vi.fn()} aoCancelar={vi.fn()} />);
    expect(h).toContain('>Voltar<');
    expect(h).toContain('Número inicial');
    expect(h).toContain('Número final');
    expect(h).toContain('Matriz');
  });
});

describe('ambiente e contador nos diálogos (RN-FAT-04)', () => {
  it('Reenviar na homologação mostra a linha neutra; em produção, a caixa de aviso', () => {
    const rej = (ambiente: 'homologacao' | 'producao') => nota('rejeitada', { ambiente, autorizada_em: null, acao_sugerida: 'Consulte a chave e reenvie' });
    const a = (ambiente: 'homologacao' | 'producao') => vistaDaNota(rej(ambiente), 'faturista', 'America/Manaus', AGORA).acoes.find((x) => x.id === 'reenviar')!;
    const dlg = (x: ReturnType<typeof a>) => renderToStaticMarkup(<DialogoEscrita titulo="t" rotuloConfirmar="Reenviar" ocupado={false} ambiente={x.ambiente} validar={() => null} aoConfirmar={vi.fn()} aoCancelar={vi.fn()} />);
    const h = dlg(a('homologacao'));
    expect(h).toContain('Ambiente: Homologação, sem valor fiscal');
    expect(h).toMatch(/<p data-ambiente="true" class="apoio">/);
    expect(dlg(a('producao'))).toMatch(/<p data-ambiente="true" class="faixa-aviso">Ambiente: Produção, com valor fiscal/);
  });
  it('Inutilizar mostra a linha depois de escolher a filial e o contador abaixo do texto', () => {
    const h = renderToStaticMarkup(<DialogoEscrita titulo="Inutilizar" rotuloConfirmar="Inutilizar" ocupado={false} ambiente={{ texto: 'Ambiente: confira a configuração da filial emissora', tom: 'alerta' }} limitesTexto={{ min: 15, max: 255 }} faixa={{ filiais: [{ valor: ID, rotulo: 'Matriz' }], rotuloTexto: 'Justificativa' }} validar={() => null} aoConfirmar={vi.fn()} aoCancelar={vi.fn()} />);
    expect(h).toContain('Ambiente: confira a configuração da filial emissora');
    expect(h).toContain('faltam 15 caracteres');
    const duas = renderToStaticMarkup(<DialogoEscrita titulo="Inutilizar" rotuloConfirmar="Inutilizar" ocupado={false} ambiente={{ texto: 'Ambiente: x', tom: 'alerta' }} faixa={{ filiais: [{ valor: ID, rotulo: 'A' }, { valor: P2, rotulo: 'B' }], rotuloTexto: 'Justificativa' }} validar={() => null} aoConfirmar={vi.fn()} aoCancelar={vi.fn()} />);
    expect(duas).not.toContain('Ambiente: x');
  });
  it('depois de "O que fazer:" o texto começa em minúscula; o xMotivo não muda', () => {
    const v = vistaDaNota(nota('rejeitada', { c_stat: 539, x_motivo: 'Duplicidade de NF-e', acao_sugerida: 'Consulte a chave e reenvie', autorizada_em: null }), 'faturista', 'America/Manaus', AGORA);
    expect(v.pendencias[0]?.texto).toContain('539: Duplicidade de NF-e. O que fazer: consulte a chave e reenvie.');
  });
  it('a coluna "#" dos itens é estreita e numérica', () => {
    const v = vistaDaNota(nota('autorizada'), 'administrador', 'America/Manaus', AGORA);
    const c = v.tabelas?.[0]?.colunas.find((x) => x.id === 'sequencia');
    expect(c).toMatchObject({ numerica: true, largura: '3rem' });
  });
});

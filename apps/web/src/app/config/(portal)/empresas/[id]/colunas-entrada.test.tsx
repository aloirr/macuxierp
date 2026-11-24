import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));

import { ENTRADA_FIXTURE, decidirConfirmacao, definirDono, gerarCredencial, type EntradaPortal } from '@/lib/config/entrada-provisorio';
import { TEXTOS_ENTRADA, avisoDono, linhasEntrada, textoApoioTrava, textoTrava } from '@/lib/config/entrada';
import { ColunaCredencial, ColunasEntrada, DialogoChave, DialogoDono, DialogoTrava } from './colunas-entrada';

const ID = '11111111-1111-4111-8111-111111111111';
const render = (e: EntradaPortal | null = ENTRADA_FIXTURE) => renderToStaticMarkup(<ColunasEntrada empresaId={ID} entrada={e} fuso="America/Manaus" />);
const PEND = { lote_id: 'l1', a_inativar: 120, total: 266, percentual: 45.1, expira_em: '2026-11-25T12:00:00.000Z' };
const resp = (status: number, corpo: unknown = {}) => async () => new Response(JSON.stringify(corpo), { status });

describe('colunas de entrada (cenário B)', () => {
  it('duas colunas com conector_id, prefixo, chave criada, último sinal no fuso, versão e botão; quebra em 900 px', () => {
    const h = render();
    expect(h).toContain('Integração via Conector');
    expect(h).toContain('Integração via API');
    expect(h).toContain('thathyany-erp');
    expect(h).toContain('mxc_ab12…');
    expect(h).toContain('Chave criada em');
    expect(h).toContain('20/11/2026 10:05');
    expect(h).toContain('24/11/2026 08:30');
    expect(h).toContain('1.0.0');
    expect(h).toContain('Trocar chave');
    expect(readFileSync('src/app/globals.css', 'utf8')).toMatch(/max-width: 899px[^}]*entrada-duas/);
  });
  it('a lista fica abaixo das colunas, em largura total', () => {
    const h = render();
    expect(h.indexOf('Cadastros recebidos do cliente')).toBeGreaterThan(h.indexOf('Integração via API'));
    const duas = h.slice(h.indexOf('entrada-duas'), h.indexOf('<section class="bloco" aria-label="Cadastros de entrada"'));
    expect(duas.match(/<section/g)).toHaveLength(2);
  });
  it('lista os 10 cadastros com dono, último lote e erros', () => {
    const h = render();
    for (const t of ['Cadastro', 'Dono', 'Último lote', 'Erros', 'Situação']) expect(h).toContain(`>${t}<`);
    expect(h).toContain('24/11/2026 08:00 · 98 de 100');
    expect(h).toContain('· 99 de 101, 2 com erro');
    expect(h).toContain('>Macuxi ERP<');
    expect(h).toContain('>Servidor do cliente<');
    expect(linhasEntrada(ENTRADA_FIXTURE.cadastros, 'America/Manaus')).toHaveLength(10);
  });
  it('último lote: sem lote é traço; com erro acrescenta a contagem', () => {
    const l = linhasEntrada(ENTRADA_FIXTURE.cadastros, 'UTC');
    expect(l[3]!.ultimoLote).toBe('—');
    expect(l[0]!.ultimoLote).toBe('24/11/2026 12:00 · 98 de 100');
  });
  it('dependentes seguem por dono_herdado_de, sem seletor', () => {
    const h = render();
    expect(h).toContain('Segue Clientes');
    expect(h).toContain('Segue Produtos');
    expect(h).not.toContain('Dono: Endereços de clientes');
    expect(h).not.toContain('Dono: Unidades do produto');
    expect(h).toContain('aria-label="Dono: Clientes"');
    const outro = ENTRADA_FIXTURE.cadastros.map((c) => (c.cadastro === 'filial' ? { ...c, dono_herdado_de: 'produto' as const } : c));
    expect(linhasEntrada(outro, 'UTC').find((x) => x.cadastro === 'filial')?.segue).toBe('Segue Produtos');
  });
  it('seletor desligado com confirmação pendente, descrito pelo motivo', () => {
    const h = render();
    const sel = h.match(/<select[^>]*aria-label="Dono: Produtos"[^>]*>/)![0];
    expect(sel).toContain('disabled=""');
    const ref = sel.match(/aria-describedby="([^"]+)"/)![1]!;
    expect(h).toMatch(new RegExp(`id="${ref.replace(/:/g, ':')}"[^>]*>Resolva a inativação pendente antes de trocar o dono\\.<`));
    const livre = h.match(/<select[^>]*aria-label="Dono: Clientes"[^>]*>/)![0];
    expect(livre).not.toContain('disabled');
  });
  it('troca de dono pede confirmação e o aviso depende de carga_completa_pedida', () => {
    expect(renderToStaticMarkup(<DialogoDono rotulo="Clientes" para="cliente" aoConfirmar={() => {}} aoCancelar={() => {}} />)).toContain('carga completa do Conector');
    const h = renderToStaticMarkup(<DialogoDono rotulo="Clientes" para="erp" aoConfirmar={() => {}} aoCancelar={() => {}} />);
    expect(h).toContain('passam a ser editáveis');
    expect(avisoDono('Clientes', true)).toBe('Dono de Clientes alterado. Carga completa pedida ao Conector.');
    expect(avisoDono('Clientes', false)).toBe('Dono de Clientes alterado.');
    expect(TEXTOS_ENTRADA.donoEmAndamento).toBe('Há uma carga do servidor do cliente em andamento neste cadastro.');
  });
  it('trava de 30%: N de M (X%), Inativar, Recusar lote e Cancelar, com o prazo', () => {
    expect(render()).toContain('Confirmar inativação');
    expect(textoTrava('produto', PEND)).toBe('Vai inativar 120 de 266 produtos (45%).');
    expect(textoTrava('cliente_endereco', { a_inativar: 5, total: 20, percentual: 25 })).toBe('Vai inativar 5 endereços e nenhum cliente.');
    const h = renderToStaticMarkup(<DialogoTrava cadastro="produto" pendente={PEND} fuso="America/Manaus" aoInativar={() => {}} aoRecusar={() => {}} aoCancelar={() => {}} />);
    expect(h).toContain('Vai inativar 120 de 266 produtos (45%).');
    expect(h.indexOf('>Inativar<')).toBeLessThan(h.indexOf('>Recusar lote<'));
    expect(h.indexOf('>Recusar lote<')).toBeLessThan(h.indexOf('>Cancelar<'));
    expect(h).toContain('Confirme até 25/11/2026 08:00. Depois disso o pedido vence e a carga precisa ser enviada de novo.');
    expect(textoApoioTrava(PEND.expira_em, 'UTC')).toContain('12:00');
  });
  it('diálogo da chave: aviso, Copiar antes, "Já copiei", Esc e fundo passam pela confirmação, sem storage', () => {
    const h = renderToStaticMarkup(<DialogoChave chave="mxc_SEGREDO" aoCopiar={() => {}} aoConcluir={() => {}} />);
    expect(h).toContain('Esta chave não aparece de novo.');
    expect(h.indexOf('Copiar')).toBeLessThan(h.indexOf('mxc_SEGREDO'));
    expect(h.match(/<button/g)).toHaveLength(2);
    expect(h).toContain('Já copiei');
    expect(h).not.toContain('Fechar sem copiar');
    const fonte = readFileSync('src/app/config/(portal)/empresas/[id]/colunas-entrada.tsx', 'utf8') + readFileSync('src/lib/config/entrada-provisorio.ts', 'utf8');
    expect(fonte).not.toMatch(/localStorage|sessionStorage|console\.|document\.cookie/);
    expect(fonte).toContain('const fechar = () => (copiou ? aoConcluir() : setConfirmando(true));');
    expect(fonte).toMatch(/<DialogoMotivo[^>]*\n[^]*destrutivo[^]*rotuloConfirmar="Fechar sem copiar"[^]*rotuloFechar="Voltar"/);
    expect(TEXTOS_ENTRADA.fecharSemCopiarTitulo).toBe('Fechar sem copiar a chave?');
  });
  it('ficha da credencial: gerar sem credencial pede o código; erros nos lugares certos', () => {
    const vazia = renderToStaticMarkup(<ColunaCredencial titulo="T" cred={null} fuso="UTC" ocupado={false} erroCampo={null} aoGerar={() => {}} />);
    expect(vazia).toContain('Gerar chave');
    expect(vazia).toContain('Código do conector');
    const erro = renderToStaticMarkup(<ColunaCredencial titulo="T" cred={null} fuso="UTC" ocupado={false} erroCampo={TEXTOS_ENTRADA.erro409Codigo} aoGerar={() => {}} />);
    expect(erro).toContain('Este código já está em uso. Escolha outro.');
    expect(erro).toContain('aria-invalid="true"');
    expect(TEXTOS_ENTRADA.erro400Codigo).toBe('Use só letras, números, ponto, hífen e sublinhado, até 100 caracteres.');
    expect(TEXTOS_ENTRADA.erro503).toContain('Avise o responsável pelo servidor.');
    expect(TEXTOS_ENTRADA.erroRedeChave).toBe('Não foi possível confirmar a chave. Gere de novo: a chave nova substitui a anterior.');
    expect(TEXTOS_ENTRADA.trocaChave).toBe('A chave atual para de funcionar agora.');
  });
  it('ações injetáveis: corpo do contrato e erros com status e código', async () => {
    const enviar = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ chave: 'k', prefixo_chave: 'p' }), { status: 200 }));
    const r = await gerarCredencial(ID, 'api', 'meu-conector', 'idem-1', enviar);
    expect(r).toEqual({ ok: true, valor: { chave: 'k', prefixo_chave: 'p' } });
    expect(JSON.parse(String(enviar.mock.calls[0]![1].body))).toEqual({ tipo: 'api', conector_id: 'meu-conector' });
    expect(await gerarCredencial(ID, 'api', 'x', 'i', resp(503, { codigo: 'pepper_ausente' }))).toMatchObject({ ok: false, status: 503, codigo: 'pepper_ausente' });
    expect(await gerarCredencial(ID, 'api', 'x', 'i', resp(409, { codigo: 'conector_id_em_uso' }))).toMatchObject({ ok: false, status: 409 });
    expect(await gerarCredencial(ID, 'api', 'x', 'i', async () => { throw new Error('rede'); })).toMatchObject({ ok: false, status: 0 });
    expect(await definirDono(ID, 'cliente', 'erp', 'i', resp(409, { codigo: 'entrada_em_andamento' }))).toMatchObject({ ok: false, status: 409 });
    expect(await definirDono(ID, 'cliente_endereco', 'erp', 'i', resp(422, { codigo: 'dono_herdado' }))).toMatchObject({ ok: false, status: 422 });
    const d = await definirDono(ID, 'cliente', 'cliente', 'i', resp(200, { cadastro: 'cliente', carga_completa_pedida: true }));
    expect(d.ok && d.valor.carga_completa_pedida).toBe(true);
    const rec = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ lote_id: 'l1', estado: 'recusado' }), { status: 200 }));
    expect((await decidirConfirmacao(ID, 'l1', 'recusar', 'i', rec)).ok).toBe(true);
    expect(JSON.parse(String(rec.mock.calls[0]![1].body))).toEqual({ lote_id: 'l1', decisao: 'recusar' });
    expect(await decidirConfirmacao(ID, 'l1', 'aprovar', 'i', resp(410, { codigo: 'confirmacao_expirada' }))).toMatchObject({ ok: false, status: 410 });
    expect(await decidirConfirmacao(ID, 'l1', 'aprovar', 'i', resp(404))).toMatchObject({ ok: false, status: 404 });
    expect(TEXTOS_ENTRADA.prazoTitulo).toBe('Prazo vencido');
    expect(TEXTOS_ENTRADA.loteRecusado).toBe('Lote recusado. Nada foi inativado.');
  });
  it('estado vazio: sem credencial nem dados', () => {
    const h = render(null);
    expect(h).toContain('Gerar chave');
    expect(h).not.toContain('Trocar chave');
    expect(h).toContain('Sem dados de entrada');
    const sem = render({ credenciais: { conector: null, api: null }, cadastros: [] });
    expect(sem).toContain('Nenhuma chave gerada ainda.');
  });
});

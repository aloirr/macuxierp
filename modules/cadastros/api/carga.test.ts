import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { erros } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { MAX_LINHAS_LOTE, type RelatorioCarga } from '../contracts';
import { prazosDoCartao } from '../domain';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { criarPluginCadastros } from './index';
import { dependenciasEmMemoria } from './memoria';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'domain', 'carga', '__fixtures__');
const arquivos = (exceto: string[] = []) =>
  readdirSync(pasta).filter((f) => f.endsWith('.csv') && !exceto.includes(f)).map((nome) => ({ nome, conteudo: readFileSync(join(pasta, nome)) }));
const adm = sessaoDe('administrador');

function montar() {
  const m = dependenciasEmMemoria();
  m.repos.oficiais.ncms.add('21069030');
  m.repos.oficiais.municipiosPorUf.set('AM', [{ ibge: '1302603', nome: 'Manaus' }]);
  m.repos.oficiais.municipiosPorUf.set('SP', [{ ibge: '3550308', nome: 'São Paulo' }]);
  const amb = criarAmbiente(criarPluginCadastros(m.deps));
  const carregar = async (modo: 'validar' | 'gravar', o: Parameters<typeof amb.chamar>[2] = {}) =>
    amb.chamar('POST', '/cargas', { sessao: adm, corpo: { modo }, arquivos: arquivos(), ...o });
  return { ...m, ...amb, carregar };
}
const porEntidade = (r: RelatorioCarga) => Object.fromEntries(r.entidades.map((e) => [e.entidade, e]));

describe('carga de CSV (T-0026): POST /v1/cadastros/cargas', () => {
  it('D8: vendedor, faturista e leitura recebem 403 e nada é lido', async () => {
    const t = montar();
    for (const p of ['vendedor', 'faturista', 'leitura', 'fiscal'] as const) expect((await t.carregar('gravar', { sessao: sessaoDe(p) })).status).toBe(403);
    expect(t.repos.clientes.linhas).toHaveLength(0);
  });

  it('RN-CORE-02: tenant sem a licença do módulo recebe 403 MODULO_INATIVO', async () => {
    const t = montar();
    expect(await t.carregar('gravar', { semLicenca: true })).toMatchObject({ status: 403, corpo: { codigo: 'MODULO_INATIVO' } });
  });

  it('D1: modo ausente ou inválido é 400 (VALIDACAO)', async () => {
    const t = montar();
    expect((await t.carregar('gravar', { corpo: {} })).status).toBe(400);
    expect((await t.carregar('gravar', { corpo: { modo: 'apagar' } })).status).toBe(400);
  });

  it('D13: o modo validar prevê as contagens, não grava nem publica nem audita', async () => {
    const t = montar();
    const r = await t.carregar('validar');
    expect(r.status).toBe(200);
    const rel = r.corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    const e = porEntidade(rel);
    expect(e.filial).toMatchObject({ situacao: 'processado', lidas: 1, inseridas: 1 });
    expect(e.cliente).toMatchObject({ lidas: 2, inseridas: 2 });
    expect(e.estoque).toMatchObject({ lidas: 2, inseridas: 2 });
    expect(e.titulo).toMatchObject({ situacao: 'ignorado' });
    expect(t.repos.filiais.linhas).toHaveLength(0);
    expect(t.repos.clientes.linhas).toHaveLength(0);
    expect(t.eventos).toHaveLength(0);
    expect(t.auditoria).toHaveLength(0);
  });

  it('D13/D4: gravar cria os 10 arquivos na ordem e publica um evento por cadastro', async () => {
    const t = montar();
    const rel = (await t.carregar('gravar')).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    const e = porEntidade(rel);
    for (const n of ['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto', 'produto_unidade', 'preco', 'estoque', 'cliente', 'cliente_endereco']) {
      expect(e[n], n).toMatchObject({ situacao: 'processado', recusadas: 0 });
      expect(e[n]!.inseridas + e[n]!.atualizadas, n).toBeGreaterThan(0);
    }
    expect(t.repos.filiais.linhas[0]).toMatchObject({ padrao: true, emissora: false, external_id: 'F-EX-01' });
    expect(t.repos.condicoesPagamento.linhas).toHaveLength(3);
    expect(t.repos.condicoesPagamento.linhas[0]).toMatchObject({ forma_external_id: 'FP-EX-01', forma_tpag: '15', forma_codigo: 'BOLETO' });
    expect(t.repos.clientes.linhas).toHaveLength(2);
    expect([...t.repos.estoque.movimentos.map((m) => m.quantidade)]).toEqual([105_000 + 42_500]);
    expect(t.eventos.some((x) => x.nome === 'cadastros.cliente.alterado@1')).toBe(true);
    expect(t.eventos.filter((x) => x.nome === 'cadastros.preco.alterado@1')).toHaveLength(2);
    const aud = t.auditoria.find((a) => a.acao === 'cadastros.carga');
    expect(aud?.depois).toMatchObject({ modo: 'gravar', arquivos: expect.arrayContaining([{ entidade: 'filial', sha256: expect.stringMatching(/^[0-9a-f]{64}$/), bytes: expect.any(Number) }]) });
  });

  it('RN-CAD-09: linha de prazo com forma à vista e prazo maior que 0 vira erro da linha; as demais seguem', async () => {
    const t = montar();
    const prazo = readFileSync(join(pasta, 'prazo_pagamento.csv'), 'utf8').replace('PZ-EX-03;FP-EX-02;PIXV;0;', 'PZ-EX-03;FP-EX-02;PIXV;0/30;');
    const rel = (await t.carregar('gravar', { arquivos: [...arquivos(['prazo_pagamento.csv']), { nome: 'prazo_pagamento.csv', conteudo: prazo }] })).corpo as RelatorioCarga;
    expect(rel.erros).toContainEqual(expect.objectContaining({ arquivo: 'prazo_pagamento.csv', codigo: 'RN-CAD-09', campo: 'prazos_dias' }));
    expect(JSON.stringify(rel.erros)).not.toContain('0/30');
    expect(t.repos.condicoesPagamento.linhas).toHaveLength(2);
  });

  it('RN-CAD-09: forma_pagamento que troca o tPag para à vista com condição a prazo gravada vira erro da linha e não atualiza nenhuma condição', async () => {
    const t = montar();
    await t.carregar('gravar');
    const antes = JSON.stringify(t.repos.condicoesPagamento.linhas);
    const forma = readFileSync(join(pasta, 'forma_pagamento.csv'), 'utf8').replace('FP-EX-01;BOLETO;', 'FP-EX-01;PIX;');
    const rel = (await t.carregar('gravar', { arquivos: [...arquivos(['forma_pagamento.csv']), { nome: 'forma_pagamento.csv', conteudo: forma }] })).corpo as RelatorioCarga;
    expect(rel.erros).toContainEqual(expect.objectContaining({ arquivo: 'forma_pagamento.csv', codigo: 'RN-CAD-09', campo: 'prazos_dias' }));
    expect(JSON.stringify(rel.erros)).not.toContain('PIX');
    expect(JSON.stringify(t.repos.condicoesPagamento.linhas)).toBe(antes);
  });

  it('D5: gravar duas vezes, a 2ª é toda sem_mudanca e não publica evento nem duplica', async () => {
    const t = montar();
    await t.carregar('gravar');
    const eventos = t.eventos.length;
    const clientes = t.repos.clientes.linhas.length;
    const rel = (await t.carregar('gravar')).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    for (const e of rel.entidades.filter((x) => x.situacao === 'processado')) {
      expect({ entidade: e.entidade, i: e.inseridas, a: e.atualizadas }).toEqual({ entidade: e.entidade, i: 0, a: 0 });
      expect(e.sem_mudanca, e.entidade).toBe(e.lidas);
    }
    expect(t.eventos).toHaveLength(eventos);
    expect(t.repos.clientes.linhas).toHaveLength(clientes);
  });

  it('D5/D6: uma célula alterada atualiza só aquele cadastro e publica um evento', async () => {
    const t = montar();
    await t.carregar('gravar');
    const antes = t.eventos.length;
    const vend = readFileSync(join(pasta, 'vendedor.csv'), 'utf8').replace('Vendedor Exemplo 01', 'Vendedor Exemplo Novo');
    const rel = (await t.carregar('gravar', { arquivos: [{ nome: 'vendedor.csv', conteudo: vend }] })).corpo as RelatorioCarga;
    expect(porEntidade(rel).vendedor).toMatchObject({ atualizadas: 1, sem_mudanca: 0 });
    expect(t.eventos.slice(antes).map((e) => e.nome)).toEqual(['cadastros.vendedor.alterado@1']);
    expect(t.repos.vendedores.linhas[0]).toMatchObject({ nome: 'Vendedor Exemplo Novo' });
  });

  it('D8: o gerente tem filial.csv recusado e os demais arquivos gravados', async () => {
    const t = montar();
    await t.carregar('gravar', { arquivos: arquivos().filter((a) => a.nome === 'filial.csv') });
    t.eventos.length = 0;
    const r = await t.carregar('gravar', { sessao: sessaoDe('gerente') });
    const rel = r.corpo as RelatorioCarga;
    expect(porEntidade(rel).filial).toMatchObject({ situacao: 'recusado' });
    expect(rel.erros).toContainEqual(expect.objectContaining({ arquivo: 'filial.csv', linha: null, codigo: 'PERFIL_SEM_PERMISSAO' }));
    expect(porEntidade(rel).vendedor).toMatchObject({ situacao: 'processado', inseridas: 1 });
    expect(t.repos.vendedores.linhas).toHaveLength(1);
  });

  it('D13: arquivo recusado não para os seguintes; a linha que dependia dele cai como CARGA_REFERENCIA', async () => {
    const t = montar();
    const r = await t.carregar('gravar', { arquivos: arquivos().filter((a) => a.nome !== 'filial.csv') });
    const rel = r.corpo as RelatorioCarga;
    expect(rel.erros.filter((e) => e.arquivo === 'vendedor.csv')).toEqual([expect.objectContaining({ codigo: 'CARGA_REFERENCIA', campo: 'filial_external_id' })]);
    expect(porEntidade(rel).forma_pagamento).toMatchObject({ inseridas: 2 });
  });

  it('D1: arquivo fora do escopo sai ignorado; nome desconhecido é recusado sem derrubar o lote', async () => {
    const t = montar();
    const rel = (await t.carregar('validar', { arquivos: [...arquivos(['cliente.csv']), { nome: 'qualquer.csv', conteudo: 'a;b\n1;2\n' }] })).corpo as RelatorioCarga;
    expect(porEntidade(rel).titulo).toMatchObject({ situacao: 'ignorado', lidas: 0 });
    expect(rel.erros).toContainEqual(expect.objectContaining({ arquivo: 'qualquer.csv', linha: null, codigo: 'CARGA_FORMATO' }));
  });

  it('D2: cabeçalho com coluna desconhecida ou obrigatória ausente recusa o arquivo (sem eco do valor)', async () => {
    const t = montar();
    const rel = (await t.carregar('validar', { arquivos: [{ nome: 'vendedor.csv', conteudo: 'external_id;xpto\nv1;a\n' }] })).corpo as RelatorioCarga;
    expect(porEntidade(rel).vendedor).toMatchObject({ situacao: 'recusado' });
    expect(rel.erros[0]).toMatchObject({ arquivo: 'vendedor.csv', codigo: 'CARGA_FORMATO' });
  });

  it('RN-CORE-07/D9: o relatório e a auditoria não levam nenhuma célula do arquivo', async () => {
    const t = montar();
    const sentinelas = ['SENTINELA-DOC-77', 'SENTINELA-NOME-88'];
    const cli = readFileSync(join(pasta, 'cliente.csv'), 'utf8').replace('99.000.002/0001-48', sentinelas[0]!).replace('Cliente Exemplo 02', sentinelas[1]!);
    const r = await t.carregar('gravar', { arquivos: [...arquivos(['cliente.csv']), { nome: 'cliente.csv', conteudo: cli }] });
    const rel = r.corpo as RelatorioCarga;
    expect(rel.erros.some((e) => e.codigo === 'RN-CAD-01')).toBe(true);
    const texto = JSON.stringify([r.corpo, t.auditoria]);
    for (const s of sentinelas) expect(texto).not.toContain(s);
    expect(texto).not.toContain('Cliente Exemplo');
    expect(texto).not.toContain('Rua Teste');
  });

  it('D4: adota o cadastro sem external_id pela chave natural e recusa quando a chave é de outro external_id', async () => {
    const t = montar();
    await t.carregar('gravar', { arquivos: arquivos().filter((a) => a.nome === 'filial.csv') });
    // cadastro feito no BKO: mesmo CNPJ, sem external_id
    t.repos.filiais.linhas[0]!.external_id = null;
    const rel = (await t.carregar('gravar', { arquivos: arquivos().filter((a) => a.nome === 'filial.csv') })).corpo as RelatorioCarga;
    expect(porEntidade(rel).filial).toMatchObject({ inseridas: 0, atualizadas: 1 });
    expect(t.repos.filiais.linhas).toHaveLength(1);
    expect(t.repos.filiais.linhas[0]!.external_id).toBe('F-EX-01');
    const outro = readFileSync(join(pasta, 'filial.csv'), 'utf8').replace('F-EX-01', 'F-OUTRO');
    const r2 = (await t.carregar('gravar', { arquivos: [{ nome: 'filial.csv', conteudo: outro }] })).corpo as RelatorioCarga;
    expect(r2.erros).toEqual([expect.objectContaining({ codigo: 'CARGA_CONFLITO', campo: 'cnpj' })]);
  });

  it('RN-CORE-05: a adoção pela carga publica external_id_anterior nulo; sem mudança de chave o campo fica ausente', async () => {
    const t = montar();
    await t.carregar('gravar');
    const repos = [t.repos.filiais, t.repos.vendedores, t.repos.condicoesPagamento, t.repos.produtos, t.repos.clientes];
    for (const r of repos) for (const l of r.linhas) (l as { external_id: string | null }).external_id = null;
    t.eventos.length = 0;
    const rel = (await t.carregar('gravar')).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    const nomes = ['cadastros.filial.alterada@1', 'cadastros.vendedor.alterado@1', 'cadastros.condicao_pagamento.alterada@1', 'cadastros.produto.alterado@1', 'cadastros.cliente.alterado@1'];
    for (const n of nomes) {
      const ev = t.eventos.filter((e) => e.nome === n);
      expect(ev.length, n).toBeGreaterThan(0);
      expect(ev[0]!.payload, n).toMatchObject({ external_id_anterior: null });
    }
    // recarga com a célula alterada: a chave não muda, o campo fica ausente
    t.eventos.length = 0;
    const vend = readFileSync(join(pasta, 'vendedor.csv'), 'utf8').replace('Vendedor Exemplo 01', 'Vendedor Exemplo Novo');
    await t.carregar('gravar', { arquivos: [{ nome: 'vendedor.csv', conteudo: vend }] });
    expect(t.eventos).toHaveLength(1);
    expect(t.eventos[0]!.payload.external_id_anterior).toBeUndefined();
  });

  it('ADR 0010 / RN-CORE-05 (C-10): unidade, preço e endereço saem nos eventos com o external_id do kit', async () => {
    const t = montar();
    await t.carregar('gravar');
    const preco = t.eventos.filter((e) => e.nome === 'cadastros.preco.alterado@1').map((e) => e.payload.external_id).sort();
    expect(preco).toEqual(['PR-EX-01', 'PR-EX-02']);
    const prod = t.eventos.filter((e) => e.nome === 'cadastros.produto.alterado@1' && e.payload.external_id === 'P-EX-01').at(-1)!;
    expect((prod.payload.unidades as { external_id: string }[]).map((u) => u.external_id)).toContain('PU-EX-01');
    const cli = t.eventos.filter((e) => e.nome === 'cadastros.cliente.alterado@1' && e.payload.external_id === 'C-EX-01').at(-1)!;
    expect((cli.payload.enderecos as { external_id: string }[]).map((x) => x.external_id)).toContain('CE-EX-01');
  });

  it('ADR 0010 / RN-CORE-05 (C-10): a adoção da chave do preço pela carga publica external_id_anterior nulo', async () => {
    const t = montar();
    await t.carregar('gravar');
    for (const i of t.repos.tabelasPreco.itensPreco) (i as unknown as { external_id: string | null }).external_id = null;
    t.eventos.length = 0;
    await t.carregar('gravar');
    const ev = t.eventos.filter((e) => e.nome === 'cadastros.preco.alterado@1');
    expect(ev).toHaveLength(2);
    for (const e of ev) expect(e.payload).toMatchObject({ external_id: expect.stringMatching(/^PR-EX-0[12]$/), external_id_anterior: null });
  });

  it('RN-CORE-05: external_id repetido no arquivo recusa a 2ª ocorrência (CARGA_DUPLICADO)', async () => {
    const t = montar();
    const v = 'external_id;nome\nV1;Ana\nV1;Beto\n';
    const rel = (await t.carregar('validar', { arquivos: [{ nome: 'vendedor.csv', conteudo: v }] })).corpo as RelatorioCarga;
    expect(rel.erros).toContainEqual(expect.objectContaining({ linha: 3, codigo: 'CARGA_DUPLICADO' }));
    expect(porEntidade(rel).vendedor).toMatchObject({ lidas: 2, recusadas: 2 }); // a 1ª sem filial no ERP; a 2ª, duplicada
  });

  it('D4: se a 1ª filial falha ao gravar, a marca de filial padrão é desfeita e a seguinte vira a padrão', async () => {
    const t = montar();
    const inserir = t.repos.filiais.inserir.bind(t.repos.filiais);
    let chamadas = 0;
    t.repos.filiais.inserir = (async (d: Parameters<typeof inserir>[0]) => {
      if (++chamadas === 1) throw new Error('falha injetada');
      return inserir(d);
    }) as typeof inserir;
    const f = readFileSync(join(pasta, 'filial.csv'), 'utf8');
    const segunda = f.split('\n')[1]!.replace('F-EX-01', 'F-EX-09').replace('99.000.001/0001-01', '11.222.333/0001-81');
    const rel = (await t.carregar('gravar', { arquivos: [{ nome: 'filial.csv', conteudo: `${f.trim()}\n${segunda}\n` }] })).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([expect.objectContaining({ linha: 2, codigo: 'CARGA_BANCO' })]);
    expect(t.repos.filiais.linhas).toHaveLength(1);
    expect(t.repos.filiais.linhas[0]).toMatchObject({ external_id: 'F-EX-09', padrao: true });
  });

  it('RN-CAD-02: IE na atualização do cliente sem endereco.uf vale pela UF do endereço principal gravado; sem endereço, recusa', async () => {
    const t = montar();
    await t.carregar('gravar');
    const csv = (ie: string) => ({ nome: 'cliente.csv', conteudo: `external_id;razao_social;inscricao_estadual\nC-EX-01;Cliente Exemplo 01 Ltda;${ie}\n` });
    const ruim = (await t.carregar('gravar', { arquivos: [csv('123')] })).corpo as RelatorioCarga;
    expect(ruim.erros).toEqual([expect.objectContaining({ codigo: 'RN-CAD-02' })]);
    const ok = (await t.carregar('gravar', { arquivos: [csv('012300004')] })).corpo as RelatorioCarga;
    expect(ok.erros).toEqual([]);
    expect(porEntidade(ok).cliente).toMatchObject({ atualizadas: 1 });
    expect(t.repos.clientes.linhas.find((l) => l.external_id === 'C-EX-01')).toMatchObject({ ie: '012300004', ind_ie_dest: '1' });
    t.repos.clientes.enderecos.linhas.forEach((e) => (e.inativo = true));
    const sem = (await t.carregar('gravar', { arquivos: [csv('012300004')] })).corpo as RelatorioCarga;
    expect(sem.erros).toEqual([expect.objectContaining({ codigo: 'RN-CAD-02', campo: 'inscricao_estadual' })]);
  });

  describe('Idempotency-Key (RN-CORE-05)', () => {
    it('a mesma chave com o mesmo lote devolve o mesmo relatório sem executar de novo', async () => {
      const t = montar();
      const cab = { 'idempotency-key': 'carga-0001-abcdef' };
      const a = await t.carregar('gravar', { cabecalhos: cab });
      const eventos = t.eventos.length;
      const b = await t.carregar('gravar', { cabecalhos: cab });
      expect(b.status).toBe(200);
      expect(b.corpo).toEqual(a.corpo);
      expect(t.eventos).toHaveLength(eventos);
    });
    it('a mesma chave com outro corpo é 409', async () => {
      const t = montar();
      const cab = { 'idempotency-key': 'carga-0002-abcdef' };
      await t.carregar('validar', { cabecalhos: cab });
      expect((await t.carregar('gravar', { cabecalhos: cab })).status).toBe(409);
      expect((await t.carregar('validar', { cabecalhos: cab, arquivos: arquivos(['preco.csv']) })).status).toBe(409);
    });
  });

  describe('limites (D7)', () => {
    it('lote acima de 10 MB é 413 ARQUIVO_GRANDE', async () => {
      const t = montar();
      const grande = Buffer.alloc(10 * 1024 * 1024 + 1, 'a');
      expect(await t.carregar('validar', { arquivos: [{ nome: 'vendedor.csv', conteudo: grande }] })).toMatchObject({ status: 413, corpo: { codigo: 'ARQUIVO_GRANDE' } });
    });
    it('lote acima de 20.000 linhas é 400', async () => {
      const t = montar();
      const linhas = Array.from({ length: MAX_LINHAS_LOTE + 1 }, (_, i) => `V${i};Nome ${i}`).join('\n');
      const r = await t.carregar('validar', { arquivos: [{ nome: 'vendedor.csv', conteudo: `external_id;nome\n${linhas}\n` }] });
      expect(r.status).toBe(400);
      expect(r.corpo.codigo).toBe('VALIDACAO');
    });
    it('exatamente 20.000 linhas ainda é aceito', async () => {
      const t = montar();
      const linhas = Array.from({ length: MAX_LINHAS_LOTE }, (_, i) => `V${i};Nome ${i}`).join('\n');
      expect((await t.carregar('validar', { arquivos: [{ nome: 'vendedor.csv', conteudo: `external_id;nome\n${linhas}\n` }] })).status).toBe(200);
    });
  });
});

describe('RN-CAD-09 na carga: classe da forma (cartão, à vista, boleto, forma recusada)', () => {
  const FORMA = 'external_id;codigo;nome;alterado_em;ativo;ordem\n';
  const PRAZO = 'external_id;forma_external_id;codigo;parcelas_dias;alterado_em;ativo;descricao;prazo_medio_dias;percentual_ajuste;ordem\n';
  const lote = (forma: string, prazo: string) => [
    ...arquivos(['forma_pagamento.csv', 'prazo_pagamento.csv']),
    { nome: 'forma_pagamento.csv', conteudo: FORMA + forma }, { nome: 'prazo_pagamento.csv', conteudo: PRAZO + prazo },
  ];
  const conds = (t: ReturnType<typeof montar>) => t.repos.condicoesPagamento.linhas.filter((c) => String(c.external_id).startsWith('Z-'));

  it('RN-CAD-09: cartão aceita "3x" e "3" (1 a 12): grava parcelas_cartao e os prazos 30×N; 1x e 12x passam, 13x recusa', async () => {
    const t = montar();
    const prazo = ['Z-1;FP-C;C1;1x;;sim;;;;1', 'Z-3;FP-C;C3;3x;;sim;;;;2', 'Z-4;FP-C;C4;4;;sim;;;;3', 'Z-12;FP-C;C12;12x;;sim;;;;4', 'Z-13;FP-C;C13;13x;;sim;;;;5'].join('\n');
    const rel = (await t.carregar('gravar', { arquivos: lote('FP-C;CARTAO_CREDITO;Cartão;;sim;1', prazo) })).corpo as RelatorioCarga;
    const porExt = Object.fromEntries(conds(t).map((c) => [c.external_id, c]));
    expect(porExt['Z-1']).toMatchObject({ forma_tpag: '03', parcelas_cartao: 1, prazos_dias: [30] });
    expect(porExt['Z-3']).toMatchObject({ parcelas_cartao: 3, prazos_dias: [30, 60, 90] });
    expect(porExt['Z-4']).toMatchObject({ parcelas_cartao: 4, prazos_dias: [30, 60, 90, 120] });
    expect(porExt['Z-12']).toMatchObject({ parcelas_cartao: 12, prazos_dias: prazosDoCartao(12) });
    expect(porExt['Z-13']).toBeUndefined();
    const erros = rel.erros.filter((e) => e.arquivo === 'prazo_pagamento.csv');
    expect(erros).toHaveLength(1);
    expect(erros[0]).toMatchObject({ codigo: 'RN-CAD-09', motivo: expect.stringContaining('cartão: informe de 1 a 12 parcelas') });
    expect(JSON.stringify(rel.erros)).not.toContain('13x');
  });

  it('RN-CAD-09: cartão com prazos soltos ("30/60") vira erro de linha RN-CAD-09', async () => {
    const t = montar();
    const rel = (await t.carregar('gravar', { arquivos: lote('FP-C;CARTAO;Cartão;;sim;1', 'Z-CS;FP-C;CS;30/60;;sim;Cartão;;;1') })).corpo as RelatorioCarga;
    expect(conds(t)).toHaveLength(0);
    const erros = rel.erros.filter((e) => e.arquivo === 'prazo_pagamento.csv');
    expect(erros).toHaveLength(1);
    expect(erros[0]?.codigo).toBe('RN-CAD-09');
  });

  it('RN-CAD-09: cheque, depósito, transferência e código desconhecido sem condição gravada viram erro RN-CAD-09 "forma não aceita…"; as condições do lote para eles também', async () => {
    const t = montar();
    const rel = (await t.carregar('gravar', {
      arquivos: lote('FP-X1;CHEQUE;Cheque;;sim;1\nFP-X2;DEPOSITO;Dep;;sim;2\nFP-X3;TRANSFERENCIA;Tr;;sim;3\nFP-X4;QUALQUER;Q;;sim;4', 'Z-X;FP-X1;CHQ;30;;sim;Cheque 30;;;1'),
    })).corpo as RelatorioCarga;
    const doDominio = rel.erros.filter((e) => e.codigo === 'RN-CAD-09');
    expect(doDominio).toHaveLength(4);
    expect(doDominio.every((e) => e.motivo.startsWith('forma não aceita: use Dinheiro, PIX, Cartão ou Boleto'))).toBe(true);
    expect(JSON.stringify(rel.erros)).not.toContain('CHEQUE');
    expect(conds(t)).toHaveLength(0);
  });

  it('RN-CAD-09/RN-CAD-08: forma recusada com condições antigas desativa as condições (aviso, auditoria e evento por condição), sem apagar; regravar é idempotente', async () => {
    const t = montar();
    await t.carregar('gravar');
    const antes = t.repos.condicoesPagamento.linhas.filter((c) => c.forma_external_id === 'FP-EX-01');
    expect(antes).toHaveLength(2);
    t.eventos.length = 0;
    t.auditoria.length = 0;
    const forma = readFileSync(join(pasta, 'forma_pagamento.csv'), 'utf8').replace('FP-EX-01;BOLETO;', 'FP-EX-01;CHEQUE;');
    const soForma = [{ nome: 'forma_pagamento.csv', conteudo: forma }];
    const rel = (await t.carregar('gravar', { arquivos: soForma })).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    expect(porEntidade(rel).forma_pagamento!.avisos.join(' ')).toContain('2 condição(ões) desativada(s)');
    const depois = t.repos.condicoesPagamento.linhas.filter((c) => c.forma_external_id === 'FP-EX-01');
    expect(depois).toHaveLength(2);
    expect(depois.every((c) => c.inativo === true)).toBe(true);
    expect(t.repos.condicoesPagamento.linhas.find((c) => c.forma_external_id === 'FP-EX-02')?.inativo).toBe(false);
    expect(t.eventos.filter((e) => e.nome === 'cadastros.condicao_pagamento.alterada@1' && e.payload.inativo === true)).toHaveLength(2);
    expect(t.auditoria.filter((a) => a.acao === 'condicao_pagamento.inativar')).toHaveLength(2);
    t.eventos.length = 0;
    const rel2 = (await t.carregar('gravar', { arquivos: soForma })).corpo as RelatorioCarga;
    expect(t.eventos.filter((e) => e.nome === 'cadastros.condicao_pagamento.alterada@1')).toHaveLength(0);
    expect(porEntidade(rel2).forma_pagamento).toMatchObject({ atualizadas: 0, sem_mudanca: 2 });
    expect(porEntidade(rel2).forma_pagamento!.avisos.join(' ')).toContain('nenhuma condição ativa');
  });

  it('RN-CAD-09: a carga limpa cartão sem parcelas: prazos 30×N preenchem parcelas_cartao; o resto é desativado (auditoria e evento)', async () => {
    const t = montar();
    const ok = (await t.repos.condicoesPagamento.inserir({ codigo: 'K3', descricao: 'K', forma_tpag: '03', prazos_dias: prazosDoCartao(3), parcelas_cartao: null } as never)) as { id: string };
    const ruim = (await t.repos.condicoesPagamento.inserir({ codigo: 'K7', descricao: 'K', forma_tpag: '03', prazos_dias: [7, 14], parcelas_cartao: null } as never)) as { id: string };
    t.eventos.length = 0;
    t.auditoria.length = 0;
    await t.carregar('gravar', { arquivos: lote('FP-C;CARTAO;Cartão;;sim;1', 'Z-1;FP-C;C1;1x;;sim;;;;1') });
    const por = (id: string) => t.repos.condicoesPagamento.linhas.find((c) => c.id === id);
    expect(por(ok.id)).toMatchObject({ parcelas_cartao: 3, inativo: false });
    expect(por(ruim.id)?.inativo).toBe(true);
    expect(t.auditoria.filter((a) => a.acao === 'condicao_pagamento.preencher_parcelas')).toHaveLength(1);
    expect(t.auditoria.filter((a) => a.acao === 'condicao_pagamento.inativar')).toHaveLength(1);
    expect(t.eventos.filter((e) => e.nome === 'cadastros.condicao_pagamento.alterada@1' && e.payload.id === ok.id)).toHaveLength(1);
    expect(t.repos.condicoesPagamento.linhas.filter((c) => !c.inativo && c.forma_tpag === '03' && c.parcelas_cartao == null)).toHaveLength(0);
  });

  it('RN-CAD-09: um aplicar que lança RN-CAD-09 (ex.: 23514 traduzido) vira erro de linha RN-CAD-09 com a mensagem do erro', async () => {
    const t = montar();
    t.repos.condicoesPagamento.inserir = async () => { throw erros.regra('RN-CAD-09', 'Condição de pagamento inválida: fixa', { parcelas_cartao: 'x' }); };
    const r = (await t.carregar('gravar', { arquivos: lote('FP-C;CARTAO;Cartão;;sim;1', 'Z-1;FP-C;C1;1x;;sim;;;;1') })).corpo as RelatorioCarga;
    expect(r.erros.filter((x) => x.codigo === 'RN-CAD-09')).toEqual([expect.objectContaining({ arquivo: 'prazo_pagamento.csv', campo: 'parcelas_cartao' })]);
  });
});

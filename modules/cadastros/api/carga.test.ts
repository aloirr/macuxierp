import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { erros } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CargaPedido, ErroCarga, MAX_LINHAS_LOTE, type RelatorioCarga } from '../contracts';
import { MSG_REGIME_PIS_COFINS_CRT3 } from '../domain';
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

  it('RN-CAD-17: saldo fracionário em produto de unidade UN é erro de linha no campo saldo; em KG passa', async () => {
    const t = montar();
    const estoque = (produto: string) => ({
      nome: 'estoque.csv',
      conteudo: Buffer.from(`external_id;deposito_external_id;produto_external_id;saldo;alterado_em;ativo;deposito_nome;filial_external_id\nE-EX-01;D1;${produto};10,5;;sim;Deposito 1;F-EX-01\n`),
    });
    const base = arquivos(['estoque.csv']);
    const rel = (await t.carregar('validar', { arquivos: [...base, estoque('P-EX-01')] })).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([expect.objectContaining({ arquivo: 'estoque.csv', linha: 2, campo: 'saldo', codigo: 'RN-CAD-17' })]);
    // P-EX-01 vira KG: a mesma linha passa
    const produtos = arquivos(['estoque.csv', 'produto.csv']);
    const produtoKg = { nome: 'produto.csv', conteudo: Buffer.from(readFileSync(join(pasta, 'produto.csv'), 'utf8').replace('Produto Exemplo 01;UN;', 'Produto Exemplo 01;KG;')) };
    const ok = (await t.carregar('validar', { arquivos: [...produtos, produtoKg, estoque('P-EX-01')] })).corpo as RelatorioCarga;
    expect(ok.erros.filter((e) => e.arquivo === 'estoque.csv')).toEqual([]); // o preço do kit segue em UN: erro de outro arquivo
  });

  it('D13: o modo validar prevê as contagens, não grava nem publica nem audita', async () => {
    const t = montar();
    const r = await t.carregar('validar');
    expect(r.status).toBe(200);
    const rel = r.corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    const e = porEntidade(rel);
    expect(e.filial).toMatchObject({ situacao: 'processado', lidas: 1, inseridas: 1 });
    expect(e.cliente).toMatchObject({ lidas: 3, inseridas: 3 });
    expect(e.condicao_pagamento).toMatchObject({ lidas: 3, inseridas: 3 });
    expect(e.estoque).toMatchObject({ lidas: 2, inseridas: 2 });
    expect(e.titulo).toMatchObject({ situacao: 'ignorado' });
    expect(t.repos.filiais.linhas).toHaveLength(0);
    expect(t.repos.clientes.linhas).toHaveLength(0);
    expect(t.eventos).toHaveLength(0);
    expect(t.auditoria).toHaveLength(0);
  });

  it('D13/D4: gravar cria os 8 arquivos na ordem e publica um evento por cadastro', async () => {
    const t = montar();
    const rel = (await t.carregar('gravar')).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    const e = porEntidade(rel);
    for (const n of ['filial', 'vendedor', 'condicao_pagamento', 'produto', 'produto_unidade', 'preco', 'estoque', 'cliente']) {
      expect(e[n], n).toMatchObject({ situacao: 'processado', recusadas: 0 });
      expect(e[n]!.inseridas + e[n]!.atualizadas, n).toBeGreaterThan(0);
    }
    expect(t.repos.filiais.linhas[0]).toMatchObject({ padrao: true, emissora: false, external_id: 'F-EX-01' });
    expect(t.repos.condicoesPagamento.linhas).toHaveLength(3);
    expect(t.repos.condicoesPagamento.linhas[0]).toMatchObject({ forma_external_id: 'FP-EX-01', forma_tpag: '15', forma_codigo: 'BOLETO' });
    expect(t.repos.clientes.linhas).toHaveLength(2);
    expect(t.repos.clientes.enderecos.linhas.map((x) => [x.external_id, x.tipo]).sort()).toEqual([['C-EX-01:entrega:1', 'entrega'], ['C-EX-01:principal', 'principal'], ['C-EX-02:principal', 'principal']]);
    expect([...t.repos.estoque.movimentos.map((m) => m.quantidade)]).toEqual([100_000 + 40_000]);
    expect(t.eventos.some((x) => x.nome === 'cadastros.cliente.alterado@1')).toBe(true);
    expect(t.eventos.filter((x) => x.nome === 'cadastros.preco.alterado@1')).toHaveLength(2);
    const aud = t.auditoria.find((a) => a.acao === 'cadastros.carga');
    expect(aud?.depois).toMatchObject({ modo: 'gravar', arquivos: expect.arrayContaining([{ entidade: 'filial', sha256: expect.stringMatching(/^[0-9a-f]{64}$/), bytes: expect.any(Number) }]) });
  });

  it('RN-CAD-15: linha de condição com forma à vista e prazo maior que 0 vira erro da linha; as demais seguem', async () => {
    const t = montar();
    const cond = readFileSync(join(pasta, 'condicoes_pagamento.csv'), 'utf8').replace('PZ-EX-03;PIXV;0;', 'PZ-EX-03;PIXV;0/30;');
    const rel = (await t.carregar('gravar', { arquivos: [...arquivos(['condicoes_pagamento.csv']), { nome: 'condicoes_pagamento.csv', conteudo: cond }] })).corpo as RelatorioCarga;
    expect(rel.erros).toContainEqual(expect.objectContaining({ arquivo: 'condicoes_pagamento.csv', codigo: 'RN-CAD-15', campo: 'prazos_dias' }));
    expect(JSON.stringify(rel.erros)).not.toContain('0/30');
    expect(t.repos.condicoesPagamento.linhas).toHaveLength(2);
  });

  it('RN-CAD-15: a forma que passa a à vista numa condição a prazo gravada vira erro da linha e não atualiza nenhuma condição', async () => {
    const t = montar();
    await t.carregar('gravar');
    const antes = JSON.stringify(t.repos.condicoesPagamento.linhas);
    const cond = readFileSync(join(pasta, 'condicoes_pagamento.csv'), 'utf8').replaceAll(';BOLETO;Boleto Exemplo;', ';PIX;Pix Exemplo;');
    const rel = (await t.carregar('gravar', { arquivos: [...arquivos(['condicoes_pagamento.csv']), { nome: 'condicoes_pagamento.csv', conteudo: cond }] })).corpo as RelatorioCarga;
    expect(rel.erros).toContainEqual(expect.objectContaining({ arquivo: 'condicoes_pagamento.csv', codigo: 'RN-CAD-15', campo: 'prazos_dias' }));
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
    expect(rel.erros).toContainEqual(expect.objectContaining({ arquivo: 'filial.csv', linha: null, codigo: 'PERFIL_SEM_PERMISSAO', motivo: 'Só o administrador carrega filial e limite de crédito.' }));
    expect(porEntidade(rel).vendedor).toMatchObject({ situacao: 'processado', inseridas: 1 });
    expect(t.repos.vendedores.linhas).toHaveLength(1);
  });

  it('D13: arquivo recusado não para os seguintes; a linha que dependia dele cai como CARGA_DEPENDENCIA (RF-CAD-11, arquivo ausente do lote)', async () => {
    const t = montar();
    const r = await t.carregar('gravar', { arquivos: arquivos().filter((a) => a.nome !== 'filial.csv') });
    const rel = r.corpo as RelatorioCarga;
    expect(rel.erros.filter((e) => e.arquivo === 'vendedor.csv')).toEqual([expect.objectContaining({ codigo: 'CARGA_DEPENDENCIA', campo: 'filial_external_id', motivo: 'Vendedor filial_external_id não encontrado: carregue o cadastro de filiais ou corrija a coluna filial_external_id.' })]);
    expect(porEntidade(rel).condicao_pagamento).toMatchObject({ inseridas: 3 });
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

  it('RN-FIS-02: filial CRT 3 sem regime de PIS/COFINS (na célula e no cadastro) é recusada; com o regime no cadastro, a linha sem a célula passa', async () => {
    const t = montar();
    const sem = readFileSync(join(pasta, 'filial.csv'), 'utf8').replace(';nao_cumulativo', ';');
    const r = (await t.carregar('gravar', { arquivos: [{ nome: 'filial.csv', conteudo: sem }] })).corpo as RelatorioCarga;
    expect(r.erros).toEqual([expect.objectContaining({ linha: 2, codigo: 'RN-FIS-02', campo: 'regime_pis_cofins', motivo: MSG_REGIME_PIS_COFINS_CRT3 })]);
    expect(t.repos.filiais.linhas).toHaveLength(0);
    await t.carregar('gravar', { arquivos: arquivos().filter((a) => a.nome === 'filial.csv') });
    const ok = (await t.carregar('gravar', { arquivos: [{ nome: 'filial.csv', conteudo: sem.replace('Matriz', 'Matriz 2') }] })).corpo as RelatorioCarga;
    expect(ok.erros).toEqual([]);
    expect(porEntidade(ok).filial).toMatchObject({ atualizadas: 1 });
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
    expect((cli.payload.enderecos as { external_id: string }[]).map((x) => x.external_id).sort()).toEqual(['C-EX-01:entrega:1', 'C-EX-01:principal']);
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
    // lote grande: o --tudo paralelo pode passar de 5 s (aviso do apps, 23/11)
    }, 30_000);
  });
});

describe('RN-CAD-09 na carga: classe da forma (cartão, à vista, boleto, forma recusada)', () => {
  const CAB = 'external_id;codigo;parcelas_dias;prazo_medio_dias;forma_codigo;forma_nome;forma_external_id;ativo;descricao\n';
  const lote = (linhas: string) => [...arquivos(['condicoes_pagamento.csv']), { nome: 'condicoes_pagamento.csv', conteudo: CAB + linhas }];
  const conds = (t: ReturnType<typeof montar>) => t.repos.condicoesPagamento.linhas.filter((c) => String(c.external_id).startsWith('Z-'));
  const ARQ = 'condicoes_pagamento.csv';

  it('RN-CAD-15: cartão tem os dias digitados (1 a 12 parcelas): grava os prazos, o prazo médio e parcelas_cartao derivada; 13 parcelas recusa', async () => {
    const t = montar();
    const l = (id: string, parcelas: string, medio = '30') => `Z-${id};C${id};${parcelas};${medio};CARTAO_CREDITO;Cartão;FP-C;sim;Cartão ${id}`;
    const treze = Array.from({ length: 13 }, () => '30').join('/');
    const rel = (await t.carregar('gravar', { arquivos: lote([l('1', '30'), l('3', '7/21/45', '24'), l('12', Array.from({ length: 12 }, () => '30').join('/')), l('13', treze)].join('\n')) })).corpo as RelatorioCarga;
    const porExt = Object.fromEntries(conds(t).map((c) => [c.external_id, c]));
    expect(porExt['Z-1']).toMatchObject({ forma_tpag: '03', parcelas_cartao: 1, prazos_dias: [30], prazo_medio_dias: 30, forma_external_id: 'FP-C', forma_nome: 'Cartão' });
    expect(porExt['Z-3']).toMatchObject({ parcelas_cartao: 3, prazos_dias: [7, 21, 45], prazo_medio_dias: 24 });
    expect(porExt['Z-12']).toMatchObject({ parcelas_cartao: 12 });
    expect(porExt['Z-13']).toBeUndefined();
    const erros = rel.erros.filter((e) => e.arquivo === ARQ);
    expect(erros).toHaveLength(1);
    expect(erros.find((e) => e.codigo === 'RN-CAD-09')).toMatchObject({ motivo: expect.stringContaining('cartão: 1 a 12 parcelas') });
  });

  it('RN-CAD-15 (decisão 14 A): prazo médio vazio na criação é calculado e gravado; digitado não é sobrescrito; na atualização, vazio mantém o digitado e recalcula o vazio', async () => {
    const t = montar();
    const sem = (await t.carregar('gravar', { arquivos: lote('Z-S;CS;30/45;;BOLETO;Boleto;FP-B;sim;Boleto 30/45') })).corpo as RelatorioCarga;
    expect(sem.erros.filter((e) => e.arquivo === ARQ)).toEqual([]);
    expect(conds(t)[0]).toMatchObject({ prazos_dias: [30, 45], prazo_medio_dias: 38, prazo_medio_calculado: true });
    await t.carregar('gravar', { arquivos: lote('Z-S;CS;30/45;7;BOLETO;Boleto;FP-B;sim;Boleto 30/45') });
    expect(conds(t)[0]).toMatchObject({ prazo_medio_dias: 7, prazo_medio_calculado: false });
    // decisão 17 B: a origem manda; célula vazia com parcelas na linha é cálculo, com a marca true, mesmo sobre um digitado
    await t.carregar('gravar', { arquivos: lote('Z-S;CS;30/90;;BOLETO;Boleto;FP-B;sim;Boleto 30 dias') });
    expect(conds(t)[0]).toMatchObject({ prazos_dias: [30, 90], prazo_medio_dias: 60, prazo_medio_calculado: true, descricao: 'Boleto 30 dias' });
    await t.carregar('gravar', { arquivos: lote('Z-S;CS;30/90;5;BOLETO;Boleto;FP-B;sim;Boleto 30 dias') });
    expect(conds(t)[0]).toMatchObject({ prazo_medio_dias: 5, prazo_medio_calculado: false });
  });

  it('RN-CAD-09: cheque, depósito, transferência e código desconhecido viram erro RN-CAD-09 "forma não aceita…" em cada condição', async () => {
    const t = montar();
    const rel = (await t.carregar('gravar', {
      arquivos: lote('Z-X1;X1;30;30;CHEQUE;Cheque;FP-X1;sim;Cheque 30\nZ-X2;X2;30;30;DEPOSITO;Dep;FP-X2;sim;Dep 30\nZ-X3;X3;30;30;TRANSFERENCIA;Tr;FP-X3;sim;Tr 30\nZ-X4;X4;30;30;QUALQUER;Q;FP-X4;sim;Q 30'),
    })).corpo as RelatorioCarga;
    const doDominio = rel.erros.filter((e) => e.codigo === 'RN-CAD-09');
    expect(doDominio).toHaveLength(4);
    expect(doDominio.every((e) => e.motivo.startsWith('forma não aceita: use Dinheiro, PIX, Cartão ou Boleto'))).toBe(true);
    expect(JSON.stringify(rel.erros)).not.toContain('CHEQUE');
    expect(conds(t)).toHaveLength(0);
  });

  it('RN-CAD-09/RN-CAD-08: forma recusada desativa as outras condições dela que não estão no arquivo (aviso, auditoria e evento por condição), sem apagar; regravar é idempotente', async () => {
    const t = montar();
    await t.carregar('gravar');
    const antes = t.repos.condicoesPagamento.linhas.filter((c) => c.forma_external_id === 'FP-EX-01');
    expect(antes).toHaveLength(2);
    t.eventos.length = 0;
    t.auditoria.length = 0;
    // só a PZ-EX-01 vem, trocando a forma para cheque: ela mesma é recusada; a PZ-EX-02 (fora do arquivo) é desativada
    const soUma = [{ nome: ARQ, conteudo: CAB + 'PZ-EX-01;BOL30;30;30;CHEQUE;Cheque;FP-EX-01;sim;Boleto 30 dias' }];
    const rel = (await t.carregar('gravar', { arquivos: soUma })).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([expect.objectContaining({ linha: 2, codigo: 'RN-CAD-09' })]);
    expect(porEntidade(rel).condicao_pagamento!.avisos.join(' ')).toContain('1 condição(ões) desativada(s)');
    const por = (ext: string) => t.repos.condicoesPagamento.linhas.find((c) => c.external_id === ext);
    expect(por('PZ-EX-02')?.inativo).toBe(true);
    expect(por('PZ-EX-01')).toMatchObject({ inativo: false, forma_tpag: '15' });
    expect(por('PZ-EX-03')?.inativo).toBe(false);
    expect(t.eventos.filter((e) => e.nome === 'cadastros.condicao_pagamento.alterada@1' && e.payload.inativo === true)).toHaveLength(1);
    expect(t.auditoria.filter((a) => a.acao === 'condicao_pagamento.inativar')).toHaveLength(1);
    t.eventos.length = 0;
    await t.carregar('gravar', { arquivos: soUma });
    expect(t.eventos.filter((e) => e.nome === 'cadastros.condicao_pagamento.alterada@1')).toHaveLength(0);
  });

  it('T-0058: a forma nova de uma condição atualiza as outras condições da forma que não estão no arquivo', async () => {
    const t = montar();
    await t.carregar('gravar');
    t.eventos.length = 0;
    const soUma = [{ nome: ARQ, conteudo: CAB + 'PZ-EX-01;BOL30;30;30;BOLETO;Boleto Renomeado;FP-EX-01;sim;Boleto 30 dias' }];
    const rel = (await t.carregar('gravar', { arquivos: soUma })).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    expect(t.repos.condicoesPagamento.linhas.filter((c) => c.forma_external_id === 'FP-EX-01').map((c) => c.forma_nome)).toEqual(['Boleto Renomeado', 'Boleto Renomeado']);
    expect(porEntidade(rel).condicao_pagamento!.avisos.join(' ')).toContain('Forma atualizada em 1 condição(ões)');
  });

  it('RN-CAD-09: a carga limpa cartão sem parcelas: prazos válidos (RN-CAD-15) preenchem parcelas_cartao; mais de 12 parcelas é desativado (auditoria e evento)', async () => {
    const t = montar();
    const ok = (await t.repos.condicoesPagamento.inserir({ codigo: 'K3', descricao: 'K', forma_tpag: '03', prazos_dias: [30, 60, 90], parcelas_cartao: null } as never)) as { id: string };
    const ruim = (await t.repos.condicoesPagamento.inserir({ codigo: 'K7', descricao: 'K', forma_tpag: '03', prazos_dias: Array(13).fill(7), parcelas_cartao: null } as never)) as { id: string };
    t.eventos.length = 0;
    t.auditoria.length = 0;
    await t.carregar('gravar', { arquivos: lote('Z-1;C1;30;30;CARTAO;Cartão;FP-C;sim;Cartão 1') });
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
    const r = (await t.carregar('gravar', { arquivos: lote('Z-1;C1;30;30;CARTAO;Cartão;FP-C;sim;Cartão 1') })).corpo as RelatorioCarga;
    expect(r.erros.filter((x) => x.codigo === 'RN-CAD-09')).toEqual([expect.objectContaining({ arquivo: ARQ, campo: 'parcelas_cartao' })]);
  });
});

describe('T-0058: condições de pagamento (forma e prazo na mesma linha)', () => {
  const CAB = 'external_id;codigo;parcelas_dias;prazo_medio_dias;forma_codigo;forma_nome;forma_external_id;forma_tpag\n';
  const so = (linhas: string, nome = 'condicoes_pagamento.csv') => [{ nome, conteudo: CAB + linhas }];

  it('T-0058: forma conflitante entre linhas: a linha não grava, a condição dela é recusada e as demais gravam', async () => {
    const t = montar();
    const rel = (await t.carregar('gravar', { arquivos: so('K1;A1;30;30;BOLETO;Boleto;F1;\nK2;A2;30;30;BOLETO;Boleto SEGREDO;F1;\nK3;A3;0;0;PIX;Pix;F2;\nK4;A4;30;30;PIX;Pix;F2;03') })).corpo as RelatorioCarga;
    expect(rel.erros.map((e) => [e.linha, e.campo, e.codigo])).toEqual([[3, 'forma_nome', 'CARGA_CONFLITO'], [5, 'forma_tpag', 'CARGA_CONFLITO']]);
    expect(JSON.stringify(rel)).not.toContain('SEGREDO');
    expect(porEntidade(rel).condicao_pagamento).toMatchObject({ lidas: 4, inseridas: 2, recusadas: 2 });
    expect(t.repos.condicoesPagamento.linhas.map((c) => c.external_id)).toEqual(['K1', 'K3']);
  });

  it('T-0058: a forma sem forma_external_id vale pelo forma_codigo, e as linhas seguintes herdam o nome e o tPag da 1ª', async () => {
    const t = montar();
    const rel = (await t.carregar('gravar', { arquivos: so('K1;A1;30;30;BOLETO;Boleto;;\nK2;A2;30/60;45;BOLETO;;;') })).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    expect(t.repos.condicoesPagamento.linhas).toHaveLength(2);
    expect(t.repos.condicoesPagamento.linhas.every((c) => c.forma_tpag === '15' && c.forma_nome === 'Boleto' && !c.forma_external_id)).toBe(true);
  });

  it('T-0058: condicao_pagamento.csv (nome do portal) também vale e o modelo se chama condicoes_pagamento.csv', async () => {
    const t = montar();
    const rel = (await t.carregar('validar', { arquivos: so('K1;A1;30;30;BOLETO;Boleto;F1;', 'condicao_pagamento.csv') })).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    expect(porEntidade(rel).condicao_pagamento).toMatchObject({ situacao: 'processado', inseridas: 1 });
    const m = await t.chamar('GET', '/cargas/modelos/condicao_pagamento', { sessao: adm });
    expect(m.corpo).toBe('﻿external_id;codigo;parcelas_dias;prazo_medio_dias;forma_codigo;forma_nome;ativo;descricao;forma_external_id;forma_tpag\r\n');
    expect(m.cabecalhos).toMatchObject({ 'content-disposition': 'attachment; filename="condicoes_pagamento.csv"' });
    const unico = await t.carregar('validar', { corpo: { modo: 'validar', entidade: 'condicao_pagamento' }, arquivos: so('K1;A1;30;30;BOLETO;Boleto;F1;') });
    expect(unico.status).toBe(200);
  });

  it('T-0058: forma_pagamento.csv e prazo_pagamento.csv deixaram de ser carga: ignorados com aviso, sem erro', async () => {
    const t = montar();
    const rel = (await t.carregar('validar', { arquivos: [{ nome: 'forma_pagamento.csv', conteudo: 'x\n' }, { nome: 'prazo_pagamento.csv', conteudo: 'x\n' }] })).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    expect(porEntidade(rel).forma_pagamento).toMatchObject({ situacao: 'ignorado', avisos: ['A forma de pagamento agora vem no condicoes_pagamento.csv'] });
    expect(porEntidade(rel).prazo_pagamento).toMatchObject({ situacao: 'ignorado' });
  });
});

describe('T-0058: cliente e endereço numa carga só (cliente.csv)', () => {
  const CAB = 'external_id;razao_social;documento;filial_external_id;endereco.logradouro;endereco.numero;endereco.bairro;endereco.cidade;endereco.uf;endereco.cep;tipo_endereco;seq\n';
  const L = (ext: string, rua: string, tipo: string, seq = '', razao = 'Cliente T', doc = '99.000.002/0001-48') =>
    `${ext};${razao};${doc};F-EX-01;${rua};10;Centro;Manaus;AM;69000-00${rua.length % 9};${tipo};${seq}`;
  const base = () => arquivos().filter((a) => ['filial.csv'].includes(a.nome));
  const cli = (linhas: string[]) => [...base(), { nome: 'cliente.csv', conteudo: CAB + linhas.join('\n') }];
  const ends = (t: ReturnType<typeof montar>) => t.repos.clientes.enderecos.linhas.map((e) => `${e.external_id}|${e.tipo}`).sort();

  it('T-0058: cada linha vira um endereço do mesmo cliente, com external_id <cliente>:<tipo>[:<seq>] e um evento só do cliente', async () => {
    const t = montar();
    const rel = (await t.carregar('gravar', { arquivos: cli([L('C1', 'Rua A', 'principal'), L('C1', 'Rua BB', 'entrega', '1'), L('C1', 'Rua CCC', 'entrega', '2'), L('C1', 'Rua D', 'cobranca')]) })).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    expect(t.repos.clientes.linhas).toHaveLength(1);
    expect(ends(t)).toEqual(['C1:cobranca|cobranca', 'C1:entrega:1|entrega', 'C1:entrega:2|entrega', 'C1:principal|principal']);
    expect(porEntidade(rel).cliente).toMatchObject({ lidas: 4, inseridas: 4, recusadas: 0 });
    expect(t.eventos.filter((e) => e.nome === 'cadastros.cliente.alterado@1')).toHaveLength(1);
  });

  it('T-0058: dado do cliente diferente entre as linhas: a linha não grava e o resto do cliente grava, sem valor de célula no relatório', async () => {
    const t = montar();
    const rel = (await t.carregar('gravar', { arquivos: cli([L('C1', 'Rua A', 'principal'), L('C1', 'Rua BB', 'entrega', '1', 'Razao SEGREDO')]) })).corpo as RelatorioCarga;
    expect(rel.erros.map((e) => [e.linha, e.codigo])).toEqual([[3, 'CARGA_CONFLITO']]);
    expect(JSON.stringify([rel, t.auditoria])).not.toContain('SEGREDO');
    expect(ends(t)).toEqual(['C1:principal|principal']);
    expect(porEntidade(rel).cliente).toMatchObject({ lidas: 2, inseridas: 1, recusadas: 1 });
  });

  it('T-0058: cliente sem linha principal: a 1ª linha grava como principal, com aviso e sem erro', async () => {
    const t = montar();
    const rel = (await t.carregar('gravar', { arquivos: cli([L('C1', 'Rua A', 'entrega', '1'), L('C1', 'Rua BB', 'cobranca')]) })).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    expect(porEntidade(rel).cliente!.avisos).toHaveLength(1);
    expect(ends(t)).toEqual(['C1:cobranca|cobranca', 'C1:principal|principal']);
  });

  it('T-0058: endereço repetido: a 2ª linha não grava e o resto do cliente grava', async () => {
    const t = montar();
    const rel = (await t.carregar('gravar', { arquivos: cli([L('C1', 'Rua A', 'principal'), L('C1', 'Rua BB', 'entrega', '1'), L('C1', 'Rua CCC', 'entrega', '1')]) })).corpo as RelatorioCarga;
    expect(rel.erros.map((e) => [e.linha, e.campo, e.codigo])).toEqual([[4, 'seq', 'CARGA_DUPLICADO']]);
    expect(ends(t)).toEqual(['C1:entrega:1|entrega', 'C1:principal|principal']);
    expect(porEntidade(rel).cliente).toMatchObject({ lidas: 3, inseridas: 2, recusadas: 1 });
  });

  it('T-0058 (RF-CAD-11): cliente com erro (filial inexistente): o erro sai só na 1ª linha dele e as outras linhas do cliente entram em recusadas', async () => {
    const t = montar();
    const rel = (await t.carregar('gravar', { arquivos: [{ nome: 'cliente.csv', conteudo: CAB + [L('C1', 'Rua A', 'principal'), L('C1', 'Rua BB', 'entrega', '1'), L('C1', 'Rua CCC', 'entrega', '2')].join('\n') }] })).corpo as RelatorioCarga;
    expect(rel.erros.map((e) => e.linha)).toEqual([2]);
    expect(porEntidade(rel).cliente).toMatchObject({ lidas: 3, inseridas: 0, recusadas: 3 });
    expect(t.repos.clientes.linhas).toHaveLength(0);
    expect(ends(t)).toEqual([]);
  });

  it('T-0058: endereço novo com campo faltando vira erro da linha dele; o cliente e os outros endereços gravam', async () => {
    const t = montar();
    const sem = `C1;Cliente T;99.000.002/0001-48;F-EX-01;Rua BB;10;;Manaus;AM;69000-002;entrega;1`;
    const rel = (await t.carregar('gravar', { arquivos: cli([L('C1', 'Rua A', 'principal'), sem]) })).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([expect.objectContaining({ linha: 3, campo: 'endereco.bairro', codigo: 'CARGA_OBRIGATORIO' })]);
    expect(ends(t)).toEqual(['C1:principal|principal']);
    expect(porEntidade(rel).cliente).toMatchObject({ lidas: 2, inseridas: 1, recusadas: 1 });
  });

  it('T-0058: external_id do endereço acima de 200 caracteres: a linha não valida (CARGA_TAMANHO)', async () => {
    const t = montar();
    const longo = 'C'.repeat(190);
    const rel = (await t.carregar('validar', { arquivos: cli([L(longo, 'Rua A', 'principal'), L(longo, 'Rua BB', 'entrega', '12')]) })).corpo as RelatorioCarga;
    expect(rel.erros.map((e) => [e.linha, e.campo, e.codigo])).toEqual([[3, 'external_id', 'CARGA_TAMANHO']]);
  });

  it('T-0058: regravar o arquivo é todo sem_mudanca; endereço novo numa linha nova entra no cliente existente; o tipo_endereco ausente vira principal', async () => {
    const t = montar();
    const l1 = [L('C1', 'Rua A', 'principal'), L('C1', 'Rua BB', 'entrega', '1')];
    await t.carregar('gravar', { arquivos: cli(l1) });
    t.eventos.length = 0;
    const de = (await t.carregar('gravar', { arquivos: cli(l1) })).corpo as RelatorioCarga;
    expect(porEntidade(de).cliente).toMatchObject({ sem_mudanca: 2, inseridas: 0, atualizadas: 0 });
    expect(t.eventos).toHaveLength(0);
    const mais = (await t.carregar('gravar', { arquivos: cli([...l1, L('C1', 'Rua CCC', 'entrega', '2')]) })).corpo as RelatorioCarga;
    expect(mais.erros).toEqual([]);
    expect(porEntidade(mais).cliente).toMatchObject({ atualizadas: 3 });
    expect(ends(t)).toContain('C1:entrega:2|entrega');
    expect(t.eventos.filter((e) => e.nome === 'cadastros.cliente.alterado@1')).toHaveLength(1);
  });

  it('T-0058: o principal gravado pelo BKO (sem external_id) é adotado e o campo alterado atualiza o endereço', async () => {
    const t = montar();
    await t.carregar('gravar', { arquivos: cli([L('C1', 'Rua A', 'principal')]) });
    for (const e of t.repos.clientes.enderecos.linhas) (e as { external_id: string | null }).external_id = null;
    const rel = (await t.carregar('gravar', { arquivos: cli([L('C1', 'Rua AAAA', 'principal')]) })).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    expect(t.repos.clientes.enderecos.linhas).toHaveLength(1);
    expect(t.repos.clientes.enderecos.linhas[0]).toMatchObject({ external_id: 'C1:principal', logradouro: 'Rua AAAA' });
  });

  it('T-0058: o endereço inativado volta a ativo quando o arquivo o traz de novo', async () => {
    const t = montar();
    const linhas = [L('C1', 'Rua A', 'principal'), L('C1', 'Rua BB', 'entrega', '1')];
    await t.carregar('gravar', { arquivos: cli(linhas) });
    const entrega = t.repos.clientes.enderecos.linhas.find((e) => e.external_id === 'C1:entrega:1')!;
    entrega.inativo = true;
    await t.carregar('gravar', { arquivos: cli(linhas) });
    expect(t.repos.clientes.enderecos.linhas.find((e) => e.external_id === 'C1:entrega:1')?.inativo).toBe(false);
  });

  it('T-0058: cliente_endereco.csv deixou de ser carga: ignorado com aviso, sem erro', async () => {
    const t = montar();
    const rel = (await t.carregar('validar', { arquivos: [{ nome: 'cliente_endereco.csv', conteudo: 'external_id;cliente_external_id\nE1;C1\n' }] })).corpo as RelatorioCarga;
    expect(rel.erros).toEqual([]);
    expect(porEntidade(rel).cliente_endereco).toMatchObject({ situacao: 'ignorado', lidas: 0, avisos: ['Os endereços agora vêm no cliente.csv'] });
  });

  it('RN-CAD-02: IE de cliente novo vale pela UF do endereço principal, mesmo quando a 1ª linha é a de entrega', async () => {
    const t = montar();
    const ent = `C1;Cliente T;99.000.002/0001-48;F-EX-01;Rua Z;10;Centro;São Paulo;SP;01000-000;entrega;1`;
    const prin = L('C1', 'Rua A', 'principal');
    const cab = CAB.replace('seq\n', 'seq;inscricao_estadual\n');
    const arqs = (ie: string) => [...base(), { nome: 'cliente.csv', conteudo: `${cab}${ent};${ie}\n${prin};${ie}\n` }];
    const ruim = (await t.carregar('validar', { arquivos: arqs('012300005') })).corpo as RelatorioCarga;
    expect(ruim.erros.some((e) => e.codigo === 'RN-CAD-02')).toBe(true);
    const ok = (await t.carregar('gravar', { arquivos: arqs('012300004') })).corpo as RelatorioCarga;
    expect(ok.erros).toEqual([]);
    expect(t.repos.clientes.linhas[0]).toMatchObject({ ie: '012300004', ind_ie_dest: '1' });
  });
});

describe('carga por entidade (RF-CAD-11)', () => {
  it('RF-CAD-11: ErroCarga aceita entidade_faltante ausente ou válida e recusa valor fora de EntidadeCarga', () => {
    const base = { arquivo: 'a.csv', linha: 2, campo: 'x', codigo: 'CARGA_DEPENDENCIA', motivo: 'm' };
    expect(ErroCarga.safeParse(base).success).toBe(true);
    expect(ErroCarga.safeParse({ ...base, entidade_faltante: 'produto' }).success).toBe(true);
    expect(ErroCarga.safeParse({ ...base, entidade_faltante: 'inexistente' }).success).toBe(false);
  });
  it('RF-CAD-11: GET /cargas/modelos/:entidade devolve o CSV com BOM e o nome do arquivo', async () => {
    const t = montar();
    const r = await t.chamar('GET', '/cargas/modelos/vendedor', { sessao: adm });
    expect(r.status).toBe(200);
    expect(r.corpo).toBe('\uFEFFexternal_id;nome;ativo;filial_external_id;codigo\r\n');
    expect(r.cabecalhos).toMatchObject({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="vendedor.csv"' });
  });
  it('RF-CAD-11: entidade desconhecida no modelo dá 404 e perfil sem a ação dá 403', async () => {
    const t = montar();
    expect((await t.chamar('GET', '/cargas/modelos/xpto', { sessao: adm })).status).toBe(404);
    expect((await t.chamar('GET', '/cargas/modelos/vendedor', { sessao: sessaoDe('vendedor') })).status).toBe(403);
  });
  it('RF-CAD-11: com `entidade`, o lote precisa ser só <entidade>.csv; senão 400', async () => {
    const t = montar();
    const r = await t.carregar('validar', { corpo: { modo: 'validar', entidade: 'vendedor' } });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.corpo)).toContain('Envie só o arquivo vendedor.csv neste botão.');
    const outro = await t.carregar('validar', { corpo: { modo: 'validar', entidade: 'vendedor' }, arquivos: arquivos().filter((a) => a.nome === 'produto.csv') });
    expect(outro.status).toBe(400);
    const ok = await t.carregar('validar', { corpo: { modo: 'validar', entidade: 'filial' }, arquivos: arquivos().filter((a) => a.nome === 'filial.csv') });
    expect(ok.status).toBe(200);
  });
  it('RF-CAD-11: entidade fora da lista é recusada pelo contrato', () => {
    expect(CargaPedido.safeParse({ modo: 'validar', entidade: 'xpto', arquivos: [{ nome: 'a.csv', bytes: new Uint8Array() }] }).success).toBe(false);
  });

  describe('RN-CAD-04: mensagens fiscais com o código e a ação (exceção à D9 só para NCM/CEST)', () => {
    const CAB = 'external_id;sku;nome;unidade;alterado_em;ativo;ean;marca;custo_cents;preco_venda_cents;desconto_maximo_pct;ncm;cest;origem;grupo_tributacao\n';
    const motivoDe = async (ncm: string, cest: string, ajusta: (t: ReturnType<typeof montar>) => void) => {
      const t = montar();
      ajusta(t);
      const arqs = [...arquivos(['produto.csv']), { nome: 'produto.csv', conteudo: `${CAB}P-F1;SKU-F1;Produto F1;UN;;sim;;M;500;1000;0;${ncm};${cest};0;BEBIDAS` }];
      const rel = (await t.carregar('validar', { arquivos: arqs })).corpo as RelatorioCarga;
      return rel.erros.filter((e) => e.arquivo === 'produto.csv' && e.codigo === 'RN-CAD-04').map((e) => e.motivo);
    };
    it('AM2808: NCM que exige CEST, linha sem CEST', async () => {
      const m = await motivoDe('42022210', '', (t) => { t.repos.oficiais.ncms.add('42022210'); t.repos.oficiais.cests.set('42022210', ['0100100']); t.repos.oficiais.todosCests.add('0100100'); });
      expect(m).toEqual(['O NCM 4202.22.10 exige CEST: preencha a coluna cest.']);
    });
  });
});

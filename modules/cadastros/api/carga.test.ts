import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_LINHAS_LOTE, type RelatorioCarga } from '../contracts';
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

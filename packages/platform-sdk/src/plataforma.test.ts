import { describe, expect, it } from 'vitest';
import { ArmazenamentoMemoria, chaveArquivo, guardarArquivo, type RegistroArquivo } from './arquivos';
import { auditar, OMITIDO } from './auditoria';
import { ErroApi, erros } from './erros';
import { criarEvento } from './eventos';
import { defineModule } from './modulo';
import { definirPlugin, definirRota, eventoDoModulo, PluginInvalido, trabalhoDoModulo } from './rotas';
import { AuditoriaMemoria } from './testes';

const INSTANTE = new Date('2026-11-21T15:00:00Z');
const TENANT = '11111111-1111-4111-8111-111111111111';
const USUARIO = '22222222-2222-4222-8222-222222222222';
const tx = { consultar: async () => [] };

describe('eventos (envelope do contrato)', () => {
  const dados = { nome: 'cadastros.cliente.alterado@1', tenant_id: TENANT, agregado_id: USUARIO, versao: 1, ator: USUARIO, request_id: 'r1', payload: { inativo: false } };

  it('monta o envelope com id e ocorrido_em em UTC', () => {
    const e = criarEvento(dados, INSTANTE, '33333333-3333-4333-8333-333333333333');
    expect(e.ocorrido_em).toBe('2026-11-21T15:00:00.000Z');
    expect(e.id).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('recusa nome fora de <modulo>.<entidade>.<fato>@vN e versão zero', () => {
    expect(() => criarEvento({ ...dados, nome: 'cliente.alterado' }, INSTANTE)).toThrow();
    expect(() => criarEvento({ ...dados, versao: 0 }, INSTANTE)).toThrow();
    expect(eventoDoModulo('cadastros', 'cadastros.cliente.alterado@1')).toBe(true);
    expect(eventoDoModulo('pedido', 'cadastros.cliente.alterado@1')).toBe(false);
  });

  it('trabalho enfileirado é do próprio módulo e segue <modulo>.<tarefa>', () => {
    expect(trabalhoDoModulo('cadastros', 'cadastros.consultar_ie')).toBe(true);
    expect(trabalhoDoModulo('integracao-fdv', 'integracao-fdv.enviar_pedido')).toBe(true);
    expect(trabalhoDoModulo('pedido', 'cadastros.consultar_ie')).toBe(false);
    expect(trabalhoDoModulo('cadastros', 'cadastros.Consultar-IE')).toBe(false);
    expect(trabalhoDoModulo('compras', 'compras.cotar')).toBe(false);
  });
});

describe('auditar() (RF-CORE-05)', () => {
  it('grava sem segredo: senha, token e certificado viram "[omitido]" em qualquer nível', async () => {
    const destino = new AuditoriaMemoria();
    const r = await auditar(
      destino,
      tx,
      { tenant_id: TENANT, usuario_id: USUARIO, request_id: 'r1' },
      { acao: 'core.certificado.gerir', entidade: 'certificado', entidade_id: USUARIO, depois: { titular: 'X', senha: 's3', arquivo: { pfx_cifrado: 'abc' }, senha_hash: 'h' } },
      INSTANTE,
    );
    expect(destino.registros).toHaveLength(1);
    expect(r.depois).toEqual({ titular: 'X', senha: OMITIDO, arquivo: { pfx_cifrado: OMITIDO }, senha_hash: OMITIDO });
    expect(r.antes).toBeNull();
    expect(r.ocorrido_em).toEqual(INSTANTE);
  });
});

describe('arquivos (prefixo macuxierp/<tenant>)', () => {
  it('monta a chave com o prefixo e recusa fuga de pasta', () => {
    expect(chaveArquivo(TENANT, 'exportacoes', 'a.zip')).toBe(`macuxierp/${TENANT}/exportacoes/a.zip`);
    expect(() => chaveArquivo('outro', 'a')).toThrow(/UUID/);
    expect(() => chaveArquivo(TENANT, '..', 'a')).toThrow(/inválida/);
    expect(() => chaveArquivo(TENANT, 'a/b')).toThrow(/inválida/);
    expect(() => chaveArquivo(TENANT)).toThrow();
  });

  it('RN-FAT-03: grava o conteúdo antes do catálogo; imutável regravado igual é idempotente, diferente é 409', async () => {
    const armazenamento = new ArmazenamentoMemoria();
    const ordem: string[] = [];
    const catalogo = {
      inserir: async (_tx: unknown, r: RegistroArquivo) => {
        ordem.push(`catalogo:${armazenamento.objetos.has(r.chave_s3)}`);
      },
    };
    const base = { armazenamento, catalogo, tx, tenantId: TENANT, partes: ['nfe', 'x.xml'], tipo: 'application/xml', imutavel: true, guardaAnos: 5, agora: INSTANTE };
    const corpo = new TextEncoder().encode('<nfe/>');
    const r = await guardarArquivo({ ...base, corpo });
    expect(ordem).toEqual(['catalogo:true']);
    expect(r.sha256).toHaveLength(64);
    expect(r.guarda_ate?.toISOString()).toBe('2031-11-21T15:00:00.000Z');
    await expect(guardarArquivo({ ...base, corpo })).resolves.toMatchObject({ sha256: r.sha256 });
    await expect(guardarArquivo({ ...base, corpo: new TextEncoder().encode('<outra/>') })).rejects.toMatchObject({ status: 409 });
  });
});

describe('erros e plugins de módulo', () => {
  it('422 exige código de RN', () => {
    expect(erros.regra('RN-CAD-01', 'CNPJ inválido')).toMatchObject({ status: 422, codigo: 'RN-CAD-01' });
    expect(() => erros.regra('CNPJ', 'x')).toThrow(RangeError);
    expect(erros.moduloInativo('pedido')).toBeInstanceOf(ErroApi);
  });

  it('plugin recusa ação de outro módulo, caminho sem barra e rota repetida', () => {
    const manifesto = defineModule({ id: 'cadastros', versao: '0.1.0', descricao: 'x', depende: ['core'], perfis: [], publica: [], consome: [] });
    const rota = definirRota({ metodo: 'GET', caminho: '/clientes', acao: 'cadastros.ver', executar: async () => ({}) });
    expect(definirPlugin(manifesto, [rota]).rotas).toHaveLength(1);
    expect(() => definirPlugin(manifesto, [{ ...rota, acao: 'core.empresa.ver' }])).toThrow(PluginInvalido);
    expect(() => definirPlugin(manifesto, [{ ...rota, caminho: 'clientes' }])).toThrow(/sem "\/"/);
    expect(() => definirPlugin(manifesto, [rota, rota])).toThrow(/repetida/);
  });
});

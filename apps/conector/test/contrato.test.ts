/**
 * ADR 0014 §6 item 2: `src/contrato.ts` é o adaptador único de tipos até a troca para `@macuxierp/platform-sdk/hub-v1`. Este teste
 * trava, desde já, o que o SDK já publica (`ENTIDADES_ENVIO_FDV`, `LIMITE_REGISTROS_LOTE_FDV`) e o formato da /entrada/v1.
 */
import { ENTIDADES_ENVIO_FDV, LIMITE_REGISTROS_LOTE_FDV } from '@macuxierp/platform-sdk';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { interpretarConfig } from '../src/config/carregar';
import { ENTIDADES, LIMITE_REGISTROS_LOTE, ORDEM_CARGA_ENTIDADES, PedidoParaErp, SCHEMA_REGISTRO, SinalConector } from '../src/contrato';

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? arquivos(join(dir, n)) : [join(dir, n)]));
}

describe('ADR 0014 §6: contrato local alinhado ao SDK', () => {
  it('as entidades são os 10 cadastros da F2 do SDK, na mesma ordem de carga', () => {
    expect([...ENTIDADES]).toEqual([...ENTIDADES_ENVIO_FDV]);
    expect(ORDEM_CARGA_ENTIDADES).toBe(ENTIDADES);
    expect(Object.keys(SCHEMA_REGISTRO)).toEqual([...ENTIDADES_ENVIO_FDV]);
  });

  it('o limite de registros por lote é o do SDK', () => {
    expect(LIMITE_REGISTROS_LOTE).toBe(LIMITE_REGISTROS_LOTE_FDV);
  });

  it('todo import de tipos do Conector vem só do adaptador (nenhum @macuxi/integracao)', () => {
    const raiz = join(__dirname, '..');
    for (const f of [...arquivos(join(raiz, 'src')), ...arquivos(join(raiz, 'test'))].filter((x) => /\.(ts|mjs)$/.test(x))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/from '@macuxi\/integracao/);
    }
  });

  it('registro do lote exige alterado_em e os campos obrigatórios do cadastro do ERP; quantidade é número e dinheiro é centavo inteiro', () => {
    const ok = { external_id: 'E1', alterado_em: '2026-03-01T10:00:00.000Z', ativo: true, deposito_external_id: 'D1', produto_external_id: 'P1', saldo: 1.5, filial_external_id: 'F1' };
    expect(SCHEMA_REGISTRO.estoque.safeParse(ok).success).toBe(true);
    expect(SCHEMA_REGISTRO.estoque.safeParse({ ...ok, alterado_em: undefined }).success).toBe(false);
    expect(SCHEMA_REGISTRO.estoque.safeParse({ ...ok, saldo: '1.5' }).success).toBe(false);
    const preco = { external_id: 'R1', alterado_em: ok.alterado_em, ativo: true, tabela_external_id: 'T1', tabela_nome: 'Varejo', vigencia_inicio: '2026-01-01', produto_external_id: 'P1', preco_cents: 1999 };
    expect(SCHEMA_REGISTRO.preco.safeParse(preco).success).toBe(true);
    expect(SCHEMA_REGISTRO.preco.safeParse({ ...preco, preco_cents: 19.99 }).success).toBe(false);
  });

  it('entidade fora da F2 (ex.: titulo, rota) é recusada no conector.json com a lista da /entrada/v1', () => {
    const json = JSON.stringify({
      hub: { url: 'https://erp.exemplo.com.br', conectorId: 'cnx-1' },
      erp: { tipo: 'postgres', host: 'h', banco: 'b', usuario: 'u' },
      entidades: { titulo: { consulta: 'SELECT :cursor_alterado_em, :cursor_external_id, :limite', campos: { external_id: 'a', alterado_em: 'b' } } },
    });
    expect(() => interpretarConfig(json, 'json')).toThrow(/entidade "titulo" não existe na \/entrada\/v1 do Macuxi ERP \(use: filial, vendedor/);
  });

  it('pedido: padrões de tentativa e descontos; UF do endereço de entrega em maiúsculas', () => {
    const p = PedidoParaErp.parse({
      versao_contrato: 'v1', pedido_uuid: '6f1c2f3a-1b2c-4d3e-8f4a-5b6c7d8e9f01', cliente_external_id: 'c1', vendedor_external_id: 'v1',
      criado_em: '2026-03-10T11:00:00Z', aprovado_em: '2026-03-10T11:30:00Z', total_cents: 1000,
      endereco_entrega: { logradouro: 'Rua A', uf: 'rr' },
      itens: [{ sequencia: 1, produto_external_id: 'p1', quantidade: 1, preco_unitario_cents: 1000, total_cents: 1000 }],
    });
    expect(p).toMatchObject({ tentativa: 1, desconto_total_cents: 0, endereco_entrega: { uf: 'RR' }, itens: [{ desconto_cents: 0 }] });
  });

  it('sinal: a fase vai como o texto do status do Conector ("carga completa", "delta", "ainda não iniciada")', () => {
    const s = { versao_contrato: 'v1', conector_id: 'cnx-1', versao_conector: '1.0.0', em: '2026-03-10T12:00:00.000Z', fila: [], entidades: [{ entidade: 'cliente', fase: 'carga completa', ultimo_sucesso: null, bloqueada: false, lotes_na_fila: 0 }] };
    expect(SinalConector.safeParse(s).success).toBe(true);
  });
});

/**
 * ADR 0014 §6 (kit do ERP): o `exemplos/conector.thathyany.exemplo.json` sai do `kit-thathyany/conector/conector.json` do FDV
 * (aloirr/macuxifdv@c460e92) com os 10 cadastros da F2 e os pedidos, apontando para a /entrada/v1 do Macuxi ERP, com o
 * `conectorId` do ERP, sem reconciliação e com a atualização automática desligada. É o arquivo que o pacote Linux instala.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { interpretarConfig } from '../src/config/carregar';
import { ORDEM_CARGA } from '../src/config/entidades';

const texto = readFileSync(join(__dirname, '..', 'exemplos', 'conector.thathyany.exemplo.json'), 'utf8');

describe('ADR 0014 §6: conector.json do kit thathyany no Macuxi ERP', () => {
  it('valida no esquema, aponta para a /entrada/v1 do ERP com o conectorId do ERP e não tem chave nem senha', () => {
    const cfg = interpretarConfig(texto, 'json');
    expect(cfg.hub).toMatchObject({ url: 'https://erp.macuxifdv.com.br', prefixo: '/entrada/v1', conectorId: 'thathyany-erp' });
    expect(texto).not.toContain('thathyany-conector');
    expect(cfg.erp).toMatchObject({ tipo: 'sqlserver', host: '127.0.0.1', banco: 'ERP_THATHYANY', usuario: 'macuxi_conector' });
    expect(cfg.segredos.provedor).toBe('env');
    expect(cfg.dadosDir).toBe('/var/lib/macuxi-conector/dados');
    expect(texto).not.toMatch(/mxc_|"(chave|senha|password|token)"/i);
  });

  it('RN-INT-04: os 10 cadastros da F2, na ordem de carga, lendo as views dbo.vw_macuxi_<entidade>', () => {
    const cfg = interpretarConfig(texto, 'json');
    expect(Object.keys(cfg.entidades)).toEqual([...ORDEM_CARGA]);
    for (const e of ORDEM_CARGA) expect(cfg.entidades[e]?.consulta, e).toContain(` FROM dbo.vw_macuxi_${e} WHERE `);
  });

  it('ADR 0014 §6: sem reconciliação (nem a hora) e com a atualização automática desligada', () => {
    const cfg = interpretarConfig(texto, 'json');
    expect(texto).not.toContain('reconciliacao');
    expect(cfg.atualizacao?.ativa).toBe(false);
    for (const e of Object.values(cfg.entidades)) expect(e.reconciliacao).toBeUndefined();
  });

  it('RN-INT-08: a gravação de pedidos e o status do kit seguem ligados', () => {
    const cfg = interpretarConfig(texto, 'json');
    expect(cfg.pedidos?.ativo).toBe(true);
    expect(cfg.pedidos?.gravacao.cabecalho).toContain('sp_macuxi_pedido_inserir');
    expect(cfg.pedidos?.status.consulta).toContain('vw_macuxi_pedido_status');
  });
});

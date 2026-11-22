/**
 * T-0012: trava de segurança do alvo e perfis do alvo real (decisões do Alexandre, 21/11/2026 23h10 e 23h12 de Manaus).
 * Sem rede: só a leitura das variáveis de ambiente e do arquivo da massa do kit (gerado aqui, fictício, fora do
 * repositório). A chave usada aqui é gerada na hora (formato `mxc_`), nunca uma chave de verdade.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CENARIOS_PEDIDOS,
  CENARIOS_SEGUROS,
  CENARIOS_SINTETICOS,
  cenarioPermitido,
  ErroConfigHub,
  exigirCenario,
  lerConfigHub,
  URL_HUB_PADRAO,
  type ConfigHub,
} from './apoio/config';
import { ORDEM_DO_ERP } from './apoio/contrato-hub';
import { gerarChaveConector } from './apoio/duble-hub';
import { RAIZ_REPOSITORIO } from './apoio/massa-kit';
import { massaKitFicticia } from './apoio/massa';

const CHAVE = gerarChaveConector();
/** Chave (fictícia) do perfil thathyany-seguro: outra variável e outro valor. */
const CHAVE_THATHYANY = gerarChaveConector();
const REAL = {
  MACUXI_HUB_ALVO: 'real',
  MACUXI_HUB_PERFIL: 'tenant-teste',
  MACUXI_HUB_CHAVE_TENANT_TESTE: CHAVE,
  MACUXI_HUB_CONECTOR_ID_TENANT_TESTE: 'macuxierp-teste',
  MACUXI_HUB_TENANT: 'distribuidora-teste',
  MACUXI_HUB_TENANT_TESTE: '1',
};

/** Lê e devolve a mensagem da recusa, conferindo que ela nunca traz nenhuma das chaves. */
function recusa(env: Record<string, string | undefined>): string {
  try {
    lerConfigHub(env);
  } catch (e) {
    expect(e).toBeInstanceOf(ErroConfigHub);
    const msg = (e as Error).message;
    expect(msg.includes(CHAVE) || msg.includes(CHAVE_THATHYANY)).toBe(false);
    return msg;
  }
  throw new Error('a configuração deveria ter sido recusada');
}

describe('T-0012 — configuração do alvo e trava do tenant real', () => {
  it('sem variável nenhuma, o alvo é o dublê, com carga completa, o adaptador conector e User-Agent macuxierp/dev', () => {
    expect(lerConfigHub({})).toEqual({
      alvo: 'duble',
      modoCarga: 'completo',
      versaoErp: 'dev',
      ladoErp: 'conector',
    });
  });

  it('alvo desconhecido é recusado', () => {
    expect(recusa({ MACUXI_HUB_ALVO: 'producao' })).toMatch(/duble.*real/);
  });

  it('alvo real completo: URL padrão do Hub, delta por padrão e a versão do ERP do ambiente', () => {
    const c = lerConfigHub({ ...REAL, MACUXIERP_VERSAO: '0.1.0' });
    expect(c).toMatchObject({
      alvo: 'real',
      perfil: 'tenant-teste',
      url: URL_HUB_PADRAO,
      tenant: 'distribuidora-teste',
      modoCarga: 'delta',
      versaoErp: '0.1.0',
      entidades: ORDEM_DO_ERP,
    });
  });

  it('a chave não sai em JSON, toString nem inspect da configuração', () => {
    const c = lerConfigHub(REAL);
    expect(JSON.stringify(c)).not.toContain(CHAVE);
    expect(String(c.alvo === 'real' && c.credencial)).not.toContain(CHAVE);
    expect(inspect(c, { depth: 5 })).not.toContain(CHAVE);
    expect(c.alvo === 'real' && c.credencial.autorizacao()).toBe(`Bearer ${CHAVE}`);
  });

  it('recusa URL sem https, com localhost/IP, com credencial embutida ou fora de /integracao/v1', () => {
    expect(recusa({ ...REAL, MACUXI_HUB_URL: 'http://api.macuxifdv.com.br/integracao/v1' })).toMatch(/https/);
    expect(recusa({ ...REAL, MACUXI_HUB_URL: 'https://127.0.0.1/integracao/v1' })).toMatch(
      /localhost nem IP/,
    );
    expect(recusa({ ...REAL, MACUXI_HUB_URL: 'https://localhost/integracao/v1' })).toMatch(
      /localhost nem IP/,
    );
    expect(recusa({ ...REAL, MACUXI_HUB_URL: 'https://u:s@api.macuxifdv.com.br/integracao/v1' })).toMatch(
      /usuário/,
    );
    expect(recusa({ ...REAL, MACUXI_HUB_URL: 'https://api.macuxifdv.com.br/v1' })).toMatch(/integracao\/v1/);
    expect(recusa({ ...REAL, MACUXI_HUB_URL: 'não é url' })).toMatch(/URL válida/);
  });

  it('recusa sem a chave do perfil ou com ela fora do formato, sem exibir o valor', () => {
    expect(recusa({ ...REAL, MACUXI_HUB_CHAVE_TENANT_TESTE: undefined })).toMatch(
      /MACUXI_HUB_CHAVE_TENANT_TESTE ausente/,
    );
    expect(recusa({ ...REAL, MACUXI_HUB_CHAVE_TENANT_TESTE: `${CHAVE}x` })).toMatch(/valor não exibido/);
  });

  it('alvo real: MACUXI_HUB_PERFIL é obrigatória, sem padrão', () => {
    expect(recusa({ ...REAL, MACUXI_HUB_PERFIL: undefined })).toMatch(/PERFIL é obrigatória no alvo real/);
    expect(recusa({ ...REAL, MACUXI_HUB_PERFIL: ' ' })).toMatch(/PERFIL é obrigatória no alvo real/);
  });

  it('alvo real: a chave e o Conector genéricos (MACUXI_HUB_CHAVE, MACUXI_HUB_CONECTOR_ID) não valem mais', () => {
    expect(recusa({ ...REAL, MACUXI_HUB_CHAVE: CHAVE })).toMatch(
      /MACUXI_HUB_CHAVE não vale no alvo real: use as variáveis do perfil \(MACUXI_HUB_CHAVE_TENANT_TESTE/,
    );
    expect(recusa({ ...REAL, MACUXI_HUB_CONECTOR_ID: 'macuxierp-teste' })).toMatch(
      /MACUXI_HUB_CONECTOR_ID não vale no alvo real/,
    );
  });

  it('recusa sem o Conector do perfil, sem a confirmação de tenant de teste ou sem o nome do tenant', () => {
    expect(recusa({ ...REAL, MACUXI_HUB_CONECTOR_ID_TENANT_TESTE: '' })).toMatch(
      /MACUXI_HUB_CONECTOR_ID_TENANT_TESTE ausente/,
    );
    expect(recusa({ ...REAL, MACUXI_HUB_TENANT_TESTE: undefined })).toMatch(
      /TENANT_TESTE=1 é obrigatório no perfil tenant-teste/,
    );
    expect(recusa({ ...REAL, MACUXI_HUB_TENANT_TESTE: 'sim' })).toMatch(/TENANT_TESTE=1/);
    expect(recusa({ ...REAL, MACUXI_HUB_TENANT: ' ' })).toMatch(/MACUXI_HUB_TENANT ausente/);
  });

  it('perfil tenant-teste: nunca o tenant da thathyany, em qualquer grafia, no tenant, no Conector ou na URL', () => {
    for (const env of [
      { ...REAL, MACUXI_HUB_TENANT: 'Thathyany' },
      { ...REAL, MACUXI_HUB_TENANT: 'distribuidora-THÁTHYANY-prod' },
      { ...REAL, MACUXI_HUB_CONECTOR_ID_TENANT_TESTE: 'erp-thathyany' },
      { ...REAL, MACUXI_HUB_URL: 'https://thathyany.macuxifdv.com.br/integracao/v1' },
    ]) {
      expect(recusa(env)).toMatch(/tenant-teste nunca vai ao tenant da thathyany/);
    }
  });

  it('perfil tenant-teste: recusa a chave com o mesmo valor da chave da thathyany (quem decide o tenant é a chave)', () => {
    expect(recusa({ ...REAL, MACUXI_HUB_CHAVE_THATHYANY: CHAVE })).toMatch(
      /chave do tenant-teste é a mesma da thathyany/,
    );
  });

  it('perfil tenant-teste: recusa o Conector igual ao da thathyany', () => {
    expect(recusa({ ...REAL, MACUXI_HUB_CONECTOR_ID_THATHYANY: 'macuxierp-teste' })).toMatch(
      /Conector do tenant-teste é o mesmo da thathyany/,
    );
  });

  it('perfil tenant-teste: recusa qualquer variável da thathyany no ambiente, mesmo com outro valor ou vazia', () => {
    for (const [nome, valor] of [
      ['MACUXI_HUB_CHAVE_THATHYANY', CHAVE_THATHYANY],
      ['MACUXI_HUB_CHAVE_THATHYANY', ''],
      ['MACUXI_HUB_CONECTOR_ID_THATHYANY', 'macuxierp'],
      ['MACUXI_HUB_OUTRA_THATHYANY', 'x'],
    ] as const) {
      expect(recusa({ ...REAL, [nome]: valor })).toMatch(
        new RegExp(`variável da thathyany no ambiente \\(${nome}\\)`),
      );
    }
  });

  it('lado ERP: conector por padrão, emissor-minimo a pedido, outro valor recusado', () => {
    expect(lerConfigHub({ ...REAL, MACUXI_HUB_LADO_ERP: 'emissor-minimo' }).ladoErp).toBe('emissor-minimo');
    expect(lerConfigHub(REAL).ladoErp).toBe('conector');
    expect(recusa({ MACUXI_HUB_LADO_ERP: 'worker' })).toMatch(/conector.*emissor-minimo/);
  });

  it('modo de carga inválido é recusado nos dois alvos', () => {
    expect(recusa({ MACUXI_HUB_MODO_CARGA: 'tudo' })).toMatch(/completo.*delta/);
    expect(recusa({ ...REAL, MACUXI_HUB_MODO_CARGA: 'tudo' })).toMatch(/completo.*delta/);
    expect(lerConfigHub({ ...REAL, MACUXI_HUB_MODO_CARGA: 'completo' }).modoCarga).toBe('completo');
  });
});

describe('T-0012 — perfis do alvo real: tenant-teste e thathyany-seguro (decisão de 23h12)', () => {
  let pasta: string;
  let massaOk: string;
  const arquivo = (nome: string, conteudo: unknown) => {
    const p = join(pasta, nome);
    writeFileSync(p, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
    return p;
  };
  const kit = massaKitFicticia(new Date('2026-11-01T12:00:00.000Z'), 3);
  const SEGURO = () => ({
    MACUXI_HUB_ALVO: 'real',
    MACUXI_HUB_PERFIL: 'thathyany-seguro',
    MACUXI_HUB_CHAVE_THATHYANY: CHAVE_THATHYANY,
    MACUXI_HUB_CONECTOR_ID_THATHYANY: 'macuxierp',
    MACUXI_HUB_TENANT: 'Thathyany',
    MACUXI_HUB_RECEBE_PEDIDOS: '0',
    MACUXI_HUB_MASSA_KIT: massaOk,
    MACUXI_HUB_ENTIDADES: 'prazo_pagamento,forma_pagamento',
  });

  beforeAll(() => {
    pasta = mkdtempSync(join(tmpdir(), 't0012-config-'));
    massaOk = arquivo('kit.json', kit);
  });
  afterAll(() => rmSync(pasta, { recursive: true, force: true }));

  it('perfil desconhecido é recusado; o tenant-teste leva as entidades na ordem do Hub', () => {
    expect(recusa({ ...REAL, MACUXI_HUB_PERFIL: 'producao' })).toMatch(/tenant-teste.*thathyany-seguro/);
    expect(lerConfigHub(REAL)).toMatchObject({ perfil: 'tenant-teste' });
    expect(lerConfigHub({ ...REAL, MACUXI_HUB_ENTIDADES: 'cliente, filial' })).toMatchObject({
      entidades: ['filial', 'cliente'],
    });
  });

  it('thathyany-seguro com tudo certo: delta, lote de 50, sem pedidos, entidades na ordem do Hub e a massa do kit', () => {
    const c = lerConfigHub(SEGURO());
    expect(c).toMatchObject({
      alvo: 'real',
      perfil: 'thathyany-seguro',
      modoCarga: 'delta',
      limiteLote: 50,
      recebePedidos: false,
      entidades: ['forma_pagamento', 'prazo_pagamento'],
      tenant: 'Thathyany',
      ladoErp: 'conector',
    });
    if (c.alvo !== 'real' || c.perfil !== 'thathyany-seguro') throw new Error('perfil errado');
    expect(c.credencial.conectorId).toBe('macuxierp');
    expect(c.credencial.confere(`Bearer ${CHAVE_THATHYANY}`)).toBe(true);
    expect(c.massaKit.registros.forma_pagamento).toEqual(kit.registros.forma_pagamento);
    expect(c.massaKit.fonte).toBe('kit');
    expect(
      lerConfigHub({
        ...SEGURO(),
        MACUXI_HUB_LIMITE_LOTE: '100',
        MACUXI_HUB_TENANT: 'Distribuidora THÁTHYANY',
      }),
    ).toMatchObject({ limiteLote: 100 });
    expect(lerConfigHub({ ...SEGURO(), MACUXI_HUB_LIMITE_LOTE: '1' })).toMatchObject({ limiteLote: 1 });
  });

  it('thathyany-seguro: a configuração impressa traz a massa do kit só como contagem', () => {
    const json = JSON.stringify(lerConfigHub(SEGURO()));
    expect(json).not.toContain('Forma Ficticia');
    expect((JSON.parse(json) as { massaKit: { registros: unknown } }).massaKit.registros).toEqual({
      forma_pagamento: 3,
      prazo_pagamento: 4,
    });
  });

  it('thathyany-seguro: só o lado conector (o código do ERP); o emissor-minimo do arnês é recusado', () => {
    expect(lerConfigHub({ ...SEGURO(), MACUXI_HUB_LADO_ERP: 'conector' }).ladoErp).toBe('conector');
    expect(recusa({ ...SEGURO(), MACUXI_HUB_LADO_ERP: 'emissor-minimo' })).toMatch(
      /só usa o lado conector.*emissor-minimo do arnês é recusado/,
    );
  });

  it('thathyany-seguro: a credencial vem só das variáveis da thathyany (nem a genérica nem a do tenant-teste)', () => {
    expect(recusa({ ...SEGURO(), MACUXI_HUB_CHAVE_THATHYANY: undefined })).toMatch(
      /MACUXI_HUB_CHAVE_THATHYANY ausente/,
    );
    expect(
      recusa({
        ...SEGURO(),
        MACUXI_HUB_CHAVE_THATHYANY: undefined,
        MACUXI_HUB_CHAVE_TENANT_TESTE: CHAVE,
      }),
    ).toMatch(/MACUXI_HUB_CHAVE_THATHYANY ausente/);
    expect(recusa({ ...SEGURO(), MACUXI_HUB_CONECTOR_ID_THATHYANY: undefined })).toMatch(
      /MACUXI_HUB_CONECTOR_ID_THATHYANY ausente/,
    );
    expect(recusa({ ...SEGURO(), MACUXI_HUB_CHAVE: CHAVE_THATHYANY })).toMatch(
      /MACUXI_HUB_CHAVE não vale no alvo real: use as variáveis do perfil \(MACUXI_HUB_CHAVE_THATHYANY/,
    );
  });

  it('thathyany-seguro só para a thathyany, sem a confirmação de tenant de teste e com o Conector sem "recebe pedidos"', () => {
    expect(recusa({ ...SEGURO(), MACUXI_HUB_TENANT: 'distribuidora-teste' })).toMatch(
      /só para o tenant da thathyany/,
    );
    expect(recusa({ ...SEGURO(), MACUXI_HUB_TENANT_TESTE: '1' })).toMatch(
      /contradiz o perfil thathyany-seguro/,
    );
    expect(recusa({ ...SEGURO(), MACUXI_HUB_RECEBE_PEDIDOS: undefined })).toMatch(
      /RECEBE_PEDIDOS=0 é obrigatório/,
    );
    expect(recusa({ ...SEGURO(), MACUXI_HUB_RECEBE_PEDIDOS: '1' })).toMatch(/sem "recebe pedidos"/);
  });

  it('thathyany-seguro: só delta (a carga completa poderia inativar no FDV o que não veio)', () => {
    expect(recusa({ ...SEGURO(), MACUXI_HUB_MODO_CARGA: 'completo' })).toMatch(/só envia delta/);
    expect(lerConfigHub({ ...SEGURO(), MACUXI_HUB_MODO_CARGA: 'delta' }).modoCarga).toBe('delta');
  });

  it('thathyany-seguro: entidades obrigatórias, só as que o ERP alimenta, sem repetir', () => {
    expect(recusa({ ...SEGURO(), MACUXI_HUB_ENTIDADES: undefined })).toMatch(/ENTIDADES é obrigatória/);
    expect(recusa({ ...SEGURO(), MACUXI_HUB_ENTIDADES: 'forma_pagamento,pedido' })).toMatch(
      /não é entidade que o ERP alimenta/,
    );
    expect(recusa({ ...SEGURO(), MACUXI_HUB_ENTIDADES: 'nota' })).toMatch(
      /não é entidade que o ERP alimenta/,
    );
    expect(recusa({ ...SEGURO(), MACUXI_HUB_ENTIDADES: 'forma_pagamento,forma_pagamento' })).toMatch(
      /repete/,
    );
  });

  it('thathyany-seguro: lote pequeno, de 1 a 100', () => {
    for (const v of ['0', '101', '5000', 'abc', '5.5', '-1'])
      expect(recusa({ ...SEGURO(), MACUXI_HUB_LIMITE_LOTE: v })).toMatch(
        /LIMITE_LOTE deve ser um inteiro de 1 a 100/,
      );
  });

  it('thathyany-seguro: massa só do arquivo do kit, fora do repositório; nada sintético nem inventado', () => {
    expect(recusa({ ...SEGURO(), MACUXI_HUB_MASSA_KIT: undefined })).toMatch(/MASSA_KIT ausente/);
    expect(
      recusa({ ...SEGURO(), MACUXI_HUB_MASSA_KIT: join(RAIZ_REPOSITORIO, 'tests', 'kit.json') }),
    ).toMatch(/dentro do repositório/);
    expect(recusa({ ...SEGURO(), MACUXI_HUB_MASSA_KIT: join(pasta, 'kit.csv') })).toMatch(/\.json/);
    expect(recusa({ ...SEGURO(), MACUXI_HUB_MASSA_KIT: join(pasta, 'nao-existe.json') })).toMatch(
      /arquivo legível/,
    );
    const quebrado = recusa({
      ...SEGURO(),
      MACUXI_HUB_MASSA_KIT: arquivo(
        'quebrado.json',
        '{"fonte": "kit", "registros": {"forma_pagamento": [{"nome": "Valor Secreto"',
      ),
    });
    expect(quebrado).toMatch(/JSON válido/);
    expect(quebrado).not.toContain('Valor Secreto');
    expect(
      recusa({
        ...SEGURO(),
        MACUXI_HUB_MASSA_KIT: arquivo('sintetica.json', { ...kit, fonte: 'sintetica' }),
      }),
    ).toMatch(/"fonte" deve ser "kit" ou "T-0026"/);
    expect(
      recusa({
        ...SEGURO(),
        MACUXI_HUB_MASSA_KIT: arquivo('so-formas.json', {
          fonte: 'T-0026',
          registros: { forma_pagamento: kit.registros.forma_pagamento },
        }),
      }),
    ).toMatch(/não tem registros de: prazo_pagamento/);
  });

  it('thathyany-seguro: registro do kit sem external_id, sem alterado_em UTC ou repetido é recusado, sem citar valor', () => {
    const [f1, f2] = kit.registros.forma_pagamento!;
    const casos: [unknown[], RegExp][] = [
      [[{ ...f1, external_id: undefined }], /forma_pagamento\[0\] sem external_id/],
      [[f1, { ...f2, alterado_em: '2026-11-01 12:00' }], /forma_pagamento\[1\] sem alterado_em UTC/],
      [[f1, { ...f2, external_id: f1!.external_id }], /forma_pagamento\[1\] repete um external_id/],
    ];
    for (const [i, [lista, msg]] of casos.entries()) {
      const p = arquivo(`registro-${i}.json`, {
        fonte: 'kit',
        registros: { forma_pagamento: lista, prazo_pagamento: kit.registros.prazo_pagamento },
      });
      const m = recusa({ ...SEGURO(), MACUXI_HUB_MASSA_KIT: p });
      expect(m).toMatch(msg);
      expect(m).not.toContain('Forma Ficticia');
      expect(m).not.toContain(f1!.external_id);
    }
  });

  it('cenários: thathyany-seguro só roda "carga idêntica" e "reenvio idempotente"; nada de inativação, carga completa, dado novo, ordem quebrada ou Retry-After forçado', () => {
    const seguro = lerConfigHub(SEGURO());
    expect(CENARIOS_SINTETICOS.filter((n) => cenarioPermitido(seguro, n))).toEqual([]);
    expect(CENARIOS_SEGUROS.filter((n) => cenarioPermitido(seguro, n))).toEqual([
      'carga-identica',
      'reenvio-idempotente',
    ]);
    for (const n of [
      'inativacao',
      'carga-completa',
      'dado-novo',
      'ordem-quebrada',
      'retry-after-forcado',
    ] as const) {
      expect(() => exigirCenario(seguro, n)).toThrow(/não roda no perfil thathyany-seguro/);
    }
    expect(() => exigirCenario(seguro, 'carga-identica')).not.toThrow();
  });

  it('cenários: tenant-teste roda os sintéticos e não os do kit; o dublê roda todos', () => {
    const teste = lerConfigHub(REAL);
    const duble: ConfigHub = lerConfigHub({});
    expect(CENARIOS_SINTETICOS.every((n) => cenarioPermitido(teste, n))).toBe(true);
    expect(CENARIOS_SEGUROS.some((n) => cenarioPermitido(teste, n))).toBe(false);
    expect(() => exigirCenario(teste, 'reenvio-idempotente')).toThrow(/perfil tenant-teste/);
    expect([...CENARIOS_SINTETICOS, ...CENARIOS_SEGUROS].every((n) => cenarioPermitido(duble, n))).toBe(true);
  });

  it('T-0017: os cenários de pedidos rodam no dublê e no tenant-teste; o thathyany-seguro (recebe_pedidos=0) recusa todos e cita a T-0027', () => {
    const seguro = lerConfigHub(SEGURO());
    expect(seguro).toMatchObject({ perfil: 'thathyany-seguro', recebePedidos: false });
    expect(CENARIOS_PEDIDOS.filter((n) => cenarioPermitido(seguro, n))).toEqual([]);
    for (const n of CENARIOS_PEDIDOS) {
      expect(() => exigirCenario(seguro, n)).toThrow(ErroConfigHub);
      expect(() => exigirCenario(seguro, n)).toThrow(/MACUXI_HUB_RECEBE_PEDIDOS=0.*T-0027/);
    }
    const teste = lerConfigHub(REAL);
    expect(CENARIOS_PEDIDOS.every((n) => cenarioPermitido(teste, n))).toBe(true);
    expect(() => exigirCenario(teste, 'pedido-caminho-feliz')).not.toThrow();
    expect(CENARIOS_PEDIDOS.every((n) => cenarioPermitido(lerConfigHub({}), n))).toBe(true);
    // e o "recebe pedidos" ligado nunca passa no perfil seguro (a trava da T-0012 continua)
    expect(recusa({ ...SEGURO(), MACUXI_HUB_RECEBE_PEDIDOS: '1' })).toMatch(/MACUXI_HUB_RECEBE_PEDIDOS=0 é obrigatório/);
  });
});

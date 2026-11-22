import { describe, expect, it } from 'vitest';
import { PERFIS } from '@macuxierp/platform-sdk';
import { criarClienteCore, ErroCliente, SenhaUmaVez, type Fetch } from './cliente';
import { paraCsv } from '@macuxierp/platform-sdk/listas';
import { avisoCertificado, botoesVisiveis, COLUNAS_USUARIOS, PAGINAS_CORE, paginasVisiveis, TEXTO_AMBIENTE_HOMOLOGACAO, TEXTO_EXPORTACAO_INDISPONIVEL } from './paginas';

describe('BKO do core: permissões refletidas na UI (a proteção real é da API)', () => {
  it('RN-CORE-02: administrador vê tudo; leitura só a empresa e os perfis; fiscal e faturista veem o ambiente', () => {
    expect(paginasVisiveis('administrador')).toHaveLength(PAGINAS_CORE.length);
    expect(paginasVisiveis('leitura').map((p) => p.id)).toEqual(['empresa', 'perfis']);
    expect(paginasVisiveis('fiscal').map((p) => p.id)).toContain('ambiente');
    expect(paginasVisiveis('faturista').map((p) => p.id)).not.toContain('usuarios');
  });

  it('RN-CORE-08: só o administrador vê o botão de voltar para homologação, com confirmação e só com a filial em produção; não há botão de produção', () => {
    const amb = PAGINAS_CORE.find((p) => p.id === 'ambiente');
    if (!amb) throw new Error('sem página');
    expect(botoesVisiveis('fiscal', amb, 'producao')).toEqual([]);
    expect(botoesVisiveis('administrador', amb, 'homologacao')).toEqual([]);
    expect(botoesVisiveis('administrador', amb)).toEqual([]);
    const botoes = botoesVisiveis('administrador', amb, 'producao');
    expect(botoes).toHaveLength(1);
    expect(botoes[0]).toMatchObject({ id: 'voltar-homologacao', rotulo: 'Voltar para homologação', confirma: true });
    expect(botoes.map((b) => b.rotulo.toLowerCase()).join()).not.toContain('produ');
    expect(TEXTO_AMBIENTE_HOMOLOGACAO).toContain('peça à Macuxi');
  });

  it('T-0040: a página de exportação avisa que o armazenamento ainda não existe', () => {
    const exp = PAGINAS_CORE.find((p) => p.id === 'exportacao');
    expect(exp?.aviso).toBe(TEXTO_EXPORTACAO_INDISPONIVEL);
    expect(PAGINAS_CORE.filter((p) => p.aviso).map((p) => p.id)).toEqual(['exportacao']);
  });

  it('todo perfil conhecido tem ao menos a página da empresa', () => {
    for (const p of PERFIS) expect(paginasVisiveis(p).map((x) => x.id)).toContain('empresa');
  });
});

describe('BKO do core: CSV das colunas do core', () => {
  it('CSV de usuários: cabeçalho das colunas e sim/não', () => {
    const csv = paraCsv(COLUNAS_USUARIOS, [
      { id: 'a', nome: '=SOMA(A1)', email: 'a;b@x.test', perfil: 'leitura', filial_ids: [], ativo: true, external_id: null, ultimo_acesso_em: null, updated_at: '2026-11-21T15:00:00.000Z' },
      { id: 'b', nome: 'Maria "M"', email: 'm@x.test', perfil: 'gerente', filial_ids: [], ativo: false, external_id: null, ultimo_acesso_em: '2026-11-20T10:00:00.000Z', updated_at: '2026-11-21T15:00:00.000Z' },
    ]);
    expect(csv.startsWith('﻿Nome;E-mail;Perfil;Ativo;Último acesso\r\n')).toBe(true);
    expect(csv).toContain(';leitura;sim;');
    expect(csv).toContain(';gerente;não;');
  });

  it('RF-CORE-04: o aviso do A1 aparece a 30 dias ou menos e muda quando vence', () => {
    expect(avisoCertificado({ dias_para_vencer: 31, alerta_vencimento: false })).toBeNull();
    expect(avisoCertificado({ dias_para_vencer: 12, alerta_vencimento: true })).toBe('O certificado vence em 12 dias');
    expect(avisoCertificado({ dias_para_vencer: 1, alerta_vencimento: true })).toBe('O certificado vence em 1 dia');
    expect(avisoCertificado({ dias_para_vencer: -2, alerta_vencimento: true })).toMatch(/vencido/);
  });
});

describe('BKO do core: cliente da API', () => {
  const USUARIO = { id: '11111111-1111-4111-8111-111111111111', nome: 'Maria', email: 'm@x.test', perfil: 'gerente', filial_ids: [], ativo: true, external_id: null, ultimo_acesso_em: null, updated_at: '2026-11-21T15:00:00.000Z' };

  it('RF-CORE-02: envia o token, valida a resposta pelo contrato e a senha provisória é lida uma vez', async () => {
    const vistos: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const fetch: Fetch = async (url, init) => {
      vistos.push({ url, headers: init.headers, body: typeof init.body === 'string' ? init.body : undefined });
      return { status: 201, json: async () => ({ ...USUARIO, senha_provisoria: 'Abcdefgh23456789' }) };
    };
    const api = criarClienteCore({ baseUrl: 'https://erp.exemplo.test', token: () => 'tok', fetch });
    const r = await api.criarUsuario({ nome: 'Maria', email: 'm@x.test', perfil: 'gerente', filial_ids: [USUARIO.id] });
    expect(vistos[0]?.url).toBe('https://erp.exemplo.test/v1/core/usuarios');
    expect(vistos[0]?.headers.Authorization).toBe('Bearer tok');
    const s = new SenhaUmaVez(r.senha_provisoria);
    expect(JSON.stringify({ s })).not.toContain('Abcdefgh');
    expect(s.consumir()).toBe('Abcdefgh23456789');
    expect(s.consumir()).toBeNull();
  });

  it('erro da API vira ErroCliente com o código da RN, sem repetir o corpo enviado', async () => {
    const fetch: Fetch = async () => ({ status: 422, json: async () => ({ codigo: 'RN-CORE-06', mensagem: 'Certificado vencido em 01/11/2026: envie o novo' }) });
    const api = criarClienteCore({ baseUrl: 'https://x.test', token: () => 't', fetch });
    const e = await api.enviarCertificado({ filial_id: USUARIO.id, senha: 'segredo' }, new Blob([new Uint8Array([1, 2, 3])])).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(ErroCliente);
    expect(e).toMatchObject({ status: 422, codigo: 'RN-CORE-06' });
    expect(String((e as Error).message)).not.toContain('segredo');
  });

  it('RF-CORE-04: o certificado vai em multipart, sem Content-Type fixo e sem base64', async () => {
    let visto: { headers: Record<string, string>; body?: string | FormData } | undefined;
    const fetch: Fetch = async (_url, init) => {
      visto = init;
      return { status: 422, json: async () => ({ codigo: 'RN-CORE-06', mensagem: 'x' }) };
    };
    const api = criarClienteCore({ baseUrl: 'https://x.test', token: () => 't', fetch });
    await api.enviarCertificado({ filial_id: USUARIO.id, senha: 'segredo' }, new Blob([new Uint8Array([1, 2, 3])])).catch(() => undefined);
    expect(visto?.body).toBeInstanceOf(FormData);
    expect(visto?.headers['Content-Type']).toBeUndefined();
    const f = visto?.body as FormData;
    expect([...f.keys()].sort()).toEqual(['arquivo', 'filial_id', 'senha']);
  });

  it('DELETE responde 204 sem corpo', async () => {
    const api = criarClienteCore({ baseUrl: 'https://x.test', token: () => 't', fetch: async () => ({ status: 204, json: async () => { throw new Error('sem corpo'); } }) });
    await expect(api.inativarUsuario(USUARIO.id)).resolves.toBeUndefined();
  });
});

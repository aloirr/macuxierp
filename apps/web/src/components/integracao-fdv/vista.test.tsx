import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTIDADES_ENVIO_FDV, StatusIntegracaoFdvTenant, type CadastroIntegracaoFdv } from '@macuxierp/platform-sdk';
import { montarMenu } from '@/lib/menu';
import { MANIFESTOS } from '@/lib/manifestos';
import { montarVistaStatus, textoAlertaFalha } from '@/lib/integracao-fdv';
import { VistaIntegracaoFdv } from './vista';

const estado = vi.hoisted(() => ({ falha: null as unknown, status: null as unknown }));
vi.mock('next/navigation', () => ({ redirect: (d: string) => { throw new Error(`REDIRECT ${d}`); } }));
vi.mock('@/lib/api', async () => {
  class NaoAutenticado extends Error {}
  class SemPermissao extends Error {}
  class ApiIndisponivel extends Error {}
  return { NaoAutenticado, SemPermissao, ApiIndisponivel, getValidado: async (caminho: string) => { if (estado.falha) throw estado.falha; void caminho; return estado.status; } };
});

const cadastros: CadastroIntegracaoFdv[] = ENTIDADES_ENVIO_FDV.map((entidade) => ({
  entidade,
  ligada: entidade === 'produto' || entidade === 'cliente',
  ultimo_envio_em: entidade === 'produto' ? '2026-11-22T14:05:00.000Z' : null,
  falha: entidade === 'cliente' ? { motivo: 'credencial', acao: 'corrigir_credencial' } : entidade === 'produto' ? { motivo: 'erros_por_linha', acao: 'corrigir_cadastros' } : null,
}));
const status = StatusIntegracaoFdvTenant.parse({
  conector_id: 'erp-1', ambiente: 'teste', chave_prefixo: 'abcd1234', cadastros,
  ultimo_sinal: { ultimo_envio_em: '2026-11-22T14:05:00.000Z', ultimo_aceito_em: null, ultimo_http: 200, parado_por_versao: false },
});
const html = () => renderToStaticMarkup(<VistaIntegracaoFdv vista={montarVistaStatus(status, 'America/Manaus')} />);

describe('BKO: status da Integração FDV (T-0056), só leitura', () => {
  it('nenhum botão, formulário, campo nem texto de escrita', () => {
    const h = html();
    expect(h).not.toMatch(/<button|<form|<input|<select/);
    for (const t of ['Salvar', 'Testar conexão', 'Tentar de novo', 'Reenviar tudo', 'password']) expect(h, t).not.toContain(t);
  });
  it('Ligado e Desligado por cadastro, com o último envio no fuso da empresa (10:05 em Manaus)', () => {
    const h = html();
    expect(h).toContain('>Ligado<');
    expect(h).toContain('>Desligado<');
    expect(h).not.toContain('Ligada');
    expect(h).toContain('Produtos');
    expect(h).toMatch(/22\/11\/2026,? 10:05/);
  });
  it('falha com o motivo e a ação; o que só o portal resolve vira "Fale com a Macuxi"', () => {
    const h = html();
    expect(h).toContain('Há registros com erro neste cadastro.');
    expect(h).toContain('Corrija os registros com erro no cadastro de origem.');
    expect(h).toContain('O FDV recusou a chave do conector.');
    expect(h).toContain('Fale com a Macuxi.');
    expect(h.match(/class="falha-sob-nome"/g)).toHaveLength(2); // linha sob o nome, só em tela estreita (CSS)
    expect(h).not.toContain('cadastro(s)');
    expect(h).not.toContain('Bloqueia');
    expect(h).toMatch(/<p class="faixa-aviso" role="status"/);
    expect(h).toContain('2 cadastros não chegaram ao FDV. Veja o motivo na tabela.');
  });
  it('não mostra conector, ambiente nem o começo da chave; sinal em frase inteira; plural do alerta', () => {
    const h = html();
    expect(h).not.toContain('Conector erp-1');
    expect(h).not.toContain('abcd1234');
    expect(h).not.toContain('<dt>Chave</dt>'); // a frase "O FDV recusou a chave do conector." é só o motivo da falha
    expect(h).toMatch(/data-testid="sinal">Último sinal do conector em 22\/11\/2026,? 10:05\.<\/p>/); // frase inteira, sem rótulo (125 B)
    expect(h).not.toContain('Conexão com o FDV:');
    expect(textoAlertaFalha(1)).toBe('1 cadastro não chegou ao FDV. Veja o motivo na tabela.');
  });
  it('sem credencial: uma frase só (selo), sem a tabela de "Desligado — —" (RD-2394)', () => {
    const vazio = StatusIntegracaoFdvTenant.parse({ conector_id: null, ambiente: null, chave_prefixo: null, ultimo_sinal: null, cadastros: cadastros.map((c) => ({ ...c, ligada: false, falha: null })) });
    const h = renderToStaticMarkup(<VistaIntegracaoFdv vista={montarVistaStatus(vazio, 'America/Manaus')} podeVerLog />);
    expect(h).toBe('<p role="status" data-testid="sinal"><span class="selo selo-aviso">Sem conector · fale com a Macuxi</span></p>');
    expect(h).not.toMatch(/<table|Desligado|>Log</);
  });
  it('com conector a tabela volta, com Ligado e Desligado (RD-2394)', () => {
    const h = html();
    expect(h).toContain('<table');
    expect(h).toContain('>Desligado<');
    expect(h).not.toContain('Sem conector');
  });
  it('sem sinal ainda: frase inteira, com maiúscula e sem rótulo', () => {
    const h = renderToStaticMarkup(<VistaIntegracaoFdv vista={montarVistaStatus({ ...status, ultimo_sinal: null }, 'America/Manaus')} />);
    expect(h).toContain('data-testid="sinal">Ainda sem sinal do conector.</p>');
  });
});

describe('BKO: perfil e licença', () => {
  beforeEach(() => { estado.falha = null; estado.status = status; });
  it('menu: só perfis com integracao-fdv.ver e só com o módulo licenciado', () => {
    const com = [{ id: 'integracao-fdv' as const, menus: ['Integração FDV'] }];
    expect(montarMenu(com, MANIFESTOS, 'administrador').map((g) => g.modulo)).toContain('integracao-fdv');
    expect(montarMenu(com, MANIFESTOS, 'faturista').map((g) => g.modulo)).not.toContain('integracao-fdv');
    expect(montarMenu([{ id: 'core' as const, menus: [] }], MANIFESTOS, 'administrador').map((g) => g.modulo)).not.toContain('integracao-fdv');
  });
  it('a API recusa o perfil (403): mensagem fixa, sem dado', async () => {
    const { SemPermissao } = await import('@/lib/api');
    estado.falha = new SemPermissao();
    const { TelaIntegracaoFdv } = await import('@/app/(shell)/[modulo]/[...pagina]/tela-integracao-fdv');
    expect(renderToStaticMarkup(await TelaIntegracaoFdv({ acesso: 't', fuso: 'America/Manaus', perfil: 'administrador' }))).toContain('Seu perfil não pode ver esta tela.');
  });
  it('com acesso: renderiza o status', async () => {
    const { TelaIntegracaoFdv } = await import('@/app/(shell)/[modulo]/[...pagina]/tela-integracao-fdv');
    expect(renderToStaticMarkup(await TelaIntegracaoFdv({ acesso: 't', fuso: 'America/Manaus', perfil: 'administrador' }))).toContain('Cadastros enviados ao Macuxi FDV');
  });
});

describe('BKO: botão Log por cadastro (T-0086, D-4)', () => {
  it('um botão por cadastro com a permissão; nenhum sem ela', () => {
    const com = renderToStaticMarkup(<VistaIntegracaoFdv vista={montarVistaStatus(status, 'America/Manaus')} podeVerLog />);
    expect(com.match(/>Log<\/button>/g)).toHaveLength(ENTIDADES_ENVIO_FDV.length);
    expect(com).not.toMatch(/<th[^>]*>Log</); // a coluna não repete o rótulo do botão
    const sem = renderToStaticMarkup(<VistaIntegracaoFdv vista={montarVistaStatus(status, 'America/Manaus')} podeVerLog={false} />);
    expect(sem).not.toContain('>Log<');
  });
});

describe('v0.3.18 A2: próxima tentativa no BKO', () => {
  const com = (proxima: string | null) =>
    StatusIntegracaoFdvTenant.parse({ ...status, cadastros: cadastros.map((c) => (c.entidade === 'cliente' ? { ...c, proxima_tentativa_em: proxima } : c)) });
  const render = (s: StatusIntegracaoFdvTenant) => renderToStaticMarkup(<VistaIntegracaoFdv vista={montarVistaStatus(s, 'America/Manaus')} />);
  it('mostra a próxima tentativa só quando vier, e nenhum código técnico', () => {
    expect(render(com('2026-11-27T15:30:00.000Z'))).toContain('Próxima tentativa');
    const h = render(com(null));
    expect(h).not.toContain('Próxima tentativa');
    expect(h).not.toContain('<code>');
  });
});

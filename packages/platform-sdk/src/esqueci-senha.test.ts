import { describe, expect, it } from 'vitest';
import { MODELO_HTML_SENHA_TEMPORARIA } from './email-senha-temporaria-html';
import { CODIGO_CONTA_BLOQUEADA, corpoErroApi, erros, MENSAGEM_CONTA_BLOQUEADA, RECUPERAR_CONTA_BLOQUEADA } from './erros';
import {
  CAMINHOS_ESQUECI_SENHA,
  ROTULO_SENHA_TEMPORARIA,
  textoMuitasTentativas,
  emailSenhaTemporaria,
  LIMITES_ESQUECI_SENHA,
  MENSAGEM_ESQUECI_NEUTRA,
  MuitasTentativasResposta,
  PedidoSenhaTemporariaResposta,
  PedirSenhaTemporariaEntrada,
  PedirSenhaTemporariaPlataformaEntrada,
  SenhaATrocarResposta,
  SituacaoEsqueciResposta,
  VALIDADE_SENHA_TEMPORARIA_HORAS,
  ContaBloqueadaResposta,
  URL_MACUXI_ERP,
  ROTA_TELA_LOGIN,
  lerPreenchimentoLogin,
  PreenchimentoLogin,
  urlEntrarPreenchida,
} from './esqueci-senha';
import { CODIGO_TROCAR_SENHA } from './eu';
import { CriarEmpresaEntrada, DETALHE_CODIGO_RESERVADO, MENSAGEM_CODIGO_RESERVADO, SLUG_RESERVADO_SUPERADMIN, SLUGS_RESERVADOS } from './portal-config';

describe('RN-CORE-13: pedido da senha temporária (POST /v1/auth/esqueci e /v1/plataforma/auth/esqueci)', () => {
  it('entrada da tela de login (ADR 0021): só o e-mail normalizado; `empresa` opcional e ignorado', () => {
    expect(PedirSenhaTemporariaEntrada.parse({ email: ' Ana@Exemplo.COM ' })).toEqual({ email: 'ana@exemplo.com' });
    for (const empresa of [' AM2808 ', '   ', 'MACUXI']) expect(PedirSenhaTemporariaEntrada.safeParse({ empresa, email: 'a@b.co' }).success, empresa).toBe(true);
    expect(() => PedirSenhaTemporariaEntrada.parse({ empresa: 'AM2808', email: 'sem-arroba' })).toThrow();
    expect(PedirSenhaTemporariaEntrada.parse({ email: 'a@b.co', senha: 'x' })).not.toHaveProperty('senha');
  });

  it('o código reservado do superadmin não vira empresa: SLUGS_RESERVADOS e o DETAIL do CHECK do banco', () => {
    expect(SLUGS_RESERVADOS).toContain(SLUG_RESERVADO_SUPERADMIN);
    expect(Object.isFrozen(SLUGS_RESERVADOS)).toBe(true);
    for (const slug of ['macuxi', 'MACUXI']) expect(() => CriarEmpresaEntrada.parse({ slug, nome: 'ACME' }), slug).toThrow();
    expect(DETALHE_CODIGO_RESERVADO).toBe('codigo_reservado_superadmin');
    expect(MENSAGEM_CODIGO_RESERVADO).toMatch(/reservado/);
  });

  it('entrada do superadmin: só o e-mail', () => {
    expect(PedirSenhaTemporariaPlataformaEntrada.parse({ email: 'Root@Exemplo.com' })).toEqual({ email: 'root@exemplo.com' });
    expect(() => PedirSenhaTemporariaPlataformaEntrada.parse({})).toThrow();
  });

  it('resposta 202 neutra: o texto travado pelo PO (ADR 0021), sem empresa, tenha ou não a conta', () => {
    expect(MENSAGEM_ESQUECI_NEUTRA).toBe('Se o e-mail estiver cadastrado, enviamos as instruções.');
    expect(PedidoSenhaTemporariaResposta.parse({ mensagem: MENSAGEM_ESQUECI_NEUTRA })).toEqual({ mensagem: MENSAGEM_ESQUECI_NEUTRA });
    expect(() => PedidoSenhaTemporariaResposta.parse({ mensagem: 'Conta não encontrada' })).toThrow();
  });

  it('situação: esqueci_disponivel booleano (false sem os PROD_SMTP_*)', () => {
    expect(SituacaoEsqueciResposta.parse({ esqueci_disponivel: false })).toEqual({ esqueci_disponivel: false });
    expect(() => SituacaoEsqueciResposta.parse({ esqueci_disponivel: 'sim' })).toThrow();
  });

  it('caminhos, validade de 72 h e limite por IP (hotfix v0.3.16.1), congelados', () => {
    expect(CAMINHOS_ESQUECI_SENHA).toEqual({ tenant: '/v1/auth/esqueci', plataforma: '/v1/plataforma/auth/esqueci', situacao: '/v1/auth/esqueci/situacao' });
    expect(VALIDADE_SENHA_TEMPORARIA_HORAS).toBe(72);
    expect(LIMITES_ESQUECI_SENHA).toEqual({ por_ip: { maximo: 20, janela_s: 900 } });
    expect(Object.isFrozen(CAMINHOS_ESQUECI_SENHA)).toBe(true);
    expect(Object.isFrozen(LIMITES_ESQUECI_SENHA.por_ip)).toBe(true);
  });
});

describe('RN-CORE-13: 429 MUITAS_TENTATIVAS com retry_after_s no envelope de erro', () => {
  it('erros.muitasTentativas leva retry_after_s em detalhes e o corpo passa no contrato', () => {
    const corpo = corpoErroApi(erros.muitasTentativas(textoMuitasTentativas(120), 120));
    expect(corpo).toEqual({ codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas tentativas. Tente de novo em 2 minutos.', detalhes: { retry_after_s: 120 } });
    expect(MuitasTentativasResposta.parse(corpo)).toEqual(corpo);
  });

  it('sem retry_after_s segue compatível com o login atual (sem detalhes)', () => {
    expect(corpoErroApi(erros.muitasTentativas('Acesso travado'))).toEqual({ codigo: 'MUITAS_TENTATIVAS', mensagem: 'Acesso travado' });
  });

  it('textoMuitasTentativas: minutos arredondados para cima, 1 minuto no singular', () => {
    expect(textoMuitasTentativas(1)).toBe('Muitas tentativas. Tente de novo em 1 minuto.');
    expect(textoMuitasTentativas(60)).toBe('Muitas tentativas. Tente de novo em 1 minuto.');
    expect(textoMuitasTentativas(61)).toBe('Muitas tentativas. Tente de novo em 2 minutos.');
    expect(textoMuitasTentativas(900)).toBe('Muitas tentativas. Tente de novo em 15 minutos.');
    for (const s of [0, -5, 1.5, Number.NaN]) expect(() => textoMuitasTentativas(s), String(s)).toThrow(RangeError);
  });

  it('retry_after_s é inteiro ≥ 1', () => {
    expect(() => erros.muitasTentativas('x', 0)).toThrow(RangeError);
    expect(() => erros.muitasTentativas('x', 1.5)).toThrow(RangeError);
    expect(() => MuitasTentativasResposta.parse({ codigo: 'MUITAS_TENTATIVAS', mensagem: 'x', detalhes: { retry_after_s: 0 } })).toThrow();
    expect(() => MuitasTentativasResposta.parse({ codigo: 'OUTRO', mensagem: 'x', detalhes: { retry_after_s: 5 } })).toThrow();
  });
});

describe('RN-CORE-13: 403 da troca obrigatória (provisória ou temporária)', () => {
  it('reaproveita CODIGO_TROCAR_SENHA, com motivo e expira_em opcional', () => {
    const base = { codigo: CODIGO_TROCAR_SENHA, mensagem: 'Troque a senha para continuar' };
    expect(SenhaATrocarResposta.parse({ ...base, motivo: 'provisoria' })).toEqual({ ...base, motivo: 'provisoria' });
    const temp = { ...base, motivo: 'temporaria', expira_em: '2026-11-26T14:00:00.000Z' };
    expect(SenhaATrocarResposta.parse(temp)).toEqual(temp);
    expect(() => SenhaATrocarResposta.parse({ ...base, motivo: 'outra' })).toThrow();
    expect(() => SenhaATrocarResposta.parse({ ...temp, expira_em: '26/11/2026' })).toThrow();
    expect(() => SenhaATrocarResposta.parse({ ...base, codigo: 'SENHA_A_TROCAR', motivo: 'provisoria' })).toThrow();
  });
});

describe('RN-CORE-13: rótulo da tela de troca depois do esqueci', () => {
  it('ROTULO_SENHA_TEMPORARIA', () => {
    expect(ROTULO_SENHA_TEMPORARIA).toBe('Senha temporária');
  });
});

describe('RN-CORE-13: e-mail da senha temporária', () => {
  const base = { senha: 'Tmp#2026ab', validade_horas: VALIDADE_SENHA_TEMPORARIA_HORAS, email: 'ana@exemplo.invalid' };

  it('T-0111 e ADR 0021 §6 (RD-2403): os textos do design, sem o código da empresa, em texto e HTML; botão e rodapé', () => {
    const e = emailSenhaTemporaria(base);
    expect(e.assunto).toBe('Sua senha temporária do Macuxi ERP');
    // o docs/design/emails/redefinir-senha/email.txt (#705), sem a linha do código da empresa
    expect(e.texto).toBe(
      [
        'Sua senha temporária',
        '',
        'Recebemos um pedido de senha temporária para entrar no Macuxi ERP. Se não foi você, ignore este e-mail.',
        '',
        'E-mail: ana@exemplo.invalid',
        'Senha temporária: Tmp#2026ab',
        '',
        'Vale por 72 horas e serve para entrar uma vez só. Ela também desbloqueia a conta.',
        '',
        'Abrir o Macuxi ERP: https://erp.macuxifdv.com.br/#email=ana%40exemplo.invalid',
        '',
        '--',
        'Equipe Macuxi ERP · Boa Vista, RR · erp.macuxifdv.com.br',
      ].join('\n'),
    );
    expect(e.html).toContain('<title>Sua senha temporária do Macuxi ERP</title>');
    // o recorte das duas linhas do código tem de achar o modelo do design: se o design mudar, este teste avisa
    expect(MODELO_HTML_SENHA_TEMPORARIA).toContain('{{codigo_empresa}}');
    expect(e.html).not.toContain('Código da empresa');
    expect(e.html).not.toContain('MACUXI');
    expect(e.html).toContain('>ana@exemplo.invalid</td>');
    expect(e.html).toContain('>Tmp#2026ab</td>');
    expect(e.html).toContain(`href="${URL_MACUXI_ERP}/#email=ana%40exemplo.invalid"`);
    expect(e.html).not.toContain('Tmp#2026ab"');
    expect(e.html).not.toMatch(/\{\{/);
    expect(e.texto).not.toMatch(/c[oó]digo/i);
  });

  it('o parâmetro codigo_empresa saiu: o que vier a mais não entra no e-mail', () => {
    const e = emailSenhaTemporaria({ ...base, codigo_empresa: 'MACUXI' } as typeof base);
    expect(e.texto).not.toContain('MACUXI');
    expect(e.html).not.toContain('MACUXI');
  });

  it('T-0111: o modelo HTML (cópia do design #705) tem os placeholders; os campos vão escapados', () => {
    for (const p of ['assunto', 'email', 'senha_temporaria', 'url_entrar']) expect(MODELO_HTML_SENHA_TEMPORARIA).toContain(`{{${p}}}`);
    expect(MODELO_HTML_SENHA_TEMPORARIA.startsWith('<!DOCTYPE html>')).toBe(true);
    const e = emailSenhaTemporaria({ ...base, email: 'a<b>&"\'@x.co', senha: 'x<y' });
    expect(e.html).toContain('a&lt;b&gt;&amp;&quot;&#39;@x.co');
    expect(e.html).toContain('x&lt;y');
    expect(e.html).not.toContain('a<b>');
    expect(e.texto).toContain('Senha temporária: x<y'); // texto puro, sem escape
    expect(emailSenhaTemporaria({ ...base, validade_horas: 48 }).html).toContain('Vale por 48 horas e serve');
  });

  it('recusa senha vazia, validade fora de inteiro ≥ 1 e e-mail vazio', () => {
    expect(() => emailSenhaTemporaria({ ...base, senha: '' })).toThrow(RangeError);
    expect(() => emailSenhaTemporaria({ ...base, senha: '   ' })).toThrow(RangeError);
    expect(() => emailSenhaTemporaria({ ...base, validade_horas: 0 })).toThrow(RangeError);
    expect(() => emailSenhaTemporaria({ ...base, email: '' })).toThrow(RangeError);
    expect(() => emailSenhaTemporaria({ ...base, senha: 'a\nb' })).toThrow(RangeError);
  });
});

describe('RN-CORE-15 (T-0111): 423 CONTA_BLOQUEADA', () => {
  it('o mesmo corpo sempre: código, mensagem e recuperar fixos, sem tempo restante nem contagem', () => {
    const e = erros.contaBloqueada();
    expect(e.status).toBe(423);
    const corpo = corpoErroApi(e);
    expect(ContaBloqueadaResposta.parse(corpo)).toEqual({ codigo: CODIGO_CONTA_BLOQUEADA, mensagem: MENSAGEM_CONTA_BLOQUEADA, detalhes: { recuperar: RECUPERAR_CONTA_BLOQUEADA } });
    expect(JSON.stringify(corpo)).not.toMatch(/\d/);
    expect(ContaBloqueadaResposta.safeParse({ ...corpo, mensagem: 'outra' }).success).toBe(false);
  });
});

describe('44 B e ADR 0021 §6 (RD-2404): o botão abre o login com o e-mail preenchido (fragmento, sem código, token nem senha)', () => {
  it('o link leva só o e-mail no fragmento (#), não na query, e nunca a senha', () => {
    const url = urlEntrarPreenchida('ana+teste@exemplo.invalid');
    expect(url).toBe('https://erp.macuxifdv.com.br/#email=ana%2Bteste%40exemplo.invalid');
    const u = new URL(url);
    expect(u.search).toBe('');
    expect(u.pathname).toBe(ROTA_TELA_LOGIN);
    expect([...new URLSearchParams(u.hash.slice(1)).keys()]).toEqual(['email']);
    const e = emailSenhaTemporaria({ senha: 'Segredo123', validade_horas: 72, email: 'ana@exemplo.invalid' });
    for (const parte of [e.texto, e.html]) expect(parte.match(/https:\/\/\S+/g)!.join(' ')).not.toContain('Segredo123');
  });

  it('ida e volta: lerPreenchimentoLogin devolve só o e-mail do link, normalizado como no login', () => {
    const url = urlEntrarPreenchida('Ana+Teste@Exemplo.invalid');
    expect(lerPreenchimentoLogin(new URL(url).hash)).toEqual({ email: 'ana+teste@exemplo.invalid' });
    expect(lerPreenchimentoLogin(url.slice(url.indexOf('#') + 1))).toEqual({ email: 'ana+teste@exemplo.invalid' });
  });

  it('o inválido fica de fora sem erro; o #codigo de link antigo, a senha e outros campos são ignorados', () => {
    expect(lerPreenchimentoLogin('')).toEqual({});
    expect(lerPreenchimentoLogin('#codigo=AM2808&email=nao-e-email')).toEqual({});
    expect(lerPreenchimentoLogin('#codigo=AM2808&email=ana%40exemplo.invalid')).toEqual({ email: 'ana@exemplo.invalid' });
    expect(lerPreenchimentoLogin('#email=ana%40exemplo.invalid&senha=abc')).toEqual({ email: 'ana@exemplo.invalid' });
    expect(PreenchimentoLogin.keyof().options).toEqual(['email']);
  });
});

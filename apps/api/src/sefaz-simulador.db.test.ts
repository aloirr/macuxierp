/**
 * T-0045 (etapa 4; ADR 0005 e ADR 0008): o A1 DE TESTE (gerado na hora, CNPJ fictício, senha aleatória) entra pelo
 * mesmo caminho do A1 real — `POST /v1/core/certificados` da API do core, LeitorPfxTls e cifra AES-256-GCM com a chave
 * do secret de TESTE — e volta pelo contrato do core (`GET /v1/core/certificados`, `CertificadoResumo`). Com ele, uma
 * NF-e mínima de teste é assinada e autorizada no simulador da SEFAZ-AM, escolhido pelo seletor com o ambiente lido do
 * core (`GET /v1/core/ambientes-fiscais`). E a regra 7 de ponta a ponta: filial em produção (gravada pelo operador,
 * ADR 0006) → `SimuladorEmProducaoErro`, sem o simulador ser chamado.
 * Depois, como o worker fará: o A1 decifrado da filial pelo core (`lerA1DecifradoDaFilial`, papel `macuxierp_worker`,
 * RLS do tenant), aberto pelo leitor do emissor (`abrirA1`), assina a NF-e e o simulador autoriza com 100.
 * Nenhum `.pfx`/`.p12` em disco ou no repositório; nenhum log, resposta ou protocolo traz o PFX, a senha ou a chave.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { inspect } from 'node:util';
import { lerA1DecifradoDaFilial } from '@macuxierp/core/api';
import { CertificadoResumo, ListaAmbientes, ListaCertificados } from '@macuxierp/core/contracts';
import { abrirA1 } from '@macuxierp/nfe-emissor';
import {
  SimuladorEmProducaoErro,
  criarSeletorTransporte,
  montarNfeProc,
  validarXsd,
  verificarAssinaturaNFe,
  type DestinoSimulador,
  type FilialEmissoraSefaz,
} from '@macuxierp/nfe-sefaz';
import { CNPJ_EMITENTE_DE_TESTE, assinarXmlDeTeste, gerarA1DeTeste, montarNFeDeTeste } from '@macuxierp/nfe-sefaz/teste';
import { criarSimuladorSefaz, PREFIXO_NUMERO_SIMULADOR, VER_APLIC_SIMULADOR } from '@macuxierp/sefaz-simulador';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formulario } from './apoio-multipart';
import { appPgDeTeste, inserirAdministradorDeTeste, inserirFilialDeTeste, SENHA_DE_TESTE } from './apoio-teste';

/** Formato exigido pelo CHECK `ambiente_producao_aprovada` (migração 0003): só o operador grava produção. */
const RECADO_APROVACAO = 'R-20261121-120000-alexandre';

describe.skipIf(!PG_DISPONIVEL)('T-0045: A1 de teste pela ADR 0005 e NF-e autorizada no simulador da SEFAZ-AM', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let tenant: string;
  let token: string;
  const usuario = randomUUID();
  const filial = randomUUID();
  const filialProducao = randomUUID();
  /** A "chave do secret" de teste (MACUXIERP_CHAVE_A1 do ambiente de teste). */
  const chaveA1 = randomBytes(32);
  const logs: string[] = [];
  const respostas: string[] = [];
  // Validade padrão do gerador: um ano para cada lado do relógio real (a API e o simulador usam o relógio real aqui).
  const a1 = gerarA1DeTeste({ cnpj: CNPJ_EMITENTE_DE_TESTE });

  beforeAll(async () => {
    b = await criarBancoEfemero();
    tenant = await criarTenant(b.admin, 'am0045', ['faturamento', 'fiscal']);
    await b.admin.query('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [tenant, 'EMPRESA FICTICIA DE TESTE LTDA', CNPJ_EMITENTE_DE_TESTE]);
    await inserirFilialDeTeste(b.admin, tenant, { id: filial, cnpj: CNPJ_EMITENTE_DE_TESTE, nome: 'Matriz Manaus (teste)' });
    await inserirAdministradorDeTeste(b.admin, tenant, { id: usuario, email: 'adm@t0045.teste', nome: 'Administração', filialIds: [filial] });
    // Os módulos do main.ts (LeitorPfxTls, RepositorioCoreSql), com a chave do A1 de teste e o log em memória.
    ({ app } = await appPgDeTeste({
      b,
      modulos: 'producao',
      chaveA1,
      logger: { stream: new Writable({ write: (c, _e, cb) => (logs.push(String(c)), cb()) }) },
    }));
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: (await b.admin.query('SELECT slug FROM plataforma.tenant WHERE id = $1', [tenant])).rows[0].slug, email: 'adm@t0045.teste', senha: SENHA_DE_TESTE } });
    expect(login.statusCode, login.body).toBe(200);
    token = login.json<{ token_acesso: string }>().token_acesso;
  });
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  const autorizacao = () => ({ authorization: `Bearer ${token}` });
  const get = async (url: string) => {
    const r = await app.inject({ url, headers: autorizacao() });
    respostas.push(r.body);
    return r;
  };

  /** A filial emissora como o faturamento vai montar: ambiente lido do contrato do core, UF do cadastro. */
  const filialEmissora = async (filial_id: string): Promise<FilialEmissoraSefaz> => {
    const r = await get(`/v1/core/ambientes-fiscais?filial_id=${filial_id}`);
    expect(r.statusCode, r.body).toBe(200);
    const [amb] = ListaAmbientes.parse(r.json()).itens;
    return { filial_id, ambiente: amb!.ambiente, uf: 'AM' };
  };

  it('upload pela rota do core: 201, cifrado no banco com a chave do secret de teste, resumo sem segredo', async () => {
    const f = formulario({ filial_id: filial, senha: a1.senha }, { arquivo: a1.pfx });
    const r = await app.inject({ method: 'POST', url: '/v1/core/certificados', payload: f.payload, headers: { ...f.headers, ...autorizacao() } });
    respostas.push(r.body);
    expect(r.statusCode, r.body).toBe(201);
    expect(CertificadoResumo.parse(r.json())).toMatchObject({ filial_id: filial, cnpj: CNPJ_EMITENTE_DE_TESTE, ativo: true });

    const { rows } = await b.admin.query<{ pfx_cifrado: Buffer; senha_cifrada: Buffer; chave_versao: number }>(
      'SELECT pfx_cifrado, senha_cifrada, chave_versao FROM core.certificado WHERE tenant_id = $1 AND filial_id = $2 AND ativo',
      [tenant, filial],
    );
    expect(rows).toHaveLength(1);
    const linha = rows[0]!;
    // Cifrado de verdade: nem o PFX nem a senha aparecem em claro (nem um trecho de 32 bytes do PFX).
    expect(linha.pfx_cifrado.includes(a1.pfx.subarray(64, 96))).toBe(false);
    expect(linha.senha_cifrada.includes(Buffer.from(a1.senha))).toBe(false);
    expect(linha.pfx_cifrado.length).toBe(a1.pfx.length + 16); // AES-256-GCM: mesmo tamanho + tag de 16 bytes
    expect(linha.chave_versao).toBe(1);
  });

  it('o A1 volta pelo contrato do core, assina a NF-e e o simulador (pelo seletor) autoriza: protocolo e XML guardável', async () => {
    const lista = await get(`/v1/core/certificados?filial_id=${filial}`);
    const [resumo] = ListaCertificados.parse(lista.json()).itens;
    expect(resumo).toMatchObject({ cnpj: CNPJ_EMITENTE_DE_TESTE, ativo: true });

    let chamadas = 0;
    const seletor = criarSeletorTransporte({
      transporte: 'simulador',
      simulador: (d: DestinoSimulador) => {
        chamadas += 1;
        return criarSimuladorSefaz(d);
      },
    });
    const transporte = seletor(await filialEmissora(filial), { pfx: a1.pfx, senha: a1.senha });
    expect(chamadas).toBe(1);
    expect(transporte.destino).toMatchObject({ tipo: 'simulador', ambiente: 'homologacao', tpAmb: 2 });

    const nfe = montarNFeDeTeste({ nNF: 1, dhEmi: new Date(Date.now() - 60_000) });
    const assinada = assinarXmlDeTeste(nfe.xml, { elemento: 'infNFe', a1 });
    // O certificado da assinatura é o mesmo que o core guardou (impressão digital SHA-256 do CertificadoResumo).
    const conferida = verificarAssinaturaNFe(assinada, { cnpjEsperado: CNPJ_EMITENTE_DE_TESTE });
    expect(conferida.ok && conferida.certificado.impressaoDigital).toBe(resumo!.impressao_digital);

    const r = await transporte.autorizar({ idLote: '1', sincrono: true, nfes: [assinada] });
    respostas.push(r.xml);
    const p = r.protocolos[0]!;
    expect(p).toMatchObject({ cStat: '100', chNFe: nfe.chave, tpAmb: 2, verAplic: VER_APLIC_SIMULADOR });
    expect(p.nProt).toMatch(new RegExp(`^${PREFIXO_NUMERO_SIMULADOR}\\d{14}$`));
    const nfeProc = montarNfeProc(assinada, p.xml);
    expect(await validarXsd(nfeProc, 'procNFe')).toEqual({ valido: true, erros: [] });
    expect(verificarAssinaturaNFe(nfeProc.replace(/^<nfeProc[^>]*>/, '').replace(/<protNFe[\s\S]*$/, '')).ok).toBe(true);
    respostas.push(p.xml);
  });

  it('regra 7 de ponta a ponta: filial em produção (operador) → SimuladorEmProducaoErro e o simulador nunca é chamado', async () => {
    await b.admin.query("INSERT INTO core.ambiente_fiscal (tenant_id, filial_id, ambiente, recado_aprovacao) VALUES ($1, $2, 'producao', $3)", [tenant, filialProducao, RECADO_APROVACAO]);
    const emissora = await filialEmissora(filialProducao);
    expect(emissora.ambiente).toBe('producao');
    let chamadas = 0;
    const seletor = criarSeletorTransporte({
      transporte: 'simulador',
      simulador: (d: DestinoSimulador) => {
        chamadas += 1;
        return criarSimuladorSefaz(d);
      },
    });
    expect(() => seletor(emissora, { pfx: a1.pfx, senha: a1.senha })).toThrow(SimuladorEmProducaoErro);
    expect(chamadas).toBe(0);
  });

  it('o A1 decifrado da filial pelo core (papel do worker) é aberto pelo emissor, assina a NF-e e o simulador autoriza com 100', async () => {
    const worker = b.banco('macuxierp_worker');
    const lido = await worker.comTenant(tenant, (tx) => lerA1DecifradoDaFilial(tx, chaveA1, filial));
    expect(lido).not.toBeNull();
    // O mesmo PKCS#12 e a mesma senha do upload, só em memória e ocultos em serialização e inspeção.
    expect(lido!.pfx.equals(a1.pfx)).toBe(true);
    expect(lido!.senha).toBe(a1.senha);
    const visto = [JSON.stringify(lido), String(lido), inspect(lido)];
    respostas.push(...visto);
    for (const v of visto) expect(v.includes(a1.senha) || v.includes(a1.pfx.toString('base64').slice(0, 40))).toBe(false);
    // Outro tenant não enxerga a linha (RLS): sem certificado, e não erro.
    const outroTenant = await criarTenant(b.admin, 'am0046', ['faturamento']);
    expect(await worker.comTenant(outroTenant, (tx) => lerA1DecifradoDaFilial(tx, chaveA1, filial))).toBeNull();

    const aberto = abrirA1(lido!.pfx, lido!.senha);
    lido!.pfx.fill(0); // quem recebe zera o PFX ao terminar (leitura-a1.ts)
    const lista = await get(`/v1/core/certificados?filial_id=${filial}`);
    const [resumo] = ListaCertificados.parse(lista.json()).itens;
    expect(aberto).toMatchObject({ cnpj: CNPJ_EMITENTE_DE_TESTE, impressaoDigital: resumo!.impressao_digital });

    const transporte = criarSeletorTransporte({ transporte: 'simulador', simulador: (d: DestinoSimulador) => criarSimuladorSefaz(d) })(
      await filialEmissora(filial),
      { pfx: a1.pfx, senha: a1.senha },
    );
    const nfe = montarNFeDeTeste({ nNF: 2, dhEmi: new Date(Date.now() - 60_000) });
    const assinada = assinarXmlDeTeste(nfe.xml, { elemento: 'infNFe', a1: aberto });
    const r = await transporte.autorizar({ idLote: '2', sincrono: true, nfes: [assinada] });
    respostas.push(r.xml);
    expect(r.protocolos[0]).toMatchObject({ cStat: '100', chNFe: nfe.chave, tpAmb: 2 });
    expect(r.protocolos[0]!.nProt).toMatch(new RegExp(`^${PREFIXO_NUMERO_SIMULADOR}\\d{14}$`));
  });

  it('nenhum log, resposta ou protocolo traz o PFX, a senha ou a chave privada', () => {
    const { chavePrivadaPem } = a1;
    const tudo = [...logs, ...respostas].join('\n');
    expect(logs.length).toBeGreaterThan(0);
    for (const segredo of [a1.senha, a1.pfx.toString('base64').slice(100, 160), a1.pfx.toString('hex').slice(200, 264), chavePrivadaPem.split('\n')[3]!, chaveA1.toString('hex'), chaveA1.toString('base64')]) {
      expect(tudo.includes(segredo)).toBe(false);
    }
    expect(tudo).not.toMatch(/PRIVATE KEY/);
  });

});

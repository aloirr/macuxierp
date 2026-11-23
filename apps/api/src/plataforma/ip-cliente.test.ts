import { randomBytes } from 'node:crypto';
import { CABECALHO_IP_CLIENTE, CABECALHO_PROVA_BFF } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ipDoCliente, type PedidoComIp } from './ip-cliente';

// Segredo gerado a cada execução: nenhum segredo fixo no teste.
const SEGREDO = randomBytes(32).toString('hex');
const OUTRO = randomBytes(32).toString('hex');
const IP_CONTEINER = '172.18.0.5';

const pedido = (headers: PedidoComIp['headers'] = {}): PedidoComIp => ({ ip: IP_CONTEINER, headers });

describe('ipDoCliente (T-0050): IP do limite de login atrás do túnel e do BFF', () => {
  it('prova certa do BFF + IP válido: usa o IP informado pelo BFF (IPv4 e IPv6)', () => {
    expect(ipDoCliente(pedido({ [CABECALHO_PROVA_BFF]: SEGREDO, [CABECALHO_IP_CLIENTE]: '203.0.113.7' }), SEGREDO)).toBe('203.0.113.7');
    expect(ipDoCliente(pedido({ [CABECALHO_PROVA_BFF]: SEGREDO, [CABECALHO_IP_CLIENTE]: '2001:db8::1' }), SEGREDO)).toBe('2001:db8::1');
  });

  it('prova do BFF vence o cf-connecting-ip (no BFF, o cf-connecting-ip seria do próprio BFF ou ausente)', () => {
    const h = { [CABECALHO_PROVA_BFF]: SEGREDO, [CABECALHO_IP_CLIENTE]: '203.0.113.7', 'cf-connecting-ip': '198.51.100.9' };
    expect(ipDoCliente(pedido(h), SEGREDO)).toBe('203.0.113.7');
  });

  it('prova errada, de outro tamanho, repetida ou vazia: ignora o IP do BFF', () => {
    for (const prova of [OUTRO, SEGREDO.slice(1), `${SEGREDO}0`, '', [SEGREDO, SEGREDO]]) {
      expect(ipDoCliente(pedido({ [CABECALHO_PROVA_BFF]: prova, [CABECALHO_IP_CLIENTE]: '203.0.113.7' }), SEGREDO)).toBe(IP_CONTEINER);
      expect(ipDoCliente(pedido({ [CABECALHO_PROVA_BFF]: prova, [CABECALHO_IP_CLIENTE]: '203.0.113.7', 'cf-connecting-ip': '198.51.100.9' }), SEGREDO)).toBe('198.51.100.9');
    }
  });

  it('segredo ausente na API (null ou vazio): nunca confia no cabeçalho do BFF, nem com prova vazia', () => {
    for (const segredo of [null, '']) {
      expect(ipDoCliente(pedido({ [CABECALHO_PROVA_BFF]: '', [CABECALHO_IP_CLIENTE]: '203.0.113.7' }), segredo)).toBe(IP_CONTEINER);
      expect(ipDoCliente(pedido({ [CABECALHO_PROVA_BFF]: SEGREDO, [CABECALHO_IP_CLIENTE]: '203.0.113.7' }), segredo)).toBe(IP_CONTEINER);
    }
  });

  it('prova certa com IP do cliente inválido, ausente ou repetido: cai no cf-connecting-ip e depois no req.ip', () => {
    for (const ip of ['nao-e-ip', '203.0.113.7, 10.0.0.1', '999.1.1.1', '', undefined, ['203.0.113.7', '203.0.113.8']]) {
      const h: PedidoComIp['headers'] = { [CABECALHO_PROVA_BFF]: SEGREDO, [CABECALHO_IP_CLIENTE]: ip };
      expect(ipDoCliente(pedido(h), SEGREDO)).toBe(IP_CONTEINER);
      expect(ipDoCliente(pedido({ ...h, 'cf-connecting-ip': '198.51.100.9' }), SEGREDO)).toBe('198.51.100.9');
    }
  });

  it('cf-connecting-ip válido (o Cloudflare sobrescreve na borda): usa esse; inválido ou repetido: req.ip', () => {
    expect(ipDoCliente(pedido({ 'cf-connecting-ip': '198.51.100.9' }), SEGREDO)).toBe('198.51.100.9');
    expect(ipDoCliente(pedido({ 'cf-connecting-ip': '198.51.100.9' }), null)).toBe('198.51.100.9');
    expect(ipDoCliente(pedido({ 'cf-connecting-ip': 'lixo' }), SEGREDO)).toBe(IP_CONTEINER);
    expect(ipDoCliente(pedido({ 'cf-connecting-ip': ['198.51.100.9', '198.51.100.10'] }), SEGREDO)).toBe(IP_CONTEINER);
  });

  it('sem cabeçalho nenhum: req.ip, como antes da T-0050 (compatível)', () => {
    expect(ipDoCliente(pedido(), SEGREDO)).toBe(IP_CONTEINER);
    expect(ipDoCliente(pedido(), null)).toBe(IP_CONTEINER);
  });
});

import { defineModule } from '@macuxierp/platform-sdk';

export const manifest = defineModule({
  id: 'fiscal',
  versao: '0.2.0',
  descricao: 'Regras tributárias por NCM, CFOP e CST/CSOSN: ICMS, ICMS-ST, IPI, PIS, COFINS e IBS/CBS/IS (NT 2025.002-RTC).',
  depende: ['core', 'cadastros'],
  perfis: ['administrador', 'fiscal', 'leitura'],
  web: { menus: ['Regras fiscais'] },
  publica: ['fiscal.regra.alterada@1'],
  consome: [],
});

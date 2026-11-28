import { defineModule, PERFIS_V1 } from '@macuxierp/platform-sdk';

export const manifest = defineModule({
  id: 'core',
  versao: '0.1.0',
  descricao: 'Plataforma: empresa, usuários, perfis, licenças, auditoria, arquivos, exportação LGPD.',
  depende: [],
  // RN-CORE-09: sem o analista de implantação.
  perfis: PERFIS_V1,
  web: { menus: ['Empresa', 'Usuários e perfis'] },
  publica: ['core.empresa.alterada@1', 'core.usuario.alterado@1', 'core.certificado.alterado@1', 'core.ambiente_fiscal.alterado@1', 'core.empresa.cnpj_alterado@1'],
  // RN-CORE-14 (T-0100): a empresa nasce da primeira filial padrão.
  consome: ['cadastros.filial.alterada@1'],
});

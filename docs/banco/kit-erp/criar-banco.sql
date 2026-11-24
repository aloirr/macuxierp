/*
  Kit do Macuxi ERP — criar-banco do SQL Server 2022 (Express) para o banco FICTÍCIO ERP_THATHYANY.
  T-0057 · cenário B (v0.3.11) · ADR 0014 §6, §7 e §13 · dono: banco-dados · roteiro: docs/banco/vm-cenario-b.md.

  O que cria (reexecutável: IF NOT EXISTS / CREATE OR ALTER; sem dado e sem segredo):
    - o banco ERP_THATHYANY;
    - as 10 tabelas dbo.tha_* dos cadastros da F2 (ENTIDADES_ENVIO_FDV) e as 10 views dbo.vw_macuxi_<entidade> que o
      Conector lê (sobe);
    - a entrada do que desce do ERP (ADR 0014 §13): pedido (macuxi_pedido_entrada*), nota emitida pelo ERP
      (macuxi_nota_entrada*) e pré-cadastro de cliente (macuxi_cliente_entrada), com as procedures sp_macuxi_*;
    - as views do retorno: vw_macuxi_pedido_status, vw_macuxi_pedido_nota_item e vw_macuxi_cliente_retorno;
    - procedures sp_tha_* que SIMULAM o ERP do cliente no teste (faturar, cancelar, vincular o pré-cadastro); o
      Conector NÃO tem EXECUTE nelas;
    - o login e o usuário macuxi_conector: SELECT só nas views vw_macuxi_*, EXECUTE só nas sp_macuxi_*, nada nas tabelas.

  Origem das colunas: os payloads do contrato do Hub v1 em modules/integracao-fdv/contracts/hub.ts (os mesmos do
  hub-v1 do SDK) e o PedidoParaErp/RetornoErp de modules/integracao-fdv/contracts/index.ts. O criar-banco do kit do
  FDV (aloirr/macuxifdv@0b79391) não está copiado no repositório do ERP; a conferência coluna a coluna contra ele
  fica pendente (ver o roteiro, seção 5).

  Convenções: external_id varchar(200) com colação binária UTF-8 (o Hub compara por bytes; o cursor do Conector é
  (alterado_em, external_id)); alterado_em datetime2(3) em UTC; dinheiro em centavos (bigint); quantidades decimal(18,6).
  As procedures recebem data-hora como datetimeoffset (aceita o "Z") e gravam em UTC.

  Como rodar (como sa, a senha do conector pela variável de ambiente SENHA_CONECTOR, que o sqlcmd lê como variável de
  script; o valor nunca é escrito neste arquivo):
    ( set -a; . ~/thathyany/.segredos.env; set +a; SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" \
      sqlcmd -S 127.0.0.1 -U sa -C -b -i criar-banco.sql )
  Sem SENHA_CONECTOR definida, o sqlcmd para com "scripting variable not defined" e nada do login é criado.
  A senha não pode ter apóstrofo (') — a gerada pelo roteiro (seção 2A) não tem.

  Erros das procedures: THROW 5xxxx com a mensagem só com o nome do campo, nunca com o valor (LGPD).
*/
:on error exit
SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* Colação UTF-8 do banco: parâmetro varchar das procedures não perde acento nem caractere fora do 1252. */
IF DB_ID(N'ERP_THATHYANY') IS NULL
    CREATE DATABASE ERP_THATHYANY COLLATE Latin1_General_100_CI_AI_SC_UTF8;
GO

USE ERP_THATHYANY;
GO

/* ===================================================================================================================
   1. Cadastros (sobem): tabelas dbo.tha_*
   =================================================================================================================== */

IF OBJECT_ID(N'dbo.tha_filial', N'U') IS NULL
CREATE TABLE dbo.tha_filial (
    external_id  varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL CONSTRAINT pk_tha_filial PRIMARY KEY,
    ativo        bit           NOT NULL CONSTRAINT df_tha_filial_ativo DEFAULT (1),
    codigo       nvarchar(20)  NOT NULL,
    nome         nvarchar(60)  NOT NULL,
    cnpj         varchar(14)   NULL,
    logradouro   nvarchar(160) NULL,
    numero       nvarchar(20)  NULL,
    complemento  nvarchar(80)  NULL,
    bairro       nvarchar(80)  NULL,
    cidade       nvarchar(80)  NULL,
    uf           char(2)       NULL,
    cep          char(8)       NULL,
    telefone     nvarchar(30)  NULL,
    alterado_em  datetime2(3)  NOT NULL CONSTRAINT df_tha_filial_alterado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT ck_tha_filial_external_id CHECK (LEN(external_id) >= 1),
    CONSTRAINT ck_tha_filial_cnpj CHECK (cnpj IS NULL OR cnpj LIKE REPLICATE('[0-9]', 14)),
    CONSTRAINT ck_tha_filial_uf   CHECK (uf IS NULL OR uf COLLATE Latin1_General_100_BIN2 LIKE '[A-Z][A-Z]'),
    CONSTRAINT ck_tha_filial_cep  CHECK (cep IS NULL OR cep LIKE REPLICATE('[0-9]', 8))
);
GO

IF OBJECT_ID(N'dbo.tha_vendedor', N'U') IS NULL
CREATE TABLE dbo.tha_vendedor (
    external_id         varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL CONSTRAINT pk_tha_vendedor PRIMARY KEY,
    ativo               bit          NOT NULL CONSTRAINT df_tha_vendedor_ativo DEFAULT (1),
    nome                nvarchar(80) NOT NULL,
    filial_external_id  varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NULL,
    alterado_em         datetime2(3) NOT NULL CONSTRAINT df_tha_vendedor_alterado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT ck_tha_vendedor_external_id CHECK (LEN(external_id) >= 1)
);
GO

IF OBJECT_ID(N'dbo.tha_forma_pagamento', N'U') IS NULL
CREATE TABLE dbo.tha_forma_pagamento (
    external_id  varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL CONSTRAINT pk_tha_forma_pagamento PRIMARY KEY,
    ativo        bit          NOT NULL CONSTRAINT df_tha_forma_pagamento_ativo DEFAULT (1),
    codigo       nvarchar(30) NOT NULL,
    nome         nvarchar(60) NOT NULL,
    alterado_em  datetime2(3) NOT NULL CONSTRAINT df_tha_forma_pagamento_alterado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT ck_tha_forma_pagamento_external_id CHECK (LEN(external_id) >= 1)
);
GO

IF OBJECT_ID(N'dbo.tha_prazo_pagamento', N'U') IS NULL
CREATE TABLE dbo.tha_prazo_pagamento (
    external_id        varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL CONSTRAINT pk_tha_prazo_pagamento PRIMARY KEY,
    ativo              bit          NOT NULL CONSTRAINT df_tha_prazo_pagamento_ativo DEFAULT (1),
    forma_external_id  varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    codigo             nvarchar(20) NOT NULL,
    parcelas_dias      varchar(100) NOT NULL,   -- "28/56"; à vista = "0"
    descricao          nvarchar(60) NULL,
    alterado_em        datetime2(3) NOT NULL CONSTRAINT df_tha_prazo_pagamento_alterado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT ck_tha_prazo_pagamento_external_id CHECK (LEN(external_id) >= 1),
    CONSTRAINT ck_tha_prazo_pagamento_parcelas CHECK (parcelas_dias NOT LIKE '%[^0-9/]%' AND parcelas_dias LIKE '[0-9]%'
                                                     AND parcelas_dias NOT LIKE '%/' AND parcelas_dias NOT LIKE '%//%')
);
GO

IF OBJECT_ID(N'dbo.tha_produto', N'U') IS NULL
CREATE TABLE dbo.tha_produto (
    external_id  varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL CONSTRAINT pk_tha_produto PRIMARY KEY,
    ativo        bit           NOT NULL CONSTRAINT df_tha_produto_ativo DEFAULT (1),
    sku          nvarchar(60)  NOT NULL,
    nome         nvarchar(120) NOT NULL,
    unidade      varchar(4)    NOT NULL,   -- sigla de medida, 1 a 4 letras maiúsculas
    ean          varchar(14)   NULL,
    marca        nvarchar(60)  NULL,
    alterado_em  datetime2(3)  NOT NULL CONSTRAINT df_tha_produto_alterado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT ck_tha_produto_external_id CHECK (LEN(external_id) >= 1),
    CONSTRAINT ck_tha_produto_unidade CHECK (unidade COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^A-Z]%' AND LEN(unidade) >= 1)
);
GO

IF OBJECT_ID(N'dbo.tha_produto_unidade', N'U') IS NULL
CREATE TABLE dbo.tha_produto_unidade (
    external_id          varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL CONSTRAINT pk_tha_produto_unidade PRIMARY KEY,
    ativo                bit           NOT NULL CONSTRAINT df_tha_produto_unidade_ativo DEFAULT (1),
    produto_external_id  varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    unidade              varchar(4)    NOT NULL,
    fator                decimal(18,6) NOT NULL,
    ean                  varchar(14)   NULL,
    padrao               bit           NOT NULL CONSTRAINT df_tha_produto_unidade_padrao DEFAULT (0),
    alterado_em          datetime2(3)  NOT NULL CONSTRAINT df_tha_produto_unidade_alterado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT ck_tha_produto_unidade_external_id CHECK (LEN(external_id) >= 1),
    CONSTRAINT ck_tha_produto_unidade_unidade CHECK (unidade COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^A-Z]%' AND LEN(unidade) >= 1),
    CONSTRAINT ck_tha_produto_unidade_fator CHECK (fator > 0)
);
GO

IF OBJECT_ID(N'dbo.tha_preco', N'U') IS NULL
CREATE TABLE dbo.tha_preco (
    external_id          varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL CONSTRAINT pk_tha_preco PRIMARY KEY,
    ativo                bit           NOT NULL CONSTRAINT df_tha_preco_ativo DEFAULT (1),
    tabela_external_id   varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    tabela_nome          nvarchar(120) NOT NULL,
    vigencia_inicio      date          NOT NULL,
    vigencia_fim         date          NULL,
    produto_external_id  varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    preco_cents          bigint        NOT NULL,
    filial_external_id   varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NULL,   -- nulo = todas as filiais
    alterado_em          datetime2(3)  NOT NULL CONSTRAINT df_tha_preco_alterado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT ck_tha_preco_external_id CHECK (LEN(external_id) >= 1),
    CONSTRAINT ck_tha_preco_cents CHECK (preco_cents >= 0),
    CONSTRAINT ck_tha_preco_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
GO

IF OBJECT_ID(N'dbo.tha_estoque', N'U') IS NULL
CREATE TABLE dbo.tha_estoque (
    external_id           varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL CONSTRAINT pk_tha_estoque PRIMARY KEY,
    ativo                 bit           NOT NULL CONSTRAINT df_tha_estoque_ativo DEFAULT (1),
    deposito_external_id  varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    deposito_nome         nvarchar(120) NULL,
    produto_external_id   varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    saldo                 decimal(18,6) NOT NULL,
    filial_external_id    varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    alterado_em           datetime2(3)  NOT NULL CONSTRAINT df_tha_estoque_alterado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT ck_tha_estoque_external_id CHECK (LEN(external_id) >= 1)
);
GO

IF OBJECT_ID(N'dbo.tha_cliente', N'U') IS NULL
CREATE TABLE dbo.tha_cliente (
    external_id           varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL CONSTRAINT pk_tha_cliente PRIMARY KEY,
    ativo                 bit           NOT NULL CONSTRAINT df_tha_cliente_ativo DEFAULT (1),
    razao_social          nvarchar(60)  NOT NULL,
    nome_fantasia         nvarchar(60)  NULL,
    documento             varchar(14)   NULL,   -- CPF (11) ou CNPJ (14), só dígitos
    inscricao_estadual    varchar(20)   NULL,
    vendedor_external_id  varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NULL,   -- carteira
    filial_external_id    varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    endereco_logradouro   nvarchar(60)  NULL,
    endereco_numero       nvarchar(20)  NULL,
    endereco_complemento  nvarchar(60)  NULL,
    endereco_bairro       nvarchar(60)  NULL,
    endereco_cidade       nvarchar(60)  NULL,
    endereco_uf           char(2)       NULL,
    endereco_cep          char(8)       NULL,
    limite_credito_cents  bigint        NOT NULL CONSTRAINT df_tha_cliente_limite DEFAULT (0),
    formas_pagamento      varchar(400)  NULL,   -- códigos de forma separados por vírgula
    prazo_medio_max_dias  int           NULL,
    alterado_em           datetime2(3)  NOT NULL CONSTRAINT df_tha_cliente_alterado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT ck_tha_cliente_external_id CHECK (LEN(external_id) >= 1),
    CONSTRAINT ck_tha_cliente_documento CHECK (documento IS NULL OR documento LIKE REPLICATE('[0-9]', 11) OR documento LIKE REPLICATE('[0-9]', 14)),
    CONSTRAINT ck_tha_cliente_uf CHECK (endereco_uf IS NULL OR endereco_uf COLLATE Latin1_General_100_BIN2 LIKE '[A-Z][A-Z]'),
    CONSTRAINT ck_tha_cliente_cep CHECK (endereco_cep IS NULL OR endereco_cep LIKE REPLICATE('[0-9]', 8)),
    CONSTRAINT ck_tha_cliente_limite CHECK (limite_credito_cents >= 0),
    CONSTRAINT ck_tha_cliente_prazo CHECK (prazo_medio_max_dias IS NULL OR prazo_medio_max_dias >= 0)
);
GO

IF OBJECT_ID(N'dbo.tha_cliente_endereco', N'U') IS NULL
CREATE TABLE dbo.tha_cliente_endereco (
    external_id          varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL CONSTRAINT pk_tha_cliente_endereco PRIMARY KEY,
    ativo                bit          NOT NULL CONSTRAINT df_tha_cliente_endereco_ativo DEFAULT (1),
    cliente_external_id  varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    tipo                 varchar(10)  NOT NULL,
    principal            bit          NOT NULL CONSTRAINT df_tha_cliente_endereco_principal DEFAULT (0),
    logradouro           nvarchar(60) NOT NULL,
    numero               nvarchar(20) NULL,
    complemento          nvarchar(60) NULL,
    bairro               nvarchar(60) NULL,
    cidade               nvarchar(60) NOT NULL,
    uf                   char(2)      NOT NULL,
    cep                  char(8)      NULL,
    alterado_em          datetime2(3) NOT NULL CONSTRAINT df_tha_cliente_endereco_alterado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT ck_tha_cliente_endereco_external_id CHECK (LEN(external_id) >= 1),
    CONSTRAINT ck_tha_cliente_endereco_tipo CHECK (tipo IN ('principal', 'entrega', 'cobranca')),
    CONSTRAINT ck_tha_cliente_endereco_uf CHECK (uf COLLATE Latin1_General_100_BIN2 LIKE '[A-Z][A-Z]'),
    CONSTRAINT ck_tha_cliente_endereco_cep CHECK (cep IS NULL OR cep LIKE REPLICATE('[0-9]', 8))
);
GO

/* Índice do cursor do Conector (alterado_em, external_id), um por tabela. */
DECLARE @t sysname, @sql nvarchar(max);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR
    SELECT v.t FROM (VALUES (N'tha_filial'), (N'tha_vendedor'), (N'tha_forma_pagamento'), (N'tha_prazo_pagamento'),
                            (N'tha_produto'), (N'tha_produto_unidade'), (N'tha_preco'), (N'tha_estoque'),
                            (N'tha_cliente'), (N'tha_cliente_endereco')) AS v(t);
OPEN c;
FETCH NEXT FROM c INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.' + @t) AND name = N'ix_' + @t + N'_cursor')
    BEGIN
        SET @sql = N'CREATE INDEX ' + QUOTENAME(N'ix_' + @t + N'_cursor') + N' ON dbo.' + QUOTENAME(@t) + N' (alterado_em, external_id);';
        EXEC sys.sp_executesql @sql;
    END;
    FETCH NEXT FROM c INTO @t;
END;
CLOSE c;
DEALLOCATE c;
GO

/* ===================================================================================================================
   2. Views de cadastro (o Conector lê): dbo.vw_macuxi_<entidade>
   =================================================================================================================== */

CREATE OR ALTER VIEW dbo.vw_macuxi_filial AS
SELECT external_id, ativo, codigo, nome, cnpj, logradouro, numero, complemento, bairro, cidade, uf, cep, telefone, alterado_em
FROM dbo.tha_filial;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_vendedor AS
SELECT external_id, ativo, nome, filial_external_id, alterado_em
FROM dbo.tha_vendedor;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_forma_pagamento AS
SELECT external_id, ativo, codigo, nome, alterado_em
FROM dbo.tha_forma_pagamento;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_prazo_pagamento AS
SELECT external_id, ativo, forma_external_id, codigo, parcelas_dias, descricao, alterado_em
FROM dbo.tha_prazo_pagamento;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_produto AS
SELECT external_id, ativo, sku, nome, unidade, ean, marca, alterado_em
FROM dbo.tha_produto;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_produto_unidade AS
SELECT external_id, ativo, produto_external_id, unidade, fator, ean, padrao, alterado_em
FROM dbo.tha_produto_unidade;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_preco AS
SELECT external_id, ativo, tabela_external_id, tabela_nome, vigencia_inicio, vigencia_fim, produto_external_id,
       preco_cents, filial_external_id, alterado_em
FROM dbo.tha_preco;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_estoque AS
SELECT external_id, ativo, deposito_external_id, deposito_nome, produto_external_id, saldo, filial_external_id, alterado_em
FROM dbo.tha_estoque;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_cliente AS
SELECT external_id, ativo, razao_social, nome_fantasia, documento, inscricao_estadual, vendedor_external_id,
       filial_external_id, endereco_logradouro, endereco_numero, endereco_complemento, endereco_bairro,
       endereco_cidade, endereco_uf, endereco_cep, limite_credito_cents, formas_pagamento, prazo_medio_max_dias,
       alterado_em
FROM dbo.tha_cliente;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_cliente_endereco AS
SELECT external_id, ativo, cliente_external_id, tipo, principal, logradouro, numero, complemento, bairro, cidade, uf,
       cep, alterado_em
FROM dbo.tha_cliente_endereco;
GO

/* ===================================================================================================================
   3. O que desce do ERP (ADR 0014 §13): tabelas de entrada
   =================================================================================================================== */

/* Pedido aprovado no ERP. numero = o número do pedido no ERP do cliente (vai no RetornoErp.numero_erp). */
IF OBJECT_ID(N'dbo.macuxi_pedido_entrada', N'U') IS NULL
CREATE TABLE dbo.macuxi_pedido_entrada (
    numero                bigint IDENTITY(1, 1) NOT NULL CONSTRAINT pk_macuxi_pedido_entrada PRIMARY KEY,
    pedido_uuid           uniqueidentifier NOT NULL CONSTRAINT uq_macuxi_pedido_entrada_uuid UNIQUE,
    cliente_external_id   varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    vendedor_external_id  varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    filial_external_id    varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NULL,
    prazo_external_id     varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NULL,
    criado_em             datetime2(3)  NOT NULL,   -- UTC
    aprovado_em           datetime2(3)  NULL,       -- UTC
    observacao            nvarchar(500) NULL,
    total_cents           bigint        NOT NULL,
    qtd_itens             int           NOT NULL,
    -- ciclo de status (escrito pelo ERP do cliente; lido pelo Conector em vw_macuxi_pedido_status)
    status                varchar(20)   NOT NULL CONSTRAINT df_macuxi_pedido_entrada_status DEFAULT ('recebido'),
    motivo                nvarchar(300) NULL,
    nota_numero           int           NULL,
    nota_serie            int           NULL,
    nota_chave            char(44)      NULL,
    nota_emitida_em       datetime2(3)  NULL,
    nota_total_cents      bigint        NULL,
    recebido_em           datetime2(3)  NOT NULL CONSTRAINT df_macuxi_pedido_entrada_recebido DEFAULT (SYSUTCDATETIME()),
    alterado_em           datetime2(3)  NOT NULL CONSTRAINT df_macuxi_pedido_entrada_alterado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT ck_macuxi_pedido_entrada_status CHECK (status IN ('recebido', 'integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado')),
    CONSTRAINT ck_macuxi_pedido_entrada_total CHECK (total_cents >= 0),
    CONSTRAINT ck_macuxi_pedido_entrada_itens CHECK (qtd_itens BETWEEN 1 AND 500),
    CONSTRAINT ck_macuxi_pedido_entrada_nota CHECK (nota_chave IS NULL OR nota_chave LIKE REPLICATE('[0-9]', 44)),
    CONSTRAINT ck_macuxi_pedido_entrada_nota_total CHECK (nota_total_cents IS NULL OR nota_total_cents >= 0)
);
GO

IF OBJECT_ID(N'dbo.macuxi_pedido_entrada_item', N'U') IS NULL
CREATE TABLE dbo.macuxi_pedido_entrada_item (
    pedido_numero         bigint        NOT NULL CONSTRAINT fk_macuxi_pedido_entrada_item_pedido REFERENCES dbo.macuxi_pedido_entrada (numero),
    sequencia             int           NOT NULL,
    produto_external_id   varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    quantidade            decimal(18,6) NOT NULL,
    unidade               varchar(6)    NULL,
    fator                 decimal(18,6) NULL,
    quantidade_venda      decimal(18,6) NULL,
    preco_unitario_cents  bigint        NOT NULL,
    desconto_cents        bigint        NOT NULL CONSTRAINT df_macuxi_pedido_entrada_item_desc DEFAULT (0),
    total_cents           bigint        NOT NULL,
    aplicacao             nvarchar(1000) NULL,
    recebido_em           datetime2(3)  NOT NULL CONSTRAINT df_macuxi_pedido_entrada_item_recebido DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT pk_macuxi_pedido_entrada_item PRIMARY KEY (pedido_numero, sequencia),
    CONSTRAINT ck_macuxi_pedido_entrada_item_seq CHECK (sequencia >= 1),
    CONSTRAINT ck_macuxi_pedido_entrada_item_qtd CHECK (quantidade > 0),
    CONSTRAINT ck_macuxi_pedido_entrada_item_fator CHECK (fator IS NULL OR fator > 0),
    CONSTRAINT ck_macuxi_pedido_entrada_item_valores CHECK (preco_unitario_cents >= 0 AND desconto_cents >= 0 AND total_cents >= 0)
);
GO

/* Itens faturados pelo ERP do cliente (faturamento desligado; sobe pela vw_macuxi_pedido_nota_item). */
IF OBJECT_ID(N'dbo.macuxi_pedido_nota_item', N'U') IS NULL
CREATE TABLE dbo.macuxi_pedido_nota_item (
    pedido_numero        bigint        NOT NULL CONSTRAINT fk_macuxi_pedido_nota_item_pedido REFERENCES dbo.macuxi_pedido_entrada (numero),
    sequencia            int           NOT NULL,
    produto_external_id  varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    quantidade           decimal(18,6) NOT NULL,
    valor_cents          bigint        NOT NULL,
    alterado_em          datetime2(3)  NOT NULL CONSTRAINT df_macuxi_pedido_nota_item_alterado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT pk_macuxi_pedido_nota_item PRIMARY KEY (pedido_numero, sequencia),
    CONSTRAINT ck_macuxi_pedido_nota_item_qtd CHECK (quantidade > 0),
    CONSTRAINT ck_macuxi_pedido_nota_item_valor CHECK (valor_cents >= 0)
);
GO

/* Nota emitida pelo ERP (faturamento ligado). Cópia de referência: sem XML (o XML fica guardado no ERP, regra 7). */
IF OBJECT_ID(N'dbo.macuxi_nota_entrada', N'U') IS NULL
CREATE TABLE dbo.macuxi_nota_entrada (
    chave                 char(44)      NOT NULL CONSTRAINT pk_macuxi_nota_entrada PRIMARY KEY,
    modelo                tinyint       NOT NULL CONSTRAINT df_macuxi_nota_entrada_modelo DEFAULT (55),
    serie                 int           NOT NULL,
    numero                int           NOT NULL,
    emitida_em            datetime2(3)  NOT NULL,   -- UTC
    pedido_uuid           uniqueidentifier NULL,
    filial_external_id    varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    cliente_external_id   varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    valor_produtos_cents  bigint        NOT NULL,
    desconto_cents        bigint        NOT NULL CONSTRAINT df_macuxi_nota_entrada_desc DEFAULT (0),
    frete_cents           bigint        NOT NULL CONSTRAINT df_macuxi_nota_entrada_frete DEFAULT (0),
    total_cents           bigint        NOT NULL,
    qtd_itens             int           NOT NULL,
    situacao              varchar(10)   NOT NULL CONSTRAINT df_macuxi_nota_entrada_situacao DEFAULT ('autorizada'),
    cancelada_em          datetime2(3)  NULL,
    recebida_em           datetime2(3)  NOT NULL CONSTRAINT df_macuxi_nota_entrada_recebida DEFAULT (SYSUTCDATETIME()),
    alterado_em           datetime2(3)  NOT NULL CONSTRAINT df_macuxi_nota_entrada_alterado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT uq_macuxi_nota_entrada_numero UNIQUE (filial_external_id, modelo, serie, numero),
    CONSTRAINT ck_macuxi_nota_entrada_chave CHECK (chave LIKE REPLICATE('[0-9]', 44)),
    CONSTRAINT ck_macuxi_nota_entrada_modelo CHECK (modelo = 55),
    CONSTRAINT ck_macuxi_nota_entrada_serie CHECK (serie BETWEEN 0 AND 999),
    CONSTRAINT ck_macuxi_nota_entrada_numero CHECK (numero BETWEEN 1 AND 999999999),
    CONSTRAINT ck_macuxi_nota_entrada_valores CHECK (valor_produtos_cents >= 0 AND desconto_cents >= 0 AND frete_cents >= 0 AND total_cents >= 0),
    CONSTRAINT ck_macuxi_nota_entrada_itens CHECK (qtd_itens BETWEEN 1 AND 990),
    CONSTRAINT ck_macuxi_nota_entrada_situacao CHECK (situacao IN ('autorizada', 'cancelada')),
    CONSTRAINT ck_macuxi_nota_entrada_cancelada CHECK ((situacao = 'cancelada' AND cancelada_em IS NOT NULL)
                                                       OR (situacao = 'autorizada' AND cancelada_em IS NULL))
);
GO

IF OBJECT_ID(N'dbo.macuxi_nota_entrada_item', N'U') IS NULL
CREATE TABLE dbo.macuxi_nota_entrada_item (
    chave                 char(44)      NOT NULL CONSTRAINT fk_macuxi_nota_entrada_item_nota REFERENCES dbo.macuxi_nota_entrada (chave),
    sequencia             int           NOT NULL,
    produto_external_id   varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    quantidade            decimal(18,6) NOT NULL,
    unidade               varchar(6)    NOT NULL,
    preco_unitario_cents  bigint        NOT NULL,
    desconto_cents        bigint        NOT NULL CONSTRAINT df_macuxi_nota_entrada_item_desc DEFAULT (0),
    total_cents           bigint        NOT NULL,
    cfop                  char(4)       NOT NULL,
    ncm                   char(8)       NOT NULL,
    recebido_em           datetime2(3)  NOT NULL CONSTRAINT df_macuxi_nota_entrada_item_recebido DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT pk_macuxi_nota_entrada_item PRIMARY KEY (chave, sequencia),
    CONSTRAINT ck_macuxi_nota_entrada_item_seq CHECK (sequencia >= 1),
    CONSTRAINT ck_macuxi_nota_entrada_item_qtd CHECK (quantidade > 0),
    CONSTRAINT ck_macuxi_nota_entrada_item_valores CHECK (preco_unitario_cents >= 0 AND desconto_cents >= 0 AND total_cents >= 0),
    CONSTRAINT ck_macuxi_nota_entrada_item_cfop CHECK (cfop LIKE '[1-7][0-9][0-9][0-9]'),
    CONSTRAINT ck_macuxi_nota_entrada_item_ncm CHECK (ncm LIKE REPLICATE('[0-9]', 8))
);
GO

/* Pré-cadastro de cliente feito no FDV (dono de `cliente` = banco do cliente, ADR 0014 §13 e §14).
   O ERP do cliente cria o cadastro em tha_cliente e marca aqui o external_id (status `vinculado`) ou recusa (`rejeitado`). */
IF OBJECT_ID(N'dbo.macuxi_cliente_entrada', N'U') IS NULL
CREATE TABLE dbo.macuxi_cliente_entrada (
    id                    bigint IDENTITY(1, 1) NOT NULL CONSTRAINT pk_macuxi_cliente_entrada PRIMARY KEY,
    cliente_uuid          uniqueidentifier NOT NULL CONSTRAINT uq_macuxi_cliente_entrada_uuid UNIQUE,
    razao_social          nvarchar(60)  NOT NULL,
    nome_fantasia         nvarchar(60)  NULL,
    documento             varchar(14)   NOT NULL,
    inscricao_estadual    varchar(20)   NULL,
    vendedor_external_id  varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NULL,
    filial_external_id    varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NOT NULL,
    logradouro            nvarchar(60)  NULL,
    numero                nvarchar(20)  NULL,
    complemento           nvarchar(60)  NULL,
    bairro                nvarchar(60)  NULL,
    cidade                nvarchar(60)  NULL,
    uf                    char(2)       NULL,
    cep                   char(8)       NULL,
    telefone              nvarchar(30)  NULL,
    email                 nvarchar(254) NULL,
    observacao            nvarchar(500) NULL,
    criado_em             datetime2(3)  NOT NULL,   -- UTC, no FDV
    status                varchar(10)   NOT NULL CONSTRAINT df_macuxi_cliente_entrada_status DEFAULT ('pendente'),
    external_id           varchar(200) COLLATE Latin1_General_100_BIN2_UTF8 NULL,   -- o do tha_cliente, quando vinculado
    motivo                nvarchar(300) NULL,
    recebido_em           datetime2(3)  NOT NULL CONSTRAINT df_macuxi_cliente_entrada_recebido DEFAULT (SYSUTCDATETIME()),
    alterado_em           datetime2(3)  NOT NULL CONSTRAINT df_macuxi_cliente_entrada_alterado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT ck_macuxi_cliente_entrada_status CHECK (status IN ('pendente', 'vinculado', 'rejeitado')),
    CONSTRAINT ck_macuxi_cliente_entrada_vinculo CHECK ((status = 'vinculado' AND external_id IS NOT NULL)
                                                       OR (status <> 'vinculado' AND external_id IS NULL)),
    CONSTRAINT ck_macuxi_cliente_entrada_documento CHECK (documento LIKE REPLICATE('[0-9]', 11) OR documento LIKE REPLICATE('[0-9]', 14)),
    CONSTRAINT ck_macuxi_cliente_entrada_uf CHECK (uf IS NULL OR uf COLLATE Latin1_General_100_BIN2 LIKE '[A-Z][A-Z]'),
    CONSTRAINT ck_macuxi_cliente_entrada_cep CHECK (cep IS NULL OR cep LIKE REPLICATE('[0-9]', 8))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.macuxi_pedido_entrada') AND name = N'ix_macuxi_pedido_entrada_cursor')
    CREATE INDEX ix_macuxi_pedido_entrada_cursor ON dbo.macuxi_pedido_entrada (alterado_em, pedido_uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.macuxi_pedido_nota_item') AND name = N'ix_macuxi_pedido_nota_item_cursor')
    CREATE INDEX ix_macuxi_pedido_nota_item_cursor ON dbo.macuxi_pedido_nota_item (alterado_em, pedido_numero, sequencia);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.macuxi_cliente_entrada') AND name = N'ix_macuxi_cliente_entrada_cursor')
    CREATE INDEX ix_macuxi_cliente_entrada_cursor ON dbo.macuxi_cliente_entrada (alterado_em, cliente_uuid);
GO

/* ===================================================================================================================
   4. Views do retorno (sobem pelo ciclo de status do Conector)
   =================================================================================================================== */

CREATE OR ALTER VIEW dbo.vw_macuxi_pedido_status AS
SELECT LOWER(CONVERT(varchar(36), p.pedido_uuid)) AS external_id,
       p.pedido_uuid,
       CONVERT(varchar(30), p.numero) AS numero_erp,
       p.status,
       p.motivo,
       p.nota_numero,
       p.nota_serie,
       p.nota_chave,
       p.nota_emitida_em,
       p.nota_total_cents,
       p.alterado_em
FROM dbo.macuxi_pedido_entrada AS p
WHERE p.status <> 'recebido';
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_pedido_nota_item AS
SELECT p.pedido_uuid, i.sequencia, i.produto_external_id, i.quantidade, i.valor_cents, i.alterado_em
FROM dbo.macuxi_pedido_nota_item AS i
JOIN dbo.macuxi_pedido_entrada AS p ON p.numero = i.pedido_numero;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_cliente_retorno AS
SELECT LOWER(CONVERT(varchar(36), c.cliente_uuid)) AS chave,
       c.cliente_uuid,
       c.status,
       c.external_id,
       c.motivo,
       c.alterado_em
FROM dbo.macuxi_cliente_entrada AS c
WHERE c.status <> 'pendente';
GO

/* ===================================================================================================================
   5. Procedures de descida (o Conector executa): dbo.sp_macuxi_*
      Idempotentes pela chave do que desce (pedido_uuid, chave da nota, cliente_uuid): a mesma chamada repetida não
      muda nada e devolve o mesmo resultado; a mesma chave com conteúdo diferente é recusada (conflito).
      Todas com XACT_ABORT, transação e trava UPDLOCK/HOLDLOCK na checagem de existência (duas chamadas iguais ao
      mesmo tempo não gravam duas vezes). Sem SQL dinâmico: o acesso às tabelas vem só pelo encadeamento de dono (dbo).
   =================================================================================================================== */

CREATE OR ALTER PROCEDURE dbo.sp_macuxi_pedido_inserir
    @pedido_uuid           uniqueidentifier,
    @cliente_external_id   varchar(200),
    @vendedor_external_id  varchar(200),
    @filial_external_id    varchar(200)     = NULL,
    @prazo_external_id     varchar(200)     = NULL,
    @criado_em             datetimeoffset(3),
    @aprovado_em           datetimeoffset(3) = NULL,
    @observacao            nvarchar(500)    = NULL,
    @total_cents           bigint,
    @qtd_itens             int,
    @numero                bigint           = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @pedido_uuid IS NULL                                   THROW 51001, N'pedido_uuid obrigatório', 1;
    IF NULLIF(LTRIM(RTRIM(@cliente_external_id)), '') IS NULL  THROW 51002, N'cliente_external_id obrigatório', 1;
    IF NULLIF(LTRIM(RTRIM(@vendedor_external_id)), '') IS NULL THROW 51003, N'vendedor_external_id obrigatório', 1;
    IF @criado_em IS NULL                                     THROW 51004, N'criado_em obrigatório', 1;
    IF @total_cents IS NULL OR @total_cents < 0               THROW 51005, N'total_cents inválido', 1;
    IF @qtd_itens IS NULL OR @qtd_itens NOT BETWEEN 1 AND 500 THROW 51006, N'qtd_itens inválido', 1;

    DECLARE @criado_utc datetime2(3) = CONVERT(datetime2(3), SWITCHOFFSET(@criado_em, '+00:00'));
    DECLARE @aprovado_utc datetime2(3) = CONVERT(datetime2(3), SWITCHOFFSET(@aprovado_em, '+00:00'));
    DECLARE @inserido bit = 0;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @n bigint, @c varchar(200), @v varchar(200), @t bigint, @q int;
        SELECT @n = numero, @c = cliente_external_id, @v = vendedor_external_id, @t = total_cents, @q = qtd_itens
        FROM dbo.macuxi_pedido_entrada WITH (UPDLOCK, HOLDLOCK)
        WHERE pedido_uuid = @pedido_uuid;

        IF @n IS NOT NULL
        BEGIN
            IF @c <> @cliente_external_id OR @v <> @vendedor_external_id OR @t <> @total_cents OR @q <> @qtd_itens
                THROW 51010, N'pedido_uuid já gravado com outro conteúdo', 1;
            SET @numero = @n;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.macuxi_pedido_entrada
                (pedido_uuid, cliente_external_id, vendedor_external_id, filial_external_id, prazo_external_id,
                 criado_em, aprovado_em, observacao, total_cents, qtd_itens)
            VALUES
                (@pedido_uuid, @cliente_external_id, @vendedor_external_id, NULLIF(@filial_external_id, ''),
                 NULLIF(@prazo_external_id, ''), @criado_utc, @aprovado_utc, @observacao, @total_cents, @qtd_itens);
            SET @numero = SCOPE_IDENTITY();
            SET @inserido = 1;
        END;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT @numero AS numero, @inserido AS inserido;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_macuxi_pedido_item_inserir
    @pedido_uuid           uniqueidentifier,
    @sequencia             int,
    @produto_external_id   varchar(200),
    @quantidade            decimal(18,6),
    @unidade               varchar(6)     = NULL,
    @fator                 decimal(18,6)  = NULL,
    @quantidade_venda      decimal(18,6)  = NULL,
    @preco_unitario_cents  bigint,
    @desconto_cents        bigint         = 0,
    @total_cents           bigint,
    @aplicacao             nvarchar(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @pedido_uuid IS NULL                                     THROW 51021, N'pedido_uuid obrigatório', 1;
    IF @sequencia IS NULL OR @sequencia < 1                     THROW 51022, N'sequencia inválida', 1;
    IF NULLIF(LTRIM(RTRIM(@produto_external_id)), '') IS NULL    THROW 51023, N'produto_external_id obrigatório', 1;
    IF @quantidade IS NULL OR @quantidade <= 0                  THROW 51024, N'quantidade inválida', 1;
    IF @fator IS NOT NULL AND @fator <= 0                       THROW 51025, N'fator inválido', 1;
    IF @preco_unitario_cents IS NULL OR @preco_unitario_cents < 0 THROW 51026, N'preco_unitario_cents inválido', 1;
    IF @desconto_cents IS NULL OR @desconto_cents < 0           THROW 51027, N'desconto_cents inválido', 1;
    IF @total_cents IS NULL OR @total_cents < 0                 THROW 51028, N'total_cents inválido', 1;

    DECLARE @inserido bit = 0;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @num bigint, @qtd_itens int, @status varchar(20);
        SELECT @num = numero, @qtd_itens = qtd_itens, @status = status
        FROM dbo.macuxi_pedido_entrada WITH (UPDLOCK, HOLDLOCK)
        WHERE pedido_uuid = @pedido_uuid;

        IF @num IS NULL                  THROW 51030, N'pedido_uuid não gravado: chame sp_macuxi_pedido_inserir antes', 1;
        IF @sequencia > @qtd_itens       THROW 51031, N'sequencia acima de qtd_itens do pedido', 1;

        DECLARE @p varchar(200), @q decimal(18,6), @pu bigint, @tot bigint;
        SELECT @p = produto_external_id, @q = quantidade, @pu = preco_unitario_cents, @tot = total_cents
        FROM dbo.macuxi_pedido_entrada_item WITH (UPDLOCK, HOLDLOCK)
        WHERE pedido_numero = @num AND sequencia = @sequencia;

        IF @p IS NOT NULL
        BEGIN
            IF @p <> @produto_external_id OR @q <> @quantidade OR @pu <> @preco_unitario_cents OR @tot <> @total_cents
                THROW 51032, N'item já gravado com outro conteúdo', 1;
        END
        ELSE
        BEGIN
            IF @status <> 'recebido' THROW 51033, N'pedido já processado pelo ERP do cliente: item novo recusado', 1;
            INSERT INTO dbo.macuxi_pedido_entrada_item
                (pedido_numero, sequencia, produto_external_id, quantidade, unidade, fator, quantidade_venda,
                 preco_unitario_cents, desconto_cents, total_cents, aplicacao)
            VALUES
                (@num, @sequencia, @produto_external_id, @quantidade, NULLIF(@unidade, ''), @fator, @quantidade_venda,
                 @preco_unitario_cents, @desconto_cents, @total_cents, @aplicacao);
            SET @inserido = 1;
        END;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT @num AS numero, @sequencia AS sequencia, @inserido AS inserido;
END;
GO

/* Grava a nota que desce (faturamento ligado) ou atualiza a situação (autorizada → cancelada). Os dados da nota
   autorizada não mudam: a mesma chave com outro número, série, data ou total é recusada. */
CREATE OR ALTER PROCEDURE dbo.sp_macuxi_nota_inserir
    @chave                 char(44),
    @modelo                tinyint          = 55,
    @serie                 int,
    @numero                int,
    @emitida_em            datetimeoffset(3),
    @pedido_uuid           uniqueidentifier = NULL,
    @filial_external_id    varchar(200),
    @cliente_external_id   varchar(200),
    @valor_produtos_cents  bigint,
    @desconto_cents        bigint           = 0,
    @frete_cents           bigint           = 0,
    @total_cents           bigint,
    @qtd_itens             int,
    @situacao              varchar(10)      = 'autorizada',
    @cancelada_em          datetimeoffset(3) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @chave IS NULL OR @chave NOT LIKE REPLICATE('[0-9]', 44)    THROW 52001, N'chave inválida', 1;
    IF @modelo IS NULL OR @modelo <> 55                             THROW 52002, N'modelo inválido', 1;
    IF @serie IS NULL OR @serie NOT BETWEEN 0 AND 999               THROW 52003, N'serie inválida', 1;
    IF @numero IS NULL OR @numero NOT BETWEEN 1 AND 999999999       THROW 52004, N'numero inválido', 1;
    IF @emitida_em IS NULL                                          THROW 52005, N'emitida_em obrigatório', 1;
    IF NULLIF(LTRIM(RTRIM(@filial_external_id)), '') IS NULL         THROW 52006, N'filial_external_id obrigatório', 1;
    IF NULLIF(LTRIM(RTRIM(@cliente_external_id)), '') IS NULL        THROW 52007, N'cliente_external_id obrigatório', 1;
    IF @valor_produtos_cents IS NULL OR @valor_produtos_cents < 0
       OR @desconto_cents IS NULL OR @desconto_cents < 0
       OR @frete_cents IS NULL OR @frete_cents < 0
       OR @total_cents IS NULL OR @total_cents < 0                  THROW 52008, N'valores inválidos', 1;
    IF @qtd_itens IS NULL OR @qtd_itens NOT BETWEEN 1 AND 990       THROW 52009, N'qtd_itens inválido', 1;
    IF @situacao IS NULL OR @situacao NOT IN ('autorizada', 'cancelada') THROW 52010, N'situacao inválida', 1;
    IF @situacao = 'cancelada' AND @cancelada_em IS NULL            THROW 52011, N'cancelada_em obrigatório na nota cancelada', 1;
    IF SUBSTRING(@chave, 21, 2) <> '55' OR CONVERT(int, SUBSTRING(@chave, 23, 3)) <> @serie
       OR CONVERT(int, SUBSTRING(@chave, 26, 9)) <> @numero        THROW 52012, N'chave não confere com modelo, serie e numero', 1;

    DECLARE @emitida_utc datetime2(3) = CONVERT(datetime2(3), SWITCHOFFSET(@emitida_em, '+00:00'));
    DECLARE @cancelada_utc datetime2(3) = CONVERT(datetime2(3), SWITCHOFFSET(@cancelada_em, '+00:00'));
    DECLARE @acao varchar(10) = 'nenhuma';

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @s int, @n int, @e datetime2(3), @t bigint, @f varchar(200), @q int, @sit varchar(10);
        SELECT @s = serie, @n = numero, @e = emitida_em, @t = total_cents, @f = filial_external_id, @q = qtd_itens, @sit = situacao
        FROM dbo.macuxi_nota_entrada WITH (UPDLOCK, HOLDLOCK)
        WHERE chave = @chave;

        IF @s IS NULL
        BEGIN
            INSERT INTO dbo.macuxi_nota_entrada
                (chave, modelo, serie, numero, emitida_em, pedido_uuid, filial_external_id, cliente_external_id,
                 valor_produtos_cents, desconto_cents, frete_cents, total_cents, qtd_itens, situacao, cancelada_em)
            VALUES
                (@chave, @modelo, @serie, @numero, @emitida_utc, @pedido_uuid, @filial_external_id, @cliente_external_id,
                 @valor_produtos_cents, @desconto_cents, @frete_cents, @total_cents, @qtd_itens, @situacao,
                 CASE WHEN @situacao = 'cancelada' THEN @cancelada_utc END);
            SET @acao = 'inserida';
        END
        ELSE
        BEGIN
            IF @s <> @serie OR @n <> @numero OR @e <> @emitida_utc OR @t <> @total_cents OR @f <> @filial_external_id OR @q <> @qtd_itens
                THROW 52020, N'chave já gravada com outro conteúdo: nota autorizada não muda', 1;
            IF @sit = 'cancelada' AND @situacao = 'autorizada'
                THROW 52021, N'nota cancelada não volta a autorizada', 1;
            IF @sit = 'autorizada' AND @situacao = 'cancelada'
            BEGIN
                UPDATE dbo.macuxi_nota_entrada
                SET situacao = 'cancelada', cancelada_em = @cancelada_utc, alterado_em = SYSUTCDATETIME()
                WHERE chave = @chave;
                SET @acao = 'cancelada';
            END;
        END;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT @chave AS chave, @acao AS acao;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_macuxi_nota_item_inserir
    @chave                 char(44),
    @sequencia             int,
    @produto_external_id   varchar(200),
    @quantidade            decimal(18,6),
    @unidade               varchar(6),
    @preco_unitario_cents  bigint,
    @desconto_cents        bigint = 0,
    @total_cents           bigint,
    @cfop                  char(4),
    @ncm                   char(8)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @chave IS NULL OR @chave NOT LIKE REPLICATE('[0-9]', 44)   THROW 52031, N'chave inválida', 1;
    IF @sequencia IS NULL OR @sequencia < 1                        THROW 52032, N'sequencia inválida', 1;
    IF NULLIF(LTRIM(RTRIM(@produto_external_id)), '') IS NULL       THROW 52033, N'produto_external_id obrigatório', 1;
    IF @quantidade IS NULL OR @quantidade <= 0                     THROW 52034, N'quantidade inválida', 1;
    IF NULLIF(LTRIM(RTRIM(@unidade)), '') IS NULL                   THROW 52035, N'unidade obrigatória', 1;
    IF @preco_unitario_cents IS NULL OR @preco_unitario_cents < 0
       OR @desconto_cents IS NULL OR @desconto_cents < 0
       OR @total_cents IS NULL OR @total_cents < 0                 THROW 52036, N'valores inválidos', 1;
    IF @cfop IS NULL OR @cfop NOT LIKE '[1-7][0-9][0-9][0-9]'      THROW 52037, N'cfop inválido', 1;
    IF @ncm IS NULL OR @ncm NOT LIKE REPLICATE('[0-9]', 8)         THROW 52038, N'ncm inválido', 1;

    DECLARE @inserido bit = 0;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @qtd_itens int;
        SELECT @qtd_itens = qtd_itens FROM dbo.macuxi_nota_entrada WITH (UPDLOCK, HOLDLOCK) WHERE chave = @chave;
        IF @qtd_itens IS NULL      THROW 52040, N'chave não gravada: chame sp_macuxi_nota_inserir antes', 1;
        IF @sequencia > @qtd_itens THROW 52041, N'sequencia acima de qtd_itens da nota', 1;

        DECLARE @p varchar(200), @q decimal(18,6), @pu bigint, @tot bigint, @cf char(4);
        SELECT @p = produto_external_id, @q = quantidade, @pu = preco_unitario_cents, @tot = total_cents, @cf = cfop
        FROM dbo.macuxi_nota_entrada_item WITH (UPDLOCK, HOLDLOCK)
        WHERE chave = @chave AND sequencia = @sequencia;

        IF @p IS NOT NULL
        BEGIN
            IF @p <> @produto_external_id OR @q <> @quantidade OR @pu <> @preco_unitario_cents OR @tot <> @total_cents OR @cf <> @cfop
                THROW 52042, N'item já gravado com outro conteúdo', 1;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.macuxi_nota_entrada_item
                (chave, sequencia, produto_external_id, quantidade, unidade, preco_unitario_cents, desconto_cents, total_cents, cfop, ncm)
            VALUES
                (@chave, @sequencia, @produto_external_id, @quantidade, @unidade, @preco_unitario_cents, @desconto_cents, @total_cents, @cfop, @ncm);
            SET @inserido = 1;
        END;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT @chave AS chave, @sequencia AS sequencia, @inserido AS inserido;
END;
GO

/* Pré-cadastro de cliente que desce do ERP (origem: FDV). O ERP do cliente decide e cria o cadastro em tha_cliente;
   o cadastro volta como cadastro normal pela vw_macuxi_cliente, e o vínculo pela vw_macuxi_cliente_retorno. */
CREATE OR ALTER PROCEDURE dbo.sp_macuxi_cliente_inserir
    @cliente_uuid          uniqueidentifier,
    @razao_social          nvarchar(60),
    @nome_fantasia         nvarchar(60)  = NULL,
    @documento             varchar(14),
    @inscricao_estadual    varchar(20)   = NULL,
    @vendedor_external_id  varchar(200)  = NULL,
    @filial_external_id    varchar(200),
    @logradouro            nvarchar(60)  = NULL,
    @numero                nvarchar(20)  = NULL,
    @complemento           nvarchar(60)  = NULL,
    @bairro                nvarchar(60)  = NULL,
    @cidade                nvarchar(60)  = NULL,
    @uf                    char(2)       = NULL,
    @cep                   char(8)       = NULL,
    @telefone              nvarchar(30)  = NULL,
    @email                 nvarchar(254) = NULL,
    @observacao            nvarchar(500) = NULL,
    @criado_em             datetimeoffset(3),
    @id                    bigint        = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @cliente_uuid IS NULL                                     THROW 53001, N'cliente_uuid obrigatório', 1;
    IF NULLIF(LTRIM(RTRIM(@razao_social)), N'') IS NULL           THROW 53002, N'razao_social obrigatória', 1;
    IF @documento IS NULL OR NOT (@documento LIKE REPLICATE('[0-9]', 11) OR @documento LIKE REPLICATE('[0-9]', 14))
                                                                 THROW 53003, N'documento inválido (11 ou 14 dígitos)', 1;
    IF NULLIF(LTRIM(RTRIM(@filial_external_id)), '') IS NULL      THROW 53004, N'filial_external_id obrigatório', 1;
    IF @uf IS NOT NULL AND @uf COLLATE Latin1_General_100_BIN2 NOT LIKE '[A-Z][A-Z]'             THROW 53005, N'uf inválida', 1;
    IF @cep IS NOT NULL AND @cep NOT LIKE REPLICATE('[0-9]', 8)  THROW 53006, N'cep inválido', 1;
    IF @email IS NOT NULL AND @email NOT LIKE N'%_@_%._%'        THROW 53007, N'email inválido', 1;
    IF @criado_em IS NULL                                        THROW 53008, N'criado_em obrigatório', 1;

    DECLARE @criado_utc datetime2(3) = CONVERT(datetime2(3), SWITCHOFFSET(@criado_em, '+00:00'));
    DECLARE @inserido bit = 0;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @i bigint, @r nvarchar(60), @d varchar(14), @f varchar(200);
        SELECT @i = id, @r = razao_social, @d = documento, @f = filial_external_id
        FROM dbo.macuxi_cliente_entrada WITH (UPDLOCK, HOLDLOCK)
        WHERE cliente_uuid = @cliente_uuid;

        IF @i IS NOT NULL
        BEGIN
            IF @r <> @razao_social OR @d <> @documento OR @f <> @filial_external_id
                THROW 53010, N'cliente_uuid já gravado com outro conteúdo', 1;
            SET @id = @i;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.macuxi_cliente_entrada
                (cliente_uuid, razao_social, nome_fantasia, documento, inscricao_estadual, vendedor_external_id,
                 filial_external_id, logradouro, numero, complemento, bairro, cidade, uf, cep, telefone, email,
                 observacao, criado_em)
            VALUES
                (@cliente_uuid, LTRIM(RTRIM(@razao_social)), @nome_fantasia, @documento, @inscricao_estadual,
                 NULLIF(@vendedor_external_id, ''), @filial_external_id, @logradouro, @numero, @complemento, @bairro,
                 @cidade, @uf, @cep, @telefone, @email, @observacao, @criado_utc);
            SET @id = SCOPE_IDENTITY();
            SET @inserido = 1;
        END;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT @id AS id, @inserido AS inserido;
END;
GO

/* ===================================================================================================================
   6. Simulação do ERP do cliente (só para o teste na VM): dbo.sp_tha_*
      Quem roda é o sa, pela sessão da VM. O macuxi_conector NÃO tem EXECUTE nestas.
   =================================================================================================================== */

/* Ciclo de status do pedido: recebido → integrado | rejeitado_erp | cancelado; integrado → faturado_parcial | faturado_total |
   cancelado; faturado_parcial → faturado_parcial | faturado_total | cancelado. Repetir o mesmo status não muda nada. */
CREATE OR ALTER PROCEDURE dbo.sp_tha_pedido_status_definir
    @pedido_uuid       uniqueidentifier,
    @status            varchar(20),
    @motivo            nvarchar(300)     = NULL,
    @nota_numero       int               = NULL,
    @nota_serie        int               = NULL,
    @nota_chave        char(44)          = NULL,
    @nota_emitida_em   datetimeoffset(3) = NULL,
    @nota_total_cents  bigint            = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @pedido_uuid IS NULL THROW 54001, N'pedido_uuid obrigatório', 1;
    IF @status IS NULL OR @status NOT IN ('integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado')
        THROW 54002, N'status inválido', 1;
    IF @status IN ('faturado_parcial', 'faturado_total')
       AND (@nota_numero IS NULL OR @nota_serie IS NULL OR @nota_chave IS NULL OR @nota_emitida_em IS NULL OR @nota_total_cents IS NULL)
        THROW 54003, N'faturado exige os dados da nota', 1;
    IF @status IN ('rejeitado_erp', 'cancelado') AND NULLIF(LTRIM(RTRIM(@motivo)), N'') IS NULL
        THROW 54004, N'motivo obrigatório', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @atual varchar(20);
        SELECT @atual = status FROM dbo.macuxi_pedido_entrada WITH (UPDLOCK, HOLDLOCK) WHERE pedido_uuid = @pedido_uuid;
        IF @atual IS NULL THROW 54010, N'pedido_uuid não encontrado', 1;

        IF NOT (@atual = @status
                OR (@atual = 'recebido' AND @status IN ('integrado', 'rejeitado_erp', 'cancelado'))
                OR (@atual = 'integrado' AND @status IN ('faturado_parcial', 'faturado_total', 'cancelado'))
                OR (@atual = 'faturado_parcial' AND @status IN ('faturado_total', 'cancelado')))
            THROW 54011, N'transição de status não permitida', 1;

        IF @atual <> @status OR @status = 'faturado_parcial'
            UPDATE dbo.macuxi_pedido_entrada
            SET status = @status,
                motivo = @motivo,
                nota_numero = COALESCE(@nota_numero, nota_numero),
                nota_serie = COALESCE(@nota_serie, nota_serie),
                nota_chave = COALESCE(@nota_chave, nota_chave),
                nota_emitida_em = COALESCE(CONVERT(datetime2(3), SWITCHOFFSET(@nota_emitida_em, '+00:00')), nota_emitida_em),
                nota_total_cents = COALESCE(@nota_total_cents, nota_total_cents),
                alterado_em = SYSUTCDATETIME()
            WHERE pedido_uuid = @pedido_uuid;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

/* Item faturado (sobe pela vw_macuxi_pedido_nota_item). Regrava o mesmo item com a quantidade e o valor novos. */
CREATE OR ALTER PROCEDURE dbo.sp_tha_pedido_nota_item_gravar
    @pedido_uuid          uniqueidentifier,
    @sequencia            int,
    @quantidade           decimal(18,6),
    @valor_cents          bigint
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @pedido_uuid IS NULL                     THROW 54021, N'pedido_uuid obrigatório', 1;
    IF @sequencia IS NULL OR @sequencia < 1     THROW 54022, N'sequencia inválida', 1;
    IF @quantidade IS NULL OR @quantidade <= 0  THROW 54023, N'quantidade inválida', 1;
    IF @valor_cents IS NULL OR @valor_cents < 0 THROW 54024, N'valor_cents inválido', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @num bigint, @produto varchar(200);
        SELECT @num = p.numero, @produto = i.produto_external_id
        FROM dbo.macuxi_pedido_entrada AS p WITH (UPDLOCK, HOLDLOCK)
        LEFT JOIN dbo.macuxi_pedido_entrada_item AS i ON i.pedido_numero = p.numero AND i.sequencia = @sequencia
        WHERE p.pedido_uuid = @pedido_uuid;
        IF @num IS NULL     THROW 54030, N'pedido_uuid não encontrado', 1;
        IF @produto IS NULL THROW 54031, N'item do pedido não encontrado', 1;

        MERGE dbo.macuxi_pedido_nota_item WITH (HOLDLOCK) AS t
        USING (SELECT @num AS pedido_numero, @sequencia AS sequencia) AS s
           ON t.pedido_numero = s.pedido_numero AND t.sequencia = s.sequencia
        WHEN MATCHED AND (t.quantidade <> @quantidade OR t.valor_cents <> @valor_cents) THEN
            UPDATE SET quantidade = @quantidade, valor_cents = @valor_cents, alterado_em = SYSUTCDATETIME()
        WHEN NOT MATCHED BY TARGET THEN
            INSERT (pedido_numero, sequencia, produto_external_id, quantidade, valor_cents)
            VALUES (@num, @sequencia, @produto, @quantidade, @valor_cents);

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

/* Decide o pré-cadastro: com @external_id (que já precisa existir em tha_cliente) → vinculado; sem ele, com
   @motivo → rejeitado. Decisão tomada não muda (repetir a mesma é aceito sem mudar nada). */
CREATE OR ALTER PROCEDURE dbo.sp_tha_cliente_pre_cadastro_resolver
    @cliente_uuid  uniqueidentifier,
    @external_id   varchar(200)  = NULL,
    @motivo        nvarchar(300) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @cliente_uuid IS NULL THROW 54041, N'cliente_uuid obrigatório', 1;
    SET @external_id = NULLIF(LTRIM(RTRIM(@external_id)), '');
    IF @external_id IS NULL AND NULLIF(LTRIM(RTRIM(@motivo)), N'') IS NULL
        THROW 54042, N'informe external_id (vincular) ou motivo (rejeitar)', 1;
    IF @external_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tha_cliente WHERE external_id = @external_id)
        THROW 54043, N'external_id não existe em tha_cliente: crie o cadastro antes', 1;

    DECLARE @novo varchar(10) = CASE WHEN @external_id IS NOT NULL THEN 'vinculado' ELSE 'rejeitado' END;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @atual varchar(10), @ext varchar(200);
        SELECT @atual = status, @ext = external_id
        FROM dbo.macuxi_cliente_entrada WITH (UPDLOCK, HOLDLOCK) WHERE cliente_uuid = @cliente_uuid;
        IF @atual IS NULL THROW 54050, N'cliente_uuid não encontrado', 1;

        IF @atual = 'pendente'
            UPDATE dbo.macuxi_cliente_entrada
            SET status = @novo, external_id = @external_id,
                motivo = CASE WHEN @novo = 'rejeitado' THEN @motivo END, alterado_em = SYSUTCDATETIME()
            WHERE cliente_uuid = @cliente_uuid;
        ELSE IF @atual <> @novo OR ISNULL(@ext, '') <> ISNULL(@external_id, '')
            THROW 54051, N'pré-cadastro já decidido de outro jeito', 1;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

/* ===================================================================================================================
   7. Login e usuário do Conector: macuxi_conector (mínimo privilégio)
      - SELECT só nas views dbo.vw_macuxi_*; EXECUTE só nas dbo.sp_macuxi_*;
      - nenhuma permissão nas tabelas (o acesso vem pelo encadeamento de dono das views e procedures dbo);
      - sem papel de banco nem de servidor; reexecutar troca a senha e reaplica as permissões (tira as que sobrarem).
   =================================================================================================================== */

USE master;
GO

DECLARE @senha nvarchar(128) = N'$(SENHA_CONECTOR)';
IF LEN(@senha) < 16
    THROW 55001, N'SENHA_CONECTOR vazia ou curta (mínimo 16 caracteres)', 1;

DECLARE @sql nvarchar(max);
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'macuxi_conector')
    SET @sql = N'CREATE LOGIN macuxi_conector WITH PASSWORD = ' + QUOTENAME(@senha, N'''')
             + N', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = ERP_THATHYANY;';
ELSE
    SET @sql = N'ALTER LOGIN macuxi_conector WITH PASSWORD = ' + QUOTENAME(@senha, N'''')
             + N', CHECK_POLICY = ON, DEFAULT_DATABASE = ERP_THATHYANY;';
EXEC (@sql);
SET @senha = NULL;
SET @sql = N'ALTER LOGIN macuxi_conector ENABLE;';
EXEC (@sql);

/* Sem papel de servidor. */
DECLARE @papel_srv sysname;
DECLARE cs CURSOR LOCAL STATIC READ_ONLY FOR
    SELECT r.name FROM sys.server_role_members AS m
    JOIN sys.server_principals AS r ON r.principal_id = m.role_principal_id
    JOIN sys.server_principals AS u ON u.principal_id = m.member_principal_id
    WHERE u.name = N'macuxi_conector';
OPEN cs;
FETCH NEXT FROM cs INTO @papel_srv;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'ALTER SERVER ROLE ' + QUOTENAME(@papel_srv) + N' DROP MEMBER macuxi_conector;';
    EXEC (@sql);
    FETCH NEXT FROM cs INTO @papel_srv;
END;
CLOSE cs;
DEALLOCATE cs;
GO

USE ERP_THATHYANY;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'macuxi_conector')
    CREATE USER macuxi_conector FOR LOGIN macuxi_conector WITH DEFAULT_SCHEMA = dbo;
ELSE
    ALTER USER macuxi_conector WITH LOGIN = macuxi_conector, DEFAULT_SCHEMA = dbo;
GO

DECLARE @sql nvarchar(max), @nome sysname;

/* 7a. Sem papel de banco (nada de db_datareader, que leria as tha_*). */
DECLARE cr CURSOR LOCAL STATIC READ_ONLY FOR
    SELECT r.name FROM sys.database_role_members AS m
    JOIN sys.database_principals AS r ON r.principal_id = m.role_principal_id
    WHERE m.member_principal_id = DATABASE_PRINCIPAL_ID(N'macuxi_conector');
OPEN cr;
FETCH NEXT FROM cr INTO @nome;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'ALTER ROLE ' + QUOTENAME(@nome) + N' DROP MEMBER macuxi_conector;';
    EXEC (@sql);
    FETCH NEXT FROM cr INTO @nome;
END;
CLOSE cr;
DEALLOCATE cr;

/* 7b. Tira toda permissão de objeto que não seja SELECT em vw_macuxi_* ou EXECUTE em sp_macuxi_* (e qualquer
       permissão de schema ou de banco além de CONNECT). */
DECLARE cp CURSOR LOCAL STATIC READ_ONLY FOR
    SELECT CASE p.class
               WHEN 1 THEN N'REVOKE ' + p.permission_name + N' ON ' + QUOTENAME(OBJECT_SCHEMA_NAME(p.major_id)) + N'.'
                         + QUOTENAME(OBJECT_NAME(p.major_id)) + N' FROM macuxi_conector CASCADE;'
               WHEN 3 THEN N'REVOKE ' + p.permission_name + N' ON SCHEMA::' + QUOTENAME(SCHEMA_NAME(p.major_id))
                         + N' FROM macuxi_conector CASCADE;'
               WHEN 0 THEN N'REVOKE ' + p.permission_name + N' FROM macuxi_conector CASCADE;'
           END
    FROM sys.database_permissions AS p
    LEFT JOIN sys.objects AS o ON p.class = 1 AND o.object_id = p.major_id
    WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'macuxi_conector')
      AND p.class IN (0, 1, 3)
      AND NOT (p.class = 0 AND p.permission_name = N'CONNECT')
      AND NOT (p.class = 1 AND p.state IN ('G') AND p.minor_id = 0 AND SCHEMA_NAME(o.schema_id) = N'dbo'
               AND ((o.type = 'V' AND p.permission_name = N'SELECT' AND o.name LIKE N'vw[_]macuxi[_]%')
                 OR (o.type = 'P' AND p.permission_name = N'EXECUTE' AND o.name LIKE N'sp[_]macuxi[_]%')));
OPEN cp;
FETCH NEXT FROM cp INTO @sql;
WHILE @@FETCH_STATUS = 0
BEGIN
    EXEC (@sql);
    FETCH NEXT FROM cp INTO @sql;
END;
CLOSE cp;
DEALLOCATE cp;

/* 7c. SELECT nas views dbo.vw_macuxi_* e EXECUTE nas dbo.sp_macuxi_*. */
DECLARE cg CURSOR LOCAL FAST_FORWARD FOR
    SELECT CASE o.type WHEN 'V' THEN N'GRANT SELECT ON dbo.' ELSE N'GRANT EXECUTE ON dbo.' END
           + QUOTENAME(o.name) + N' TO macuxi_conector;'
    FROM sys.objects AS o
    WHERE o.schema_id = SCHEMA_ID(N'dbo')
      AND ((o.type = 'V' AND o.name LIKE N'vw[_]macuxi[_]%') OR (o.type = 'P' AND o.name LIKE N'sp[_]macuxi[_]%'));
OPEN cg;
FETCH NEXT FROM cg INTO @sql;
WHILE @@FETCH_STATUS = 0
BEGIN
    EXEC (@sql);
    FETCH NEXT FROM cg INTO @sql;
END;
CLOSE cg;
DEALLOCATE cg;
GO

/* Resumo (sem dado): o que o macuxi_conector pode fazer. */
SELECT o.type_desc AS tipo, o.name AS objeto, p.permission_name AS permissao
FROM sys.database_permissions AS p
JOIN sys.objects AS o ON o.object_id = p.major_id
WHERE p.class = 1 AND p.grantee_principal_id = DATABASE_PRINCIPAL_ID(N'macuxi_conector')
ORDER BY o.type_desc, o.name;
GO

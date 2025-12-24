https://api-publica.datajud.cnj.jus.br
Acesso
A API Pública do Datajud é uma ferramenta que disponibiliza ao público o acesso aos metadados dos processos públicos dos tribunais do judiciário brasileiro. Os dados disponibilizados pela API são de origem da Base Nacional de Dados do Poder Judiciário – Datajud e atendem aos critérios estabelecidos Portaria Nº 160 de 09/09/2020.

API Key
A autenticação da API Pública do Datajud é realizada através de uma Chave Pública, gerada e disponibilizada pelo DPJ/CNJ. A chave vigente estará sempre acessível nesta seção da Wiki, garantindo transparência e facilitando seu acesso. Importante ressaltar que, por razões de segurança e gestão do sistema, a chave poderá ser alterada pelo CNJ a qualquer momento.

Para incorporar a API Key em suas requisições, utilize o formato "Authorization: APIKey [Chave Pública]" no cabeçalho da requisição.

APIKey atual:
Authorization: APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==
Consulta de processos vinculados a OAB
Esta seção da API permite consultar os números de processos (CNJ) vinculados a monitoramentos realizados com base em OABs, além de realizar buscas específicas por OAB ou número de processo. É útil para sistemas que precisam rastrear ou listar processos judiciais monitorados por advogados.

Listar os CNJs vinculados à OAB monitorada
Retorna uma lista completa de CNJs vinculados a monitoramentos de OAB.

cURL

curl -X 'GET' \
    'https://op.digesto.com.br/api/monitoramento/oab/vinculos/processos/?page=1&per_page=10' \
    -H 'accept: application/json' \
    -H 'Authorization: Bearer <api_token>'
Copy code
Parâmetro

Tipo

Descrição

page

integer

Número de registros a pular (offset). Usado para paginação. Valor mínimo: 1.

per_page

integer

Número máximo de registros a retornar por página. Valor mínimo: 1. Valor máximo: 500.

Resposta

HTTP/1.1 200 OK
Content-Type: application/json

[
    {
        "id": 1,
        "cnj": "0000001-00.0000.0.00.0000",
        "tribunal": "TJSP",
        "oab_id": 1,
        "created_at": "2025-03-28T17:14:00.854804",
        "updated_at": null,
        "archived_at": null
    },
    {
        "id": 2,
        "cnj": "0000002-00.0000.0.00.0000",
        "tribunal": "TJSP",
        "oab_id": 1,
        "created_at": "2025-03-28T17:14:00.854804",
        "updated_at": null,
        "archived_at": null
    }
]
Copy code
Atributo

Tipo

Descrição

id

integer

Identificador único do processo.

cnj

string

Número do processo no formato CNJ.

tribunal

string

Sigla do tribunal onde o processo está cadastrado.

oab_id

integer

Identificador único da OAB monitorada.

created_at

string

Data e hora de criação do registro.

updated_at

string

Data e hora da última atualização do registro.

archived_at

string

Data e hora de arquivamento do registro.

Listar os CNJs vinculados a uma OAB específica
Retorna uma lista de CNJs vinculados a um monitoramento de OAB específico, identificado pelo ID da OAB ou correlation_id.

cURL

curl -X 'GET' \
  'https://op.digesto.com.br/api/monitoramento/oab/vinculos/processos/oab?<correlation_id ou oab_id>=<valor>&per_page=100&page=1' \
  -H 'accept: application/json' \
  -H 'Authorization: Bearer <api_token>'
Copy code
Parâmetro

Tipo

Descrição

correlation_id

string

Identificador único da requisição de monitoramento.

oab_id

integer

Identificador único da OAB monitorada.

per_page

integer

Número máximo de registros a retornar por página. Valor mínimo: 1. Valor máximo: 500.

page

integer

Número de registros a pular (offset). Usado para paginação. Valor mínimo: 1.

Exemplo de chamada

curl -X 'GET' \
  'https://op.digesto.com.br/api/monitoramento/oab/vinculos/processos/oab?correlation_id=28a2961d-e3e8-42b1-917b-c5185a58153e&per_page=10&page=1' \
  -H 'accept: application/json' \
  -H 'Authorization: Bearer <api_token>'
Copy code
Resposta

HTTP/1.1 200 OK
Content-Type: application/json

[
  {
    "id": 1165,
    "created_at": "2025-03-29T03:02:10.729300",
    "updated_at": null,
    "archived_at": null,
    "oab_id": 6,
    "cnj": "10013688820188260586",
    "cnj_id": 449521336
  },
  {
    "id": 1166,
    "created_at": "2025-03-29T03:02:10.729316",
    "updated_at": null,
    "archived_at": null,
    "oab_id": 6,
    "cnj": "6724520145150108",
    "cnj_id": 470389690
  },
  {
    "id": 1167,
    "created_at": "2025-03-29T03:02:10.729319",
    "updated_at": null,
    "archived_at": null,
    "oab_id": 6,
    "cnj": "37548120018260238",
    "cnj_id": 562828640
  },
  {
    "id": 1168,
    "created_at": "2025-03-29T03:02:10.729322",
    "updated_at": null,
    "archived_at": null,
    "oab_id": 6,
    "cnj": "10014291220198260586",
    "cnj_id": 606748256
  },
  {
    "id": 1169,
    "created_at": "2025-03-29T03:02:10.729325",
    "updated_at": null,
    "archived_at": null,
    "oab_id": 6,
    "cnj": "10045030220225020000",
    "cnj_id": 513229469
  },
  {
    "id": 1170,
    "created_at": "2025-03-29T03:02:10.729328",
    "updated_at": null,
    "archived_at": null,
    "oab_id": 6,
    "cnj": "570203220128260000",
    "cnj_id": 524272317
  },
  {
    "id": 1171,
    "created_at": "2025-03-29T03:02:10.729331",
    "updated_at": null,
    "archived_at": null,
    "oab_id": 6,
    "cnj": "20812705120198260000",
    "cnj_id": 524540270
  },
  {
    "id": 1172,
    "created_at": "2025-03-29T03:02:10.729334",
    "updated_at": null,
    "archived_at": null,
    "oab_id": 6,
    "cnj": "21162147920198260000",
    "cnj_id": 524751259
  },
  {
    "id": 1173,
    "created_at": "2025-03-29T03:02:10.729337",
    "updated_at": null,
    "archived_at": null,
    "oab_id": 6,
    "cnj": "10763184220168260100",
    "cnj_id": 531440751
  },
  {
    "id": 1174,
    "created_at": "2025-03-29T03:02:10.729340",
    "updated_at": null,
    "archived_at": null,
    "oab_id": 6,
    "cnj": "10017714520155020242",
    "cnj_id": 537402792
  }
]
Copy code
Atributo

Tipo

Descrição

id

integer

Identificador único do processo.

created_at

string

Data e hora de criação do registro.

updated_at

string

Data e hora da última atualização do registro.

archived_at

string

Data e hora de arquivamento do registro.

oab_id

integer

Identificador único da OAB monitorada.

cnj

string

Número do processo no formato CNJ.

cnj_id

integer

Identificador único do processo no formato CNJ.

Buscar processos vinculados a OABs pelo número CNJ
Retorna todos os processos encontrados com base no número CNJ fornecido. Este endpoint permite encontrar quais OABs estão associadas a um determinado processo judicial.

cURL

curl -X 'GET' \
    'https://op.digesto.com.br/api/monitoramento/oab/vinculos/processos/cnj?numero_cnj=<numero_cnj>&per_page=10&page=1' \
    -H 'accept: application/json' \
    -H 'Authorization: Bearer <api_token>'
Copy code
Parâmetro

Tipo

Descrição

numero_cnj

string

Número CNJ do processo.

per_page

integer

Número máximo de registros a retornar por página. Valor mínimo: 1. Valor máximo: 500.

page

integer

Número de registros a pular (offset). Usado para paginação. Valor mínimo: 1.

Exemplo de chamada

curl -X 'GET' \
    'https://op.digesto.com.br/api/monitoramento/oab/vinculos/processos/cnj?numero_cnj=10013688820188260586&per_page=10&page=1' \
    -H 'accept: application/json' \
    -H 'Authorization: Bearer <api_token>'
Copy code
Resposta

HTTP/1.1 200 OK
Content-Type: application/json

[
    {
        "id": 1165,
        "created_at": "2025-03-29T03:02:10.729300",
        "updated_at": null,
        "archived_at": null,
        "oab_id": 6,
        "cnj": "10013688820188260586",
        "cnj_id": 449521336
    },
    {
        "id": 1249,
        "created_at": "2025-03-29T03:02:10.729529",
        "updated_at": null,
        "archived_at": null,
        "oab_id": 6,
        "cnj": "10013688820188260586",
        "cnj_id": 618027635
    },
    {
        "id": 1250,
        "created_at": "2025-03-29T03:02:10.729530",
        "updated_at": null,
        "archived_at": null,
        "oab_id": 6,
        "cnj": "10013688820188260586",
        "cnj_id": 618027719
    }
]
Copy code
Atributo

Tipo

Descrição

id

integer

Identificador único do processo.

created_at

string

Data e hora de criação do registro.

updated_at

string

Data e hora da última atualização do registro.

archived_at

string

Data e hora de arquivamento do registro.

oab_id

integer

Identificador único da OAB monitorada.

cnj

string

Número do processo no formato CNJ.

cnj_id

integer

Identificador único do processo no formato CNJ.
Como identificar o projeto
Use o cabeçalho HTTP x-goog-project-id para identificar o projeto quando usar a API para criar ou listar intervalos.

x-goog-project-id
crypto-handbook-400817

Conta de serviço do Cloud Storage
Cada projeto tem uma conta de serviço do Cloud Storage associada. Ela é usada para executar determinadas ações em segundo plano: receber notificações do Pub/Sub e criptografar/descriptografar objetos criptografados do KMS.

Conta de serviço
service-58436478281@gs-project-accounts.iam.gserviceaccount.com

Códigos do Cloud Storage
Os participantes do projeto podem acessar os dados do Cloud Storage de acordo com os respectivos papéis do projeto. Para modificar outras permissões, use esses IDs de grupo para identificar os papéis.

Você
00b4903a979796b6968861ca728ad2e82994482d3613c0723319f5fe876fece6
Proprietários
00b4903a9718bb5f32e17908b2fa64981497162967350a8c73941c9c701d40fb
Editor
00b4903a977333dc70f15bb99385aeb70ea7a86ce7a419338b99eddafed42eca
Equipe
00b4903a972eb02e7f4f760acdda732db235c6638cd6aca09560ddf995ff8c3d

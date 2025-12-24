Ex. 1 - Pesquisar pelo número de processo
No exemplo abaixo é realizada a consulta de um processo judicial utilizando a numeração única do processo como parâmetro de pesquisa no tribunal do TRF1.

POST /api_publica_tribunal/_search
Postman
Python
R
Python com Requests
import requests
import json

url = "https://api-publica.datajud.cnj.jus.br/api_publica_trf1/_search"

payload = json.dumps({
  "query": {
    "match": {
      "numeroProcesso": "00008323520184013202"
    }
  }
})

#Substituir <API Key> pela Chave Pública
headers = {
  'Authorization': 'ApiKey <API Key>',
  'Content-Type': 'application/json'
}

response = requests.request("POST", url, headers=headers, data=payload)

print(response.text)

Resposta
A resposta esperado é um JSON com os metadados de 1 ou mais processos conforme o critério da busca:

JSON com os metadados processuais
{
    "took": 6679,
    "timed_out": false,
    "_shards": {
        "total": 7,
        "successful": 7,
        "skipped": 0,
        "failed": 0
    },
    "hits": {
        "total": {
            "value": 1,
            "relation": "eq"
        },
        "max_score": 13.917725,
        "hits": [
            {
                "_index": "api_publica_trf1",
                "_type": "_doc",
                "_id": "TRF1_436_JE_16403_00008323520184013202",
                "_score": 13.917725,
                "_source": {
                    "numeroProcesso": "00008323520184013202",
                    "classe": {
                        "codigo": 436,
                        "nome": "Procedimento do Juizado Especial Cível"
                    },
                    "sistema": {
                        "codigo": 1,
                        "nome": "Pje"
                    },
                    "formato": {
                        "codigo": 1,
                        "nome": "Eletrônico"
                    },
                    "tribunal": "TRF1",
                    "dataHoraUltimaAtualizacao": "2023-07-21T19:10:08.483Z",
                    "grau": "JE",
                    "@timestamp": "2023-08-14T11:50:51.994Z",
                    "dataAjuizamento": "2018-10-29T00:00:00.000Z",
                    "movimentos": [
                        {
                            "complementosTabelados": [
                                {
                                    "codigo": 2,
                                    "valor": 1,
                                    "nome": "competência exclusiva",
                                    "descricao": "tipo_de_distribuicao_redistribuicao"
                                }
                            ],
                            "codigo": 26,
                            "nome": "Distribuição",
                            "dataHora": "2018-10-30T14:06:24.000Z"
                        },
                        ...
                        {
                            "codigo": 14732,
                            "nome": "Conversão de Autos Físicos em Eletrônicos",
                            "dataHora": "2020-08-05T01:15:18.000Z"
                        }
                    ],
                    "id": "TRF1_436_JE_16403_00008323520184013202",
                    "nivelSigilo": 0,
                    "orgaoJulgador": {
                        "codigoMunicipioIBGE": 5128,
                        "codigo": 16403,
                        "nome": "JEF Adj - Tefé"
                    },
                    "assuntos": [
                        {
                            "codigo": 6177,
                            "nome": "Concessão"
                        }
                    ]
                }
            }
        ]
    }
}   
Ex. 3 - Exemplo 3: Pesquisa com paginação (search_after):
Por padrão, as pesquisas na API do Elasticsearch retornam até 10 registros por solicitação. No entanto, é possível aumentar o número de registros retornados utilizando o parâmetro "size" de paginação dos registros. Esse parâmetro permite especificar quantos resultados devem ser retornados por página, variando de 10 até 10.000 registros por página.

Quando se tem uma necessidade de percorrer uma maior quantidade de resultados, é possível fazer uso do recurso "search_after". Esse recurso é prioritariamente recomendado para paginação de dados, pois permite que a API do Datajud continue a partir do ponto onde a última página parou, sem a necessidade de recarregar todos os resultados a cada nova página. O "search_after" é um ponteiro que aponta para o último registro retornado na página anterior e pode ser informado como parâmetro para a próxima solicitação, permitindo que a API retorne os resultados seguintes.

É importante ressaltar que a utilização do "search_after" não prejudica a performance da API na busca de grandes volumes de dados, pois permite que a API do Datajud execute consultas de forma mais eficiente, sem a necessidade de recarregar todos os resultados em cada página. Combinando o uso do parâmetro "size" com o "search_after", é possível percorrer grandes volumes de dados de forma eficiente e com baixo impacto no desempenho da API.

Para paginar os resultados utilizando o search_after, é necessário a utilização da ordenação (sort) dos dados utilizando o atributo “@timestamp” conforme exemplo abaixo:

Query DSL
{
 "size": 100,
 "query": {
 "bool": {
 "must": [
  {"match": {"classe.codigo": 1116}},
  {"match": {"orgaoJulgador.codigo": 13597}}
 ]
 }
},
"sort": [
{
 "@timestamp": {
 "order": "asc"
  }
 }
 ]
}

Após a primeira consulta, a resposta da API incluirá um array chamado "sort" que contém os valores do campo de ordenação para cada documento retornado. Esse array pode ser utilizado como o valor do parâmetro "search_after" na próxima consulta, juntamente com o parâmetro "size" que define a quantidade de documentos a serem retornados na próxima página

Query DSL
{
  "_index" : "api_publica_tjdft",
  "_type" : "_doc",
  "_id" : "TJDFT_1116_G1_13597_00356079220168070018",
  "_score" : null,
  "_source" : {...},
  "sort" : [
     1681366085550
  ]
}

Para buscar os próximos 100 processos, basta adicionar o parâmetro "search_after" na próxima consulta, utilizando o valor do campo “sort” do último documento retornado na página anterior conforme exemplo abaixo:

Query DSL
{
  "size": 100,
  "query": {
  "bool": {
    "must": [
     {"match": {"classe.codigo": 1116}},
     {"match": {"orgaoJulgador.codigo": 13597}}
  ]
}
},
 "sort": [
 {
  "@timestamp": {
  "order": "asc"
  }
  }
],
  "search_after": [ 1681366085550 ]
}

Observe que o valor do campo "search_after" é um array com os valores do campo de ordenação para o último documento retornado na página anterior. É importante lembrar que o "search_after" deve ser utilizado em conjunto com o "sort" e o "size" para garantir uma paginação eficiente dos resultados.
Ex. 2 - Pesquisar por Classe Processual e Órgão Julgador
No exemplo abaixo é realizada a consulta de processos que possuam a Classe Processual 1116 – "Execução Fiscal" do Órgão Julgador 13597 - VARA DE EXECUÇÃO FISCAL DO DF no tribunal TJDFT.

POST /api_publica_tribunal/_search
Postman
Python
R
Abra o Postman e clique em "New Request".
Defina o método HTTP como POST.
Digite a URL: https://api-publica.datajud.cnj.jus.br/api_publica_tjdft/_search
Selecione a aba "Headers" e inclua a chave "Authorization" com o valor "APIKey [Chave Pública]";
O valor [Chave Pública] corresponde a chave pública disponível em Chave Pública;
Ainda em "Headers" inclua a chave "Content-Type" com o valor "application/json";
Selecione a aba "Body" e escolha a opção "raw". Insira o corpo da solicitação JSON conforme o exemplo abaixo:
Query DSL
{
    "query": {
        "bool": {
            "must": [
                {"match": {"classe.codigo": 1116}},
                {"match": {"orgaoJulgador.codigo": 13597}}
            ]
        }
    }
}

Clique em Send para enviar e aguarde a resposta da Api.
Resposta
A resposta esperado é um JSON com os metadados de 1 ou mais processos conforme o critério da busca:

JSON com os metadados processuais
{
    "took": 213,
    "timed_out": false,
    "_shards": {
        "total": 3,
        "successful": 3,
        "skipped": 0,
        "failed": 0
    },
    "hits": {
        "total": {
            "value": 10000,
            "relation": "gte"
        },
        "max_score": 2.0,
        "hits": [
            {
                "_index": "api_publica_tjdft",
                "_type": "_doc",
                "_id": "TJDFT_1116_G1_13597_07223914020178070001",
                "_score": 2.0,
                "_source": {
                    "classe": {
                        "codigo": 1116,
                        "nome": "Execução Fiscal"
                    },
                    "numeroProcesso": "07223914020178070001",
                    "sistema": {
                        "codigo": 1,
                        "nome": "Pje"
                    },
                    "formato": {
                        "codigo": 1,
                        "nome": "Eletrônico"
                    },
                    "tribunal": "TJDFT",
                    "dataHoraUltimaAtualizacao": "2022-09-06T12:03:20.257Z",
                    "grau": "G1",
                    "@timestamp": "2023-04-13T17:59:46.214Z",
                    "dataAjuizamento": "2017-08-21T10:05:32.000Z",
                    "movimentos": [
                        {
                            "complementosTabelados": [
                                {
                                    "codigo": 2,
                                    "valor": 2,
                                    "nome": "sorteio",
                                    "descricao": "tipo_de_distribuicao_redistribuicao"
                                }
                            ],
                            "codigo": 26,
                            "nome": "Distribuição",
                            "dataHora": "2017-08-21T10:05:32.000Z"
                        },
                        ...
                        {
                            "codigo": 11382,
                            "nome": "Bloqueio/penhora on line",
                            "dataHora": "2022-07-13T07:25:59.000Z"
                        },
                        {
                            "codigo": 132,
                            "nome": "Recebimento",
                            "dataHora": "2022-07-13T07:26:00.000Z"
                        }
                    ],
                    "id": "TJDFT_1116_G1_13597_07223914020178070001",
                    "nivelSigilo": 0,
                    "orgaoJulgador": {
                        "codigoMunicipioIBGE": 5300108,
                        "codigo": 13597,
                        "nome": "VARA DE EXECU??O FISCAL DO DF"
                    },
                    "assuntos": [
                        [
                            {
                                "codigo": 6017,
                                "nome": "Dívida Ativa (Execução Fiscal)"
                            }
                        ]
                    ]
                }
            },
            {
                "_index": "api_publica_tjdft",
                "_type": "_doc",
                "_id": "TJDFT_1116_G1_13597_00073039720138070015",
                "_score": 2.0,
                "_source": {
                    "classe": {
                        "codigo": 1116,
                        "nome": "Execução Fiscal"
                    },
                    "numeroProcesso": "00073039720138070015",
                    "sistema": {
                        "codigo": 1,
                        "nome": "Pje"
                    },
                    "formato": {
                        "codigo": 1,
                        "nome": "Eletrônico"
                    },
                    "tribunal": "TJDFT",
                    "dataHoraUltimaAtualizacao": "2022-09-06T17:26:23.938Z",
                    "grau": "G1",
                    "@timestamp": "2023-04-13T18:02:23.754Z",
                    "dataAjuizamento": "2019-05-30T03:17:56.000Z",
                    "movimentos": [
                        {
                            "complementosTabelados": [
                                {
                                    "codigo": 2,
                                    "valor": 1,
                                    "nome": "competência exclusiva",
                                    "descricao": "tipo_de_distribuicao_redistribuicao"
                                }
                            ],
                            "codigo": 26,
                            "nome": "Distribuição",
                            "dataHora": "2013-02-18T13:17:23.000Z"
                        },
                        ...
                        {
                            "codigo": 245,
                            "nome": "Provisório",
                            "dataHora": "2019-05-30T11:10:02.000Z"
                        }
                    ],
                    "id": "TJDFT_1116_G1_13597_00073039720138070015",
                    "nivelSigilo": 0,
                    "orgaoJulgador": {
                        "codigoMunicipioIBGE": 5300108,
                        "codigo": 13597,
                        "nome": "VARA DE EXECU??O FISCAL DO DF"
                    },
                    "assuntos": [
                        [
                            {
                                "codigo": 6017,
                                "nome": "Dívida Ativa (Execução Fiscal)"
                            }
                        ],
                        [
                            {
                                "codigo": 10394,
                                "nome": "Dívida Ativa não-tributária"
                            }
                        ]
                    ]
                }
            }
            ...
        ]
    }
}

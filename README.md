# 🛒 Assistente de Compras

App pessoal (PWA) que recebe comandos **por voz**, mantém sua **lista de compras**, **aprende seu padrão de consumo** e **cota preços online**, devolvendo **propostas de carrinho prontas** — com sugestões de alternativas mais baratas ou mais saudáveis.

Tudo roda localmente com Node.js, **sem nenhuma dependência externa** (`npm install` não é necessário). A inteligência vem da **sua chave do OpenRouter**.

## Como rodar

```bash
node server/server.js
# abre http://localhost:3000 no Chrome
```

Opcional: defina a chave por variável de ambiente em vez da tela de Config:

```bash
OPENROUTER_API_KEY=sk-or-... node server/server.js
```

No celular: acesse o endereço do servidor pela rede local (ex.: `http://192.168.0.10:3000`) e use "Adicionar à tela inicial" — o app instala como PWA.

> **Voz**: o reconhecimento usa a Web Speech API do Chrome (pt-BR). Em alguns navegadores o microfone exige HTTPS ou `localhost`; se for acessar pelo IP da rede, considere um túnel HTTPS (ex.: `cloudflared`, `ngrok`) ou ative a flag `unsafely-treat-insecure-origin-as-secure` do Chrome para o seu IP.

## O que ele faz

| Você diz/faz | O app |
|---|---|
| "Acabou o arroz" | Registra o evento, adiciona arroz à lista (já com a marca/embalagem que você costuma comprar) |
| "Compra 2 sabão em pó OMO" | Adiciona com quantidade e marca |
| 📷 foto do produto | Modelo de visão extrai nome, marca, embalagem e ingredientes e cadastra no seu catálogo |
| "Monta o carrinho" / botão **Cotar preços** | Busca preços (scraper + web), monta até 3 propostas de carrinho por loja, com totais e links |
| "Marquei tudo como comprado" | Alimenta o histórico — é assim que o padrão é aprendido |

**Aprendizado de padrão**: a cada "acabou"/"comprei", o app calcula o intervalo médio de reposição de cada item. Na aba **Padrões** você vê a frequência estimada, e o assistente avisa o que deve estar acabando ("📌 Pelo seu padrão, deve estar acabando: leite, café...").

**Sugestões de troca**: na cotação, o modelo propõe alternativas — *"Você pediu arroz Tio João, não gostaria do Buriti por R$ 2 a menos no pacote de 2kg?"* (💸 mais barato) ou opções com composição mais saudável/orgânica (🌱), explicando o motivo.

## Como a busca de preços funciona (híbrida)

1. **Scrapers diretos (VTEX)** — mercados na plataforma VTEX expõem uma API pública de catálogo. Já configurados: Carrefour Mercado e Sonda Delivery. Para adicionar outro mercado VTEX da sua região, edite `server/scrapers/stores.js`:
   ```js
   { id: 'meumercado', name: 'Meu Mercado', base: 'https://www.meumercado.com.br', type: 'vtex' }
   ```
2. **Busca web via OpenRouter** — para as demais lojas (Atacadão, Assaí, Pão de Açúcar, Extra, iFood Mercado), o app usa um modelo com acesso à web (sufixo `:online` do OpenRouter) para pesquisar preços atuais.
3. Um modelo então **compõe as propostas**: até 3 carrinhos (um por loja, do mais barato ao mais caro), itens não encontrados e as sugestões de troca.

## Configuração (aba ⚙️)

- **Chave do OpenRouter** — obrigatória ([openrouter.ai/keys](https://openrouter.ai/keys)).
- **Modelos** — padrões: `openai/gpt-4o-mini` (texto e visão) e `openai/gpt-4o-mini:online` (busca de preços). Troque por qualquer modelo do OpenRouter; para a busca, mantenha o sufixo `:online`.
- **Cidade/CEP** — melhora a precisão regional dos preços.

## Dados e privacidade

Tudo fica em `data/db.json` (ignorado pelo git): lista, catálogo aprendido, histórico e configurações — **incluindo sua chave do OpenRouter**, em texto plano. Mantenha o servidor em máquina sua/rede confiável, ou use a variável de ambiente. Nada é enviado a terceiros além das chamadas ao OpenRouter e às APIs públicas dos mercados.

## Estrutura

```
server/
  server.js        # HTTP server + rotas da API (zero dependências)
  assistant.js     # interpretação de voz/texto e ações na lista
  patterns.js      # aprendizado de padrão de consumo
  quotes.js        # orquestração da cotação e propostas de carrinho
  openrouter.js    # cliente da API do OpenRouter
  scrapers/        # vtex.js (scraper genérico) + stores.js (lojas)
public/            # PWA: index.html, app.js, styles.css, sw.js, manifest
data/db.json       # seus dados (criado no primeiro uso, fora do git)
```

## Limitações conhecidas

- Os preços de busca web dependem do que o modelo encontra publicamente; confira antes de fechar a compra (cada item tem link quando disponível).
- O app monta a **proposta** de carrinho; a finalização da compra é feita no site/app da loja pelos links.
- Scrapers podem quebrar se a loja mudar de plataforma — nesse caso a loja continua coberta pela busca web.

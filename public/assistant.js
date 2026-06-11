// Assistente: interpreta comandos de voz/texto via OpenRouter, aplica ações
// na lista/padrões e responde em linguagem natural. Também lê fotos de produto.
'use strict';

import * as store from './store.js';
import * as llm from './llm.js';

const SYSTEM = `Você é o assistente de compras de supermercado de um usuário brasileiro. Ele fala frases curtas do dia a dia como "acabou o arroz", "compra duas batatas palha", "tira o sabão da lista", "já comprei tudo", "o que tem na lista?".

Sua tarefa: interpretar a frase e devolver SOMENTE JSON neste formato:
{
 "reply": "resposta curta e natural em português, para ser falada em voz alta",
 "actions": [
   {"type": "add", "item": {"name": "...", "brand": null, "package": null, "qty": 1}},
   {"type": "ran_out", "item": {"name": "..."}},
   {"type": "remove", "item": {"name": "..."}},
   {"type": "set_qty", "item": {"name": "...", "qty": 2}},
   {"type": "purchased_all"},
   {"type": "quote"}
 ]
}

Regras:
- "acabou X" => ações ran_out E add (acabou implica repor: entra na lista).
- "comprei X" / "já comprei tudo" => purchased_all ou remove do item comprado.
- Pedidos de cotação/preços ("monta o carrinho", "busca os preços") => action quote.
- Perguntas ("o que tem na lista?") => apenas reply, actions [].
- Extraia marca e embalagem quando ditas ("arroz tio joão 5kg" => name "arroz", brand "Tio João", package "5kg").
- Se a frase não tiver a ver com compras, responda educadamente que você cuida das compras. actions [].
- reply sempre confirma o que foi feito ("Anotei: arroz na lista. Já são 5 itens.").`;

export async function handleMessage(message) {
  const snapshot = store.state.list.map((i) => ({
    name: i.name, brand: i.brand, package: i.package, qty: i.qty
  }));
  const recentChat = store.state.chatLog.slice(-6);

  const data = await llm.chatJson({
    model: store.state.settings.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          `Lista atual: ${JSON.stringify(snapshot)}\n` +
          `Itens recorrentes que devem estar acabando: ${JSON.stringify(
            store.dueSuggestions().map((s) => s.name)
          )}\n` +
          (recentChat.length ? `Conversa recente: ${JSON.stringify(recentChat)}\n` : '') +
          `Frase do usuário: "${message}"`
      }
    ]
  });

  let wantsQuote = false;
  for (const a of data.actions || []) {
    const item = a.item || {};
    switch (a.type) {
      case 'add':
        store.addItem({ ...item, source: 'voz' });
        break;
      case 'ran_out':
        store.recordEvent(item, 'ran_out');
        break;
      case 'remove':
        store.removeItem(item.name);
        break;
      case 'set_qty':
        store.setQty(item.name, item.qty);
        break;
      case 'purchased_all':
        store.markPurchased();
        break;
      case 'quote':
        wantsQuote = true;
        break;
    }
  }
  const reply = data.reply || 'Feito.';
  store.pushChat(message, reply);
  return { reply, wantsQuote };
}

// Foto de nota/cupom fiscal OU print de pedido online (histórico de compras
// do site/app do mercado, ex. Condor) -> modelo de visão extrai a compra.
export async function analyzeReceipt(dataUrl) {
  const data = await llm.chatJson({
    model: store.state.settings.visionModel,
    maxTokens: 6000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Esta imagem é uma compra de supermercado brasileiro: foto de nota/cupom fiscal OU print (captura de tela) do detalhe de um pedido no site/app do mercado. Extraia a compra e responda SOMENTE com JSON:
{"store":"nome do mercado","date":"data da compra em YYYY-MM-DD, ou null se ilegível","total":123.45,
 "items":[{"name":"nome genérico em minúsculas (ex: arroz, batata palha)","brand":"marca se identificável, senão null","package":"peso/tamanho se visível (ex: 5kg), senão null","qty":1,"unitPrice":12.34}]}

Importante: descrições de cupom são abreviadas — expanda (ex: "ARR TIO JOAO T1 5KG" => name "arroz", brand "Tio João", package "5kg"; "REFRI CC 2L" => name "refrigerante", brand "Coca-Cola", package "2L"). qty é a quantidade comprada e unitPrice o preço unitário em reais. Liste só produtos; ignore taxas de entrega, descontos gerais e linhas de total. Se aparecerem vários pedidos, extraia apenas o mais recente/completo. Se a imagem não for uma compra de mercado, responda {"items":[]}.`
          },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ]
  });
  if (!data.items?.length) {
    throw new Error('Não consegui ler itens nessa imagem. Para nota de papel: mais luz e nota esticada (ou por partes). Para pedido online: print do detalhe do pedido, com os itens visíveis.');
  }
  return data;
}

// Foto de produto -> modelo de visão extrai nome, marca, embalagem, ingredientes.
export async function analyzePhoto(dataUrl) {
  const data = await llm.chatJson({
    model: store.state.settings.visionModel,
    maxTokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Esta é a foto de um produto de supermercado brasileiro. Extraia as informações visíveis e responda SOMENTE com JSON:
{"name":"nome genérico (ex: arroz, batata palha)","brand":"marca","package":"tamanho/embalagem (ex: 5kg, 500g)","category":"categoria","ingredients":"lista de ingredientes se legível, senão null","fullName":"nome completo do produto"}`
          },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ]
  });
  if (!data.name) throw new Error('Não consegui identificar o produto na foto.');
  store.recordEvent(
    { name: data.name, brand: data.brand, package: data.package, category: data.category, ingredients: data.ingredients },
    'photo_info'
  );
  return data;
}

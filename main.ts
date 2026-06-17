const TOKEN = Deno.env.get("BOT_TOKEN")!;
const GROUP = Deno.env.get("GROUP_CHAT_ID")!;

const sessions = new Map<number, any>();
const albumBuffer = new Map<string, { photos: string[], timeout: number }>();

function get(id: number) {
  if (!sessions.has(id)) {
    sessions.set(id, { step: 1, data: { photos: [] } });
  }
  return sessions.get(id);
}

async function send(chat: string, text: string, keyboard?: any) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, reply_markup: keyboard })
  });
}

async function sendMedia(photos: string[]) {
  if (!photos.length) return;
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMediaGroup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: GROUP,
      media: photos.map((p, i) => ({
        type: "photo",
        media: p,
        caption: i === 0 ? "Фото поломок" : undefined
      }))
    })
  });
}

function card(s: any) {
  return `🚛 Новый репорт

имя - ${s.data.name}
трак - ${s.data.truck}
поломка - ${s.data.issue}

фотки поломок - ${s.data.photos.length}

когда оставляет трак - ${s.data.drop}`;
}

function flushAlbum(groupId: string, s: any, chatId: string) {
  const album = albumBuffer.get(groupId);
  if (!album) return;

  clearTimeout(album.timeout);
  albumBuffer.delete(groupId);

  s.data.photos.push(...album.photos);

  // Отправляем только в личку
  send(chatId, card(s), {
    inline_keyboard: [[{ text: "Подтвердить", callback_data: "confirm" }]]
  });
}

Deno.serve(async (req) => {
  const u = await req.json();
  const msg = u.message;
  const cb = u.callback_query;

  // Callback
  if (cb) {
    const s = get(cb.from.id);

    if (cb.data === "confirm") {
      // Пересылаем только в группу
      await send(GROUP, card(s));
      await sendMedia(s.data.photos);

      // Отправляем сообщение пользователю в личку
      await send(cb.message.chat.id, "Заявка отправлена", {
        inline_keyboard: [[{ text: "Создать новый репорт", callback_data: "new" }]]
      });

      return new Response("ok");
    }

    if (cb.data === "new") {
      const s2 = get(cb.from.id);
      s2.step = 1;
      s2.data = { photos: [] };
      await send(cb.message.chat.id, "Введите имя и фамилию");
      return new Response("ok");
    }
  }

  if (!msg) return new Response("ok");

  // Игнорируем сообщения из группы
  if (msg.chat.type !== "private") return new Response("ok");

  const s = get(msg.from.id);
  const text = msg.text || "";

  if (text === "/start") {
    s.step = 1;
    s.data = { photos: [] };
    await send(msg.chat.id, "Введите имя и фамилию");
    return new Response("ok");
  }

  if (s.step === 1) {
    s.data.name = text;
    s.step = 2;
    await send(msg.chat.id, "Введите номер трака");
    return new Response("ok");
  }

  if (s.step === 2) {
    s.data.truck = text;
    s.step = 3;
    await send(msg.chat.id, "Опишите поломки");
    return new Response("ok");
  }

  if (s.step === 3) {
    s.data.issue = text;
    s.step = 4;
    await send(msg.chat.id, "Когда оставляете трак?");
    return new Response("ok");
  }

  if (s.step === 4) {
    s.data.drop = text;
    s.step = 5;
    await send(msg.chat.id, "Отправьте фото поломок (можно альбом)");
    return new Response("ok");
  }

  // STEP 5: фото
  if (s.step === 5) {
    if (!msg.photo) return new Response("ok");

    const groupId = msg.media_group_id || `single_${msg.from.id}`;
    const fileId = msg.photo.at(-1).file_id;

    if (!albumBuffer.has(groupId)) {
      albumBuffer.set(groupId, { photos: [], timeout: 0 });
    }

    const album = albumBuffer.get(groupId)!;
    album.photos.push(fileId);

    clearTimeout(album.timeout);
    album.timeout = setTimeout(() => {
      flushAlbum(groupId, s, msg.chat.id);
    }, 1200);

    return new Response("ok");
  }

  // Все остальные сообщения игнорируем
  return new Response("ok");
});

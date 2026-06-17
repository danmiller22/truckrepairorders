const TOKEN = Deno.env.get("BOT_TOKEN")!;
const GROUP = Deno.env.get("GROUP_CHAT_ID")!;

const sessions = new Map<number, any>();

function get(id: number) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      step: 1,
      data: { photos: [] }
    });
  }
  return sessions.get(id);
}

async function send(chat: string, text: string, keyboard?: any) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text,
      reply_markup: keyboard
    })
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

имя - ${s.data.name || ""}
трак - ${s.data.truck || ""}
поломка - ${s.data.issue || ""}

фотки - ${s.data.photos?.length || 0}

когда оставляет трак - ${s.data.drop || ""}
когда забирает трак - ${s.data.pickup || ""}
`;
}

Deno.serve(async (req) => {
  const u = await req.json();

  const msg = u.message;
  const cb = u.callback_query;

  // ================= START =================
  if (msg?.text === "/start") {
    const s = get(msg.from.id);

    s.step = 1;
    s.data = { photos: [] };

    await send(msg.chat.id, "Введите имя и фамилию");
    return new Response("ok");
  }

  // ================= CALLBACK =================
  if (cb) {
    const s = get(cb.from.id);

    if (cb.data === "confirm") {

      await send(GROUP, card(s));

      await sendMedia(s.data.photos);

      await send(cb.message.chat.id, "Заявка отправлена", {
        inline_keyboard: [[
          { text: "Создать новый репорт", callback_data: "new" }
        ]]
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

  // ================= FLOW =================
  if (!msg) return new Response("ok");

  const s = get(msg.from.id);
  const text = msg.text || "";

  // STEP 1 NAME
  if (s.step === 1) {
    s.data.name = text;
    s.step = 2;

    await send(msg.chat.id, "Введите номер трака");
    return new Response("ok");
  }

  // STEP 2 TRUCK
  if (s.step === 2) {
    s.data.truck = text;
    s.step = 3;

    await send(msg.chat.id, "Опишите поломки");
    return new Response("ok");
  }

  // STEP 3 ISSUE
  if (s.step === 3) {
    s.data.issue = text;
    s.step = 4;

    await send(msg.chat.id, "Когда оставляете трак?");
    return new Response("ok");
  }

  // STEP 4 DROP
  if (s.step === 4) {
    s.data.drop = text;
    s.step = 5;

    await send(msg.chat.id, "Когда забираете трак?");
    return new Response("ok");
  }

  // STEP 5 PICKUP
  if (s.step === 5) {
    s.data.pickup = text;
    s.step = 6;

    await send(msg.chat.id, "Отправьте фото (можно несколько подряд)");
    return new Response("ok");
  }

  // ================= STEP 6 PHOTOS (FIXED NO LAG) =================
  if (s.step === 6) {

    // 📸 просто собираем фото, НЕ отвечаем
    if (msg.photo) {
      const file = msg.photo.at(-1).file_id;
      s.data.photos.push(file);
      return new Response("ok");
    }

    // ❗ ЛЮБОЕ НЕ-ФОТО = ПОКАЗ КАРТОЧКИ 1 РАЗ
    await send(msg.chat.id, card(s), {
      inline_keyboard: [[
        { text: "Подтвердить", callback_data: "confirm" }
      ]]
    });

    return new Response("ok");
  }

  return new Response("ok");
});

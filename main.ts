const TOKEN = Deno.env.get("BOT_TOKEN")!;
const GROUP = Deno.env.get("GROUP_CHAT_ID")!;

const sessions = new Map<number, any>();

function get(id: number) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      step: "name",
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

Deno.serve(async (req) => {
  const u = await req.json();
  const msg = u.message;
  const cb = u.callback_query;

  // ================= START =================
  if (msg?.text === "/start") {
    const s = get(msg.from.id);
    s.step = "name";
    s.data = { photos: [] };

    await send(msg.chat.id, "Введите имя и фамилию");
    return new Response("ok");
  }

  // ================= CALLBACK =================
  if (cb) {
    const id = cb.from.id;
    const s = get(id);
    const d = cb.data;

    // CONFIRM
    if (d === "confirm") {

      await send(
        GROUP,
`🚛 Заявка на ремонт трака

👤 Имя: ${s.data.name}
🚚 Трак: ${s.data.truck}
🔧 Поломка: ${s.data.issue}

📅 Дата сдачи: ${s.data.drop}
📅 Дата забора: ${s.data.pickup}
`
      );

      await sendMedia(s.data.photos);

      await send(
        cb.message.chat.id,
        "Заявка отправлена",
        {
          inline_keyboard: [[
            { text: "Создать новый репорт", callback_data: "new" }
          ]]
        }
      );

      return new Response("ok");
    }

    // NEW REPORT
    if (d === "new") {
      const s = get(cb.from.id);
      s.step = "name";
      s.data = { photos: [] };

      await send(cb.message.chat.id, "Введите имя и фамилию");
      return new Response("ok");
    }
  }

  // ================= FLOW =================
  if (msg) {
    const id = msg.from.id;
    const s = get(id);
    const text = msg.text;

    if (s.step === "name") {
      s.data.name = text;
      s.step = "truck";

      await send(msg.chat.id, "Введите номер трака");
      return new Response("ok");
    }

    if (s.step === "truck") {
      s.data.truck = text;
      s.step = "issue";

      await send(msg.chat.id, "Опишите поломки");
      return new Response("ok");
    }

    if (s.step === "issue") {
      s.data.issue = text;
      s.step = "drop";

      await send(msg.chat.id, "📅 Когда оставляете трак?");
      return new Response("ok");
    }

    if (s.step === "drop") {
      s.data.drop = text;
      s.step = "pickup";

      await send(msg.chat.id, "📅 Когда забираете трак?");
      return new Response("ok");
    }

    if (s.step === "pickup") {
      s.data.pickup = text;
      s.step = "photos";

      await send(msg.chat.id, "Отправьте фото");
      return new Response("ok");
    }

    if (s.step === "photos") {
      if (msg.photo) {
        const file = msg.photo.at(-1).file_id;
        s.data.photos.push(file);
      }

      await send(msg.chat.id,
        "Подтвердить заявку?",
        { inline_keyboard: [[{ text: "Подтвердить", callback_data: "confirm" }]] }
      );

      return new Response("ok");
    }
  }

  return new Response("ok");
});

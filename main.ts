const TOKEN = Deno.env.get("BOT_TOKEN")!;
const GROUP = Deno.env.get("GROUP_CHAT_ID")!;

const sessions = new Map<number, any>();

function get(id: number) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      lang: "en",
      data: {}
    });
  }
  return sessions.get(id);
}

async function send(text: string, chat: string, keyboard?: any) {
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
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMediaGroup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: GROUP,
      media: photos.map((p, i) => ({
        type: "photo",
        media: p,
        caption: i === 0 ? "Damage photos" : undefined
      }))
    })
  });
}

Deno.serve(async (req) => {
  const u = await req.json();

  // ================= START =================
  if (u.message?.text === "/start") {
    const s = get(u.message.from.id);
    s.data = {};
    await send("Choose language / Выберите язык", u.message.chat.id, {
      inline_keyboard: [
        [{ text: "Русский", callback_data: "ru" }],
        [{ text: "English", callback_data: "en" }]
      ]
    });
    return new Response("ok");
  }

  // ================= CALLBACK =================
  if (u.callback_query) {
    const id = u.callback_query.from.id;
    const chat = u.callback_query.message.chat.id;
    const s = get(id);

    const d = u.callback_query.data;

    // LANGUAGE
    if (d === "ru" || d === "en") {
      s.lang = d;
      s.data = { photos: [] };

      await send(
        d === "ru" ? "Введите имя и фамилию" : "Enter name and last name",
        chat
      );

      s.step = "name";
      return new Response("ok");
    }

    // CONFIRM
    if (d === "confirm") {
      await send(
        `🚛 Truck Repair Order

Name: ${s.data.name}
Truck: ${s.data.truck}
Issue: ${s.data.issue}
`,
        GROUP
      );

      if (s.data.photos?.length) await sendMedia(s.data.photos);

      await send(
        s.lang === "ru"
          ? "Заявка отправлена"
          : "Request sent",
        chat,
        {
          inline_keyboard: [[
            { text: s.lang === "ru" ? "Создать новый репорт" : "Create new report", callback_data: "new" }
          ]]
        }
      );

      return new Response("ok");
    }

    // NEW
    if (d === "new") {
      s.data = { photos: [] };

      await send(
        s.lang === "ru"
          ? "Введите имя и фамилию"
          : "Enter name and last name",
        chat
      );

      s.step = "name";
      return new Response("ok");
    }
  }

  // ================= FLOW =================
  if (u.message) {
    const msg = u.message;
    const s = get(msg.from.id);
    const lang = s.lang || "en";

    const text = msg.text;

    // NAME
    if (s.step === "name") {
      s.data.name = text;

      await send(
        lang === "ru" ? "Введите номер трака" : "Enter truck number",
        msg.chat.id
      );

      s.step = "truck";
      return new Response("ok");
    }

    // TRUCK
    if (s.step === "truck") {
      s.data.truck = text;

      await send(
        lang === "ru" ? "Опишите поломки" : "Describe the issue",
        msg.chat.id
      );

      s.step = "issue";
      return new Response("ok");
    }

    // ISSUE (ВАЖНО — БЕЗ ОГРАНИЧЕНИЙ)
    if (s.step === "issue") {
      s.data.issue = text;

      await send(
        lang === "ru"
          ? "Отправьте фото (можно пропустить отправив любое сообщение)"
          : "Send photos (or skip by sending any message)",
        msg.chat.id
      );

      s.step = "photos";
      return new Response("ok");
    }

    // PHOTOS (НЕ ЛОМАЕТСЯ ОТ ТЕКСТА)
    if (s.step === "photos") {
      if (!msg.photo) {
        s.data.photos = s.data.photos || [];

        await send(
          lang === "ru"
            ? "Подтвердить заявку?"
            : "Confirm request?",
          msg.chat.id,
          {
            inline_keyboard: [
              [{ text: "Confirm", callback_data: "confirm" }]
            ]
          }
        );

        return new Response("ok");
      }

      const file = msg.photo.at(-1).file_id;
      s.data.photos.push(file);

      return new Response("ok");
    }
  }

  return new Response("ok");
});

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const GROUP = Deno.env.get("GROUP_CHAT_ID")!;

// 🔥 GLOBAL LANGUAGE STORE (FIX 100%)
const userLang = new Map<number, "ru" | "en">();

const sessions = new Map<number, any>();

function get(id: number) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      step: "lang",
      data: { photos: [] }
    });
  }
  return sessions.get(id);
}

function langOf(id: number) {
  return userLang.get(id) || "en";
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
        caption: i === 0 ? "Damage photos" : undefined
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
    const id = msg.from.id;

    const s = get(id);
    s.step = "lang";

    await send(msg.chat.id, "Choose language / Выберите язык", {
      inline_keyboard: [
        [{ text: "Русский", callback_data: "ru" }],
        [{ text: "English", callback_data: "en" }]
      ]
    });

    return new Response("ok");
  }

  // ================= CALLBACK =================
  if (cb) {
    const id = cb.from.id;
    const s = get(id);

    const d = cb.data;

    // 🔥 LANGUAGE FIX (PERMANENT SAVE)
    if (d === "ru" || d === "en") {
      userLang.set(id, d);

      s.step = "name";
      s.data = { photos: [] };

      await send(
        cb.message.chat.id,
        d === "ru"
          ? "Введите имя и фамилию"
          : "Enter first and last name"
      );

      return new Response("ok");
    }

    // CONFIRM
    if (d === "confirm") {

      const lang = langOf(id);

      await send(
        GROUP,
`🚛 Truck Repair Order

Name: ${s.data.name}
Truck: ${s.data.truck}
Issue: ${s.data.issue}

📅 Drop-off: ${s.data.drop}
📅 Pickup: ${s.data.pickup}
`
      );

      await sendMedia(s.data.photos);

      await send(
        cb.message.chat.id,
        lang === "ru" ? "Заявка отправлена" : "Request sent",
        {
          inline_keyboard: [[
            {
              text: lang === "ru"
                ? "Создать новый репорт"
                : "Create new report",
              callback_data: "new"
            }
          ]]
        }
      );

      return new Response("ok");
    }

    // NEW REPORT (🔥 FIXED LANGUAGE)
    if (d === "new") {

      const lang = langOf(id);

      const s = get(id);
      s.step = "name";
      s.data = { photos: [] };

      await send(
        cb.message.chat.id,
        lang === "ru"
          ? "Введите имя и фамилию"
          : "Enter first and last name"
      );

      return new Response("ok");
    }
  }

  // ================= FLOW =================
  if (msg) {
    const id = msg.from.id;
    const s = get(id);
    const lang = langOf(id);

    const text = msg.text;

    if (s.step === "name") {
      s.data.name = text;
      s.step = "truck";

      await send(msg.chat.id,
        lang === "ru" ? "Введите номер трака" : "Enter truck number"
      );

      return new Response("ok");
    }

    if (s.step === "truck") {
      s.data.truck = text;
      s.step = "issue";

      await send(msg.chat.id,
        lang === "ru" ? "Опишите поломки" : "Describe the issue"
      );

      return new Response("ok");
    }

    if (s.step === "issue") {
      s.data.issue = text;
      s.step = "drop";

      await send(msg.chat.id,
        lang === "ru"
          ? "Когда оставляете трак?"
          : "When dropping off truck?"
      );

      return new Response("ok");
    }

    if (s.step === "drop") {
      s.data.drop = text;
      s.step = "pickup";

      await send(msg.chat.id,
        lang === "ru"
          ? "Когда забираете трак?"
          : "Pickup date?"
      );

      return new Response("ok");
    }

    if (s.step === "pickup") {
      s.data.pickup = text;
      s.step = "photos";

      await send(msg.chat.id,
        lang === "ru"
          ? "Отправьте фото"
          : "Send photos"
      );

      return new Response("ok");
    }

    if (s.step === "photos") {

      if (msg.photo) {
        const file = msg.photo.at(-1).file_id;
        s.data.photos.push(file);
      }

      await send(msg.chat.id,
        lang === "ru" ? "Подтвердить заявку?" : "Confirm request?",
        {
          inline_keyboard: [
            [{ text: "Confirm", callback_data: "confirm" }]
          ]
        }
      );

      return new Response("ok");
    }
  }

  return new Response("ok");
});

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const GROUP = Deno.env.get("GROUP_CHAT_ID")!;

const sessions = new Map<number, any>();

function get(id: number) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      lang: "en",
      step: "lang",
      data: { photos: [] }
    });
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
    const s = get(msg.from.id);
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
    const s = get(cb.from.id);
    const lang = s.lang;

    const d = cb.data;

    // LANGUAGE
    if (d === "ru" || d === "en") {
      s.lang = d;
      s.step = "name";
      s.data = { photos: [] };

      await send(
        cb.message.chat.id,
        d === "ru" ? "Введите имя и фамилию" : "Enter name and last name"
      );

      return new Response("ok");
    }

    // CONFIRM
    if (d === "confirm") {
      await send(
        GROUP,
`🚛 Truck Repair Order

Name: ${s.data.name}
Truck: ${s.data.truck}
Issue: ${s.data.issue}
`
      );

      if (s.data.photos?.length) {
        await sendMedia(s.data.photos);
      }

      await send(
        cb.message.chat.id,
        s.lang === "ru" ? "Заявка отправлена" : "Request sent",
        {
          inline_keyboard: [[
            {
              text: s.lang === "ru"
                ? "Создать новый репорт"
                : "Create new report",
              callback_data: "new"
            }
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

      await send(
        cb.message.chat.id,
        s.lang === "ru"
          ? "Введите имя и фамилию"
          : "Enter name and last name"
      );

      return new Response("ok");
    }
  }

  // ================= FLOW =================
  if (msg) {
    const s = get(msg.from.id);
    const lang = s.lang;

    // SAFE STEP INIT (FIX CRASH)
    if (!s.step) s.step = "name";

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
      s.step = "photos";

      await send(msg.chat.id,
        lang === "ru"
          ? "Отправьте фото"
          : "Send photos"
      );

      return new Response("ok");
    }

    // ================= FIXED PHOTOS (NO DEAD END) =================
    if (s.step === "photos") {

      // photo
      if (msg.photo) {
        const file = msg.photo.at(-1).file_id;
        s.data.photos.push(file);
      }

      // ANY message continues flow (NO DEAD END BUG)
      await send(
        msg.chat.id,
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

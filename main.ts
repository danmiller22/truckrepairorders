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
    const s = get(msg.from.id);

    s.step = "lang";
    s.data = { photos: [] };

    await send(msg.chat.id,
      "Choose language / Выберите язык",
      {
        inline_keyboard: [
          [{ text: "Русский", callback_data: "ru" }],
          [{ text: "English", callback_data: "en" }]
        ]
      }
    );

    return new Response("ok");
  }

  // ================= CALLBACK =================
  if (cb) {
    const s = get(cb.from.id);
    const d = cb.data;

    // LANGUAGE
    if (d === "ru" || d === "en") {
      s.lang = d;
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
          : "Enter first and last name"
      );

      return new Response("ok");
    }
  }

  // ================= FLOW =================
  if (msg) {
    const s = get(msg.from.id);
    const lang = s.lang || "en";
    const text = msg.text;

    // NAME
    if (s.step === "name") {
      s.data.name = text;
      s.step = "truck";

      await send(msg.chat.id,
        lang === "ru" ? "Введите номер трака" : "Enter truck number"
      );

      return new Response("ok");
    }

    // TRUCK
    if (s.step === "truck") {
      s.data.truck = text;
      s.step = "issue";

      await send(msg.chat.id,
        lang === "ru" ? "Опишите поломки" : "Describe the issue"
      );

      return new Response("ok");
    }

    // ISSUE (FIXED NO FREEZE)
    if (s.step === "issue") {
      s.data.issue = text;
      s.step = "drop";

      await send(msg.chat.id,
        lang === "ru"
          ? "📅 Когда оставляете трак? (drop-off date)"
          : "📅 When are you dropping off the truck?"
      );

      return new Response("ok");
    }

    // DROP DATE
    if (s.step === "drop") {
      s.data.drop = text;
      s.step = "pickup";

      await send(msg.chat.id,
        lang === "ru"
          ? "📅 Когда забираете трак? (pickup date)"
          : "📅 When will you pick up the truck?"
      );

      return new Response("ok");
    }

    // PICKUP DATE
    if (s.step === "pickup") {
      s.data.pickup = text;
      s.step = "photos";

      await send(msg.chat.id,
        lang === "ru"
          ? "Отправьте фото (или любое сообщение чтобы пропустить)"
          : "Send photos (or any message to skip)"
      );

      return new Response("ok");
    }

    // PHOTOS (NO FREEZE EVER)
    if (s.step === "photos") {

      if (msg.photo) {
        const file = msg.photo.at(-1).file_id;
        s.data.photos.push(file);
      }

      await send(msg.chat.id,
        s.lang === "ru" ? "Подтвердить заявку?" : "Confirm request?",
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

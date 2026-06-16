import { texts } from "./i18n.ts";
import { langKeyboard, confirmKeyboard, newReportKeyboard } from "./keyboards.ts";
import { sendMessage } from "./utils.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const GROUP = Deno.env.get("GROUP_CHAT_ID")!;

// MEMORY FIX (STABLE SESSION)
const sessions = new Map<number, any>();

function getSession(id: number) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      step: "lang",
      lang: "en",
      data: { photos: [] }
    });
  }
  return sessions.get(id);
}

async function sendMediaGroup(photos: string[]) {
  const media = photos.map((id, i) => ({
    type: "photo",
    media: id,
    caption: i === 0 ? "📸 Damage photos" : undefined
  }));

  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMediaGroup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: GROUP, media })
  });
}

Deno.serve(async (req) => {
  const update = await req.json();

  // ================= MESSAGE =================
  if (update.message) {
    const msg = update.message;
    const session = getSession(msg.from.id);

    const lang = session.lang || "en";

    // START
    if (msg.text === "/start") {
      session.step = "lang";
      return sendMessage(TOKEN, msg.chat.id, texts.en.start, langKeyboard())
        .then(() => new Response("ok"));
    }

    // LANG CALLBACK FIX (text fallback safety)
    if (msg.text === "lang_ru") {
      session.lang = "ru";
      session.step = "name";
      return sendMessage(TOKEN, msg.chat.id, texts.ru.ask_name)
        .then(() => new Response("ok"));
    }

    if (msg.text === "lang_en") {
      session.lang = "en";
      session.step = "name";
      return sendMessage(TOKEN, msg.chat.id, texts.en.ask_name)
        .then(() => new Response("ok"));
    }

    // SAFE FLOW (CRITICAL FIX - prevents dead step)
    if (!session.step) {
      session.step = "name";
    }

    // NAME
    if (session.step === "name") {
      session.data.name = msg.text;
      session.step = "truck";

      return sendMessage(TOKEN, msg.chat.id, texts[lang].ask_truck)
        .then(() => new Response("ok"));
    }

    // TRUCK
    if (session.step === "truck") {
      session.data.truck = msg.text;
      session.step = "issue";

      return sendMessage(TOKEN, msg.chat.id, texts[lang].ask_issue)
        .then(() => new Response("ok"));
    }

    // ISSUE
    if (session.step === "issue") {
      session.data.issue = msg.text;
      session.step = "drop";

      return sendMessage(TOKEN, msg.chat.id, texts[lang].ask_drop)
        .then(() => new Response("ok"));
    }

    // DROP
    if (session.step === "drop") {
      session.data.dropDate = msg.text;
      session.step = "pickup";

      return sendMessage(TOKEN, msg.chat.id, texts[lang].ask_pickup)
        .then(() => new Response("ok"));
    }

    // PICKUP
    if (session.step === "pickup") {
      session.data.pickupDate = msg.text;
      session.step = "photos";

      return sendMessage(TOKEN, msg.chat.id, texts[lang].ask_photos)
        .then(() => new Response("ok"));
    }

    // PHOTOS (SAFE)
    if (session.step === "photos") {
      if (!msg.photo) {
        return sendMessage(TOKEN, msg.chat.id, texts[lang].need_photo)
          .then(() => new Response("ok"));
      }

      const fileId = msg.photo[msg.photo.length - 1].file_id;
      session.data.photos.push(fileId);

      session.data.preview =
`🚛 Truck Repair Order

👤 Name: ${session.data.name}
🚚 Truck: ${session.data.truck}
🔧 Issue: ${session.data.issue}

📅 Drop-off: ${session.data.dropDate}
📅 Pickup: ${session.data.pickupDate}
`;

      session.step = "confirm";

      return sendMessage(TOKEN, msg.chat.id, texts[lang].confirm, confirmKeyboard(lang))
        .then(() => new Response("ok"));
    }
  }

  // ================= CALLBACK =================
  if (update.callback_query) {
    const cq = update.callback_query;
    const session = getSession(cq.from.id);

    const lang = session.lang || "en";
    const data = cq.data;

    // LANGUAGE FIX
    if (data === "lang_ru") {
      session.lang = "ru";
      session.step = "name";

      return sendMessage(TOKEN, cq.message.chat.id, texts.ru.ask_name)
        .then(() => new Response("ok"));
    }

    if (data === "lang_en") {
      session.lang = "en";
      session.step = "name";

      return sendMessage(TOKEN, cq.message.chat.id, texts.en.ask_name)
        .then(() => new Response("ok"));
    }

    // CONFIRM
    if (data === "confirm") {

      sendMessage(
        TOKEN,
        GROUP,
`🚛 Truck Repair Order

👤 Name: ${session.data.name}
🚚 Truck: ${session.data.truck}
🔧 Issue: ${session.data.issue}

📅 Drop-off: ${session.data.dropDate}
📅 Pickup: ${session.data.pickupDate}
`
      );

      if (session.data.photos.length) {
        sendMediaGroup(session.data.photos);
      }

      return sendMessage(
        TOKEN,
        cq.message.chat.id,
        texts[lang].sent,
        newReportKeyboard(lang)
      ).then(() => new Response("ok"));
    }

    // NEW REPORT (CRITICAL FIX)
    if (data === "new") {
      session.step = "name";
      session.data = { photos: [] };

      return sendMessage(
        TOKEN,
        cq.message.chat.id,
        texts[lang].ask_name
      ).then(() => new Response("ok"));
    }
  }

  return new Response("ok");
});

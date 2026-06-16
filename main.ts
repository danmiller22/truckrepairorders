import { getSession } from "./state.ts";
import { texts } from "./i18n.ts";
import { langKeyboard, confirmKeyboard, newReportKeyboard } from "./keyboards.ts";
import { sendMessage } from "./utils.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const GROUP = Deno.env.get("GROUP_CHAT_ID")!;

async function sendMediaGroup(photos: string[]) {
  const media = photos.map((id, i) => ({
    type: "photo",
    media: id,
    caption: i === 0 ? "📸 Damage photos" : undefined
  }));

  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMediaGroup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: GROUP,
      media
    })
  });
}

async function handler(req: Request) {
  const update = await req.json();

  // ================= MESSAGE =================
  if (update.message) {
    const msg = update.message;
    const session = getSession(msg.from.id);

    // START
    if (msg.text === "/start") {
      session.step = "lang";
      await sendMessage(TOKEN, msg.chat.id, texts.en.start, langKeyboard());
      return new Response("ok");
    }

    // NAME
    if (session.step === "name") {
      session.data.name = msg.text;
      session.step = "truck";

      await sendMessage(TOKEN, msg.chat.id, texts[session.lang].ask_truck);
      return new Response("ok");
    }

    // TRUCK
    if (session.step === "truck") {
      session.data.truck = msg.text;
      session.step = "issue";

      await sendMessage(TOKEN, msg.chat.id, texts[session.lang].ask_issue);
      return new Response("ok");
    }

    // ISSUE
    if (session.step === "issue") {
      session.data.issue = msg.text;
      session.step = "photos";

      await sendMessage(TOKEN, msg.chat.id, texts[session.lang].ask_photos);
      return new Response("ok");
    }

    // PHOTOS (FIXED)
    if (session.step === "photos") {
      if (!msg.photo) {
        await sendMessage(
          TOKEN,
          msg.chat.id,
          "📸 Send at least 1 photo / Отправьте фото"
        );
        return new Response("ok");
      }

      const fileId = msg.photo[msg.photo.length - 1].file_id;
      session.data.photos.push(fileId);

      // PREVIEW CARD (what user sees)
      const preview =
`🚛 Truck Repair Order

👤 Name: ${session.data.name}
🚚 Truck: ${session.data.truck}
🔧 Issue: ${session.data.issue}
`;

      session.data.preview = preview;
      session.step = "confirm";

      await sendMessage(
        TOKEN,
        msg.chat.id,
        texts[session.lang].confirm,
        confirmKeyboard(session.lang)
      );

      return new Response("ok");
    }
  }

  // ================= CALLBACK =================
  if (update.callback_query) {
    const cq = update.callback_query;
    const session = getSession(cq.from.id);
    const data = cq.data;

    // LANGUAGE
    if (data === "lang_ru") {
      session.lang = "ru";
      session.step = "name";
      await sendMessage(TOKEN, cq.message.chat.id, texts.ru.ask_name);
    }

    if (data === "lang_en") {
      session.lang = "en";
      session.step = "name";
      await sendMessage(TOKEN, cq.message.chat.id, texts.en.ask_name);
    }

    // CONFIRM → SEND TO GROUP (TEXT + PHOTOS FIXED)
    if (data === "confirm") {

      // 1. TEXT CARD
      await sendMessage(
        TOKEN,
        GROUP,
`🚛 Truck Repair Order

👤 Name: ${session.data.name}
🚚 Truck: ${session.data.truck}
🔧 Issue: ${session.data.issue}
`
      );

      // 2. PHOTOS
      if (session.data.photos.length > 0) {
        await sendMediaGroup(session.data.photos);
      }

      // USER CONFIRMATION
      await sendMessage(
        TOKEN,
        cq.message.chat.id,
        texts[session.lang].sent,
        newReportKeyboard(session.lang)
      );

      session.step = "done";
    }

    // NEW REPORT
    if (data === "new") {
      session.step = "name";
      session.data = { photos: [] };

      await sendMessage(
        TOKEN,
        cq.message.chat.id,
        texts[session.lang].ask_name
      );
    }

    // CANCEL
    if (data === "cancel") {
      session.step = "done";
      await sendMessage(TOKEN, cq.message.chat.id, "Cancelled");
    }

    return new Response("ok");
  }

  return new Response("ok");
}

Deno.serve(handler);

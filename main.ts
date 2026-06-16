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

  if (update.message) {
    const msg = update.message;
    const session = getSession(msg.from.id);

    // 🔥 ALWAYS LOCK LANGUAGE
    if (!session.lang) session.lang = "en";
    const lang = session.lang;

    // START (ONLY LANGUAGE SELECTION)
    if (msg.text === "/start") {
      session.step = "lang";
      await sendMessage(TOKEN, msg.chat.id, texts.en.start, langKeyboard());
      return new Response("ok");
    }

    // LANGUAGE SELECT
    if (msg.text === "lang_ru") {
      session.lang = "ru";
      session.step = "name";
      await sendMessage(TOKEN, msg.chat.id, texts.ru.ask_name);
      return new Response("ok");
    }

    if (msg.text === "lang_en") {
      session.lang = "en";
      session.step = "name";
      await sendMessage(TOKEN, msg.chat.id, texts.en.ask_name);
      return new Response("ok");
    }

    // NAME
    if (session.step === "name") {
      session.data.name = msg.text;
      session.step = "truck";

      await sendMessage(TOKEN, msg.chat.id, texts[lang].ask_truck);
      return new Response("ok");
    }

    // TRUCK
    if (session.step === "truck") {
      session.data.truck = msg.text;
      session.step = "issue";

      await sendMessage(TOKEN, msg.chat.id, texts[lang].ask_issue);
      return new Response("ok");
    }

    // ISSUE
    if (session.step === "issue") {
      session.data.issue = msg.text;
      session.step = "drop";

      await sendMessage(TOKEN, msg.chat.id, texts[lang].ask_drop);
      return new Response("ok");
    }

    // DROP
    if (session.step === "drop") {
      session.data.dropDate = msg.text;
      session.step = "pickup";

      await sendMessage(TOKEN, msg.chat.id, texts[lang].ask_pickup);
      return new Response("ok");
    }

    // PICKUP
    if (session.step === "pickup") {
      session.data.pickupDate = msg.text;
      session.step = "photos";

      await sendMessage(TOKEN, msg.chat.id, texts[lang].ask_photos);
      return new Response("ok");
    }

    // PHOTOS
    if (session.step === "photos") {

      if (!msg.photo) {
        await sendMessage(TOKEN, msg.chat.id, texts[lang].need_photo);
        return new Response("ok");
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

      await sendMessage(
        TOKEN,
        msg.chat.id,
        texts[lang].confirm,
        confirmKeyboard(lang)
      );

      return new Response("ok");
    }
  }

  // CALLBACKS
  if (update.callback_query) {
    const cq = update.callback_query;
    const session = getSession(cq.from.id);

    if (!session.lang) session.lang = "en";
    const lang = session.lang;

    const data = cq.data;

    // CONFIRM
    if (data === "confirm") {

      await sendMessage(
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

      if (session.data.photos.length > 0) {
        await sendMediaGroup(session.data.photos);
      }

      await sendMessage(
        TOKEN,
        cq.message.chat.id,
        texts[lang].sent,
        newReportKeyboard(lang)
      );

      session.step = "done";
    }

    // NEW REPORT 🔥 FIXED LANGUAGE BUG HERE
    if (data === "new") {

      session.step = "name";
      session.data = {
        photos: [],
        dropDate: "",
        pickupDate: ""
      };

      // ❗ IMPORTANT: always use session.lang
      await sendMessage(
        TOKEN,
        cq.message.chat.id,
        texts[session.lang || "en"].ask_name
      );
    }

    return new Response("ok");
  }

  return new Response("ok");
}

Deno.serve(handler);

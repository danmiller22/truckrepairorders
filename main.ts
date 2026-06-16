import { getSession } from "./state.ts";
import { texts } from "./i18n.ts";
import { langKeyboard, confirmKeyboard, newReportKeyboard } from "./keyboards.ts";
import { sendMessage, sendPhoto } from "./utils.ts";

const TOKEN = Deno.env.get("BOT_TOKEN")!;
const GROUP = Deno.env.get("GROUP_CHAT_ID")!;

async function handler(req: Request) {
  const update = await req.json();

  if (update.message) {
    const msg = update.message;
    const userId = msg.from.id;
    const session = getSession(userId);

    if (msg.text === "/start") {
      session.step = "lang";
      await sendMessage(TOKEN, msg.chat.id, texts.en.start, langKeyboard());
      return new Response("ok");
    }

    if (session.step === "lang") {
      return new Response("ok");
    }

    if (session.step === "name") {
      session.data.name = msg.text;
      session.step = "truck";
      await sendMessage(TOKEN, msg.chat.id, texts[session.lang].ask_truck);
      return new Response("ok");
    }

    if (session.step === "truck") {
      session.data.truck = msg.text;
      session.step = "issue";
      await sendMessage(TOKEN, msg.chat.id, texts[session.lang].ask_issue);
      return new Response("ok");
    }

    if (session.step === "issue") {
      session.data.issue = msg.text;
      session.step = "photos";
      await sendMessage(TOKEN, msg.chat.id, texts[session.lang].ask_photos);
      return new Response("ok");
    }

    if (session.step === "photos") {
      if (msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        session.data.photos.push(fileId);
      }

      const caption = `
Truck Repair Order

Name: ${session.data.name || ""}
Truck: ${session.data.truck || ""}
Issue: ${session.data.issue || ""}
`;

      await sendMessage(TOKEN, msg.chat.id, texts[session.lang].confirm, confirmKeyboard(session.lang));

      session.step = "confirm";
      session.data.preview = caption;
      return new Response("ok");
    }
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const userId = cq.from.id;
    const session = getSession(userId);

    const data = cq.data;

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

    if (data === "confirm") {
      const text = session.data.preview;

      await sendMessage(TOKEN, GROUP, text);
      await sendMessage(TOKEN, cq.message.chat.id, texts[session.lang].sent, newReportKeyboard(session.lang));

      session.step = "done";
    }

    if (data === "new") {
      session.step = "name";
      session.data = { photos: [] };
      await sendMessage(TOKEN, cq.message.chat.id, texts[session.lang].ask_name);
    }

    if (data === "cancel") {
      session.step = "done";
      await sendMessage(TOKEN, cq.message.chat.id, "Cancelled");
    }

    return new Response("ok");
  }

  return new Response("ok");
}

Deno.serve(handler);

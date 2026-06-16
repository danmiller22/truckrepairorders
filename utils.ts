export async function sendMessage(token: string, chat_id: string, text: string, reply_markup?: any) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, reply_markup })
  });
}

export async function sendPhoto(token: string, chat_id: string, photo: string, caption?: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, photo, caption })
  });
}

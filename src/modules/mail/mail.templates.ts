import type { OtpMailData, OutgoingMail, RenderedMail } from "./mail.types.js";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
/** Every dynamic value that goes into HTML passes through this: a name like <script> must stay text. */
export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

const vnd = (n: number): string =>
  `${new Intl.NumberFormat("vi-VN").format(n)} ₫`;

function layout(appName: string, title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f4;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:32px">
<tr><td><h2 style="margin:0 0 16px;color:#2f7d32">${esc(appName)}</h2><h3 style="margin:0 0 16px">${esc(title)}</h3>${body}
<p style="margin-top:32px;font-size:12px;color:#7b8794">Email tự động, vui lòng không trả lời.</p></td></tr>
</table></td></tr></table></body></html>`;
}

function otpMail(
  appName: string,
  subject: string,
  title: string,
  lead: string,
  ignore: string,
  d: OtpMailData,
): RenderedMail {
  return {
    subject: `[${appName}] ${subject}`,
    html: layout(
      appName,
      title,
      `<p>Xin chào ${esc(d.fullName)},</p><p>${esc(lead)} (có hiệu lực ${d.ttlMinutes} phút):</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#f0f7f0;padding:16px;text-align:center;border-radius:6px">${esc(d.code)}</p>
<p>${esc(ignore)}</p>`,
    ),
    text: `Xin chào ${d.fullName}, ${lead.toLowerCase()} là ${d.code} (hiệu lực ${d.ttlMinutes} phút). ${ignore}`,
  };
}

export function renderMail(appName: string, mail: OutgoingMail): RenderedMail {
  switch (mail.type) {
    case "email_verification":
      return otpMail(
        appName,
        "Mã xác thực email",
        "Xác thực email",
        "Mã xác thực của bạn",
        "Nếu bạn không đăng ký tài khoản, hãy bỏ qua email này.",
        mail.data,
      );
    case "password_reset":
      return otpMail(
        appName,
        "Mã đặt lại mật khẩu",
        "Đặt lại mật khẩu",
        "Mã đặt lại mật khẩu của bạn",
        "Nếu bạn không yêu cầu, hãy bỏ qua email này: mật khẩu của bạn không thay đổi.",
        mail.data,
      );
    case "order_placed": {
      const d = mail.data;
      const rows = d.items
        .map(
          (i) =>
            `<tr><td style="padding:6px 0">${esc(i.name)}</td><td align="right">${i.quantity} ${esc(i.unit)}</td><td align="right">${vnd(i.price * i.quantity)}</td></tr>`,
        )
        .join("");
      const method =
        d.paymentMethod === "vnpay"
          ? "Thanh toán VNPay"
          : "Thanh toán khi nhận hàng (COD)";
      return {
        subject: `[${appName}] Đơn hàng ${d.orderCode} đã được tạo`,
        html: layout(
          appName,
          `Đơn hàng ${d.orderCode}`,
          `<p>Xin chào ${esc(d.fullName)}, cảm ơn bạn đã đặt hàng.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e7eb;border-bottom:1px solid #e4e7eb">${rows}</table>
          <p><b>Tổng cộng: ${vnd(d.total)}</b></p><p>Hình thức: ${method}</p><p>Giao đến: ${esc(d.shippingAddress)}</p>`,
        ),
        text: `Đơn hàng ${d.orderCode} đã được tạo. Tổng cộng ${vnd(d.total)}. ${method}. Giao đến: ${d.shippingAddress}`,
      };
    }
    case "payment_success": {
      const d = mail.data;
      return {
        subject: `[${appName}] Thanh toán thành công đơn ${d.orderCode}`,
        html: layout(
          appName,
          "Thanh toán thành công",
          `<p>Xin chào ${esc(d.fullName)},</p><p>Chúng tôi đã nhận ${vnd(d.amount)} cho đơn hàng <b>${esc(d.orderCode)}</b>.</p>`,
        ),
        text: `Đã nhận thanh toán ${vnd(d.amount)} cho đơn hàng ${d.orderCode}.`,
      };
    }
  }
}
